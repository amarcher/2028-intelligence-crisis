// Supabase Edge Function: agent-event-watch
//
// Cheap no-LLM watcher (cron every 30 min during market hours). Compares the
// latest trade of each tracked name against its prior daily close and fires a
// FULL agent-tick (tick_type='midday') only when something actually moved:
//
//   - any tracked ticker ±5% on the day, or
//   - VIXY (volatility proxy) +8% on the day.
//
// Rate limits itself: never fires if any agent_snapshots row landed in the
// last 2 hours (the scheduled premarket/close ticks cover those windows).
// Every trigger is journaled to meta_indices (key='event_tick').
//
// This is what "more decision points" means in the roadmap: information-
// driven ticks, not a faster metronome.
//
// Deploy: supabase functions deploy agent-event-watch

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  alpacaFromEnv,
  getDailyBars,
  getLatestTrades,
} from '../agent-tick/alpaca.ts';
import { isInMarketHours } from '../agent-tick/guardrails.ts';

// Watch the names that would change the agent's mind, not the whole whitelist.
const WATCHED = [
  'NOW', 'CRM', 'HUBS', 'WDAY', 'FRSH',        // SaaS shorts
  'DDOG', 'QQQ', 'SMH', 'IGV', 'NVDA', 'MSFT', // AI winners / market
  'KRE', 'HYG', 'IYR',                         // credit stress
  'SPY', 'TLT', 'GLD',                         // broad + defensives
] as const;

const MOVE_THRESHOLD_PCT = 5;
const VIXY_THRESHOLD_PCT = 8;
const COOLDOWN_HOURS = 2;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const summary = {
    checked: 0,
    movers: [] as Array<{ ticker: string; pct: number }>,
    fired: false,
    errors: [] as string[],
  };

  try {
    if (!isInMarketHours(new Date())) {
      return json({ skipped: true, reason: 'outside market hours' });
    }

    const { data: config } = await supabase
      .from('agent_config')
      .select('enabled, mode, paper_mode')
      .eq('id', 1)
      .single();
    if (!config?.enabled) return json({ skipped: true, reason: 'agent disabled' });

    // Cooldown: a tick in the last 2h already saw (or will see) this move.
    const cooldownStart = new Date(Date.now() - COOLDOWN_HOURS * 3_600_000).toISOString();
    const { data: recentTicks } = await supabase
      .from('agent_snapshots')
      .select('tick_id')
      .gte('taken_at', cooldownStart)
      .limit(1);
    if (recentTicks && recentTicks.length > 0) {
      return json({ skipped: true, reason: `tick within last ${COOLDOWN_HOURS}h` });
    }

    const creds = alpacaFromEnv(config.paper_mode !== false);
    const symbols = [...WATCHED, 'VIXY'];
    const barsSince = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [trades, bars] = await Promise.all([
      getLatestTrades(creds, symbols),
      getDailyBars(creds, symbols, barsSince),
    ]);
    const lastByTicker = new Map(trades.map((t) => [t.ticker, t.price] as const));

    for (const sym of symbols) {
      const last = lastByTicker.get(sym);
      const series = bars.get(sym);
      if (!last || !series || series.length < 2) continue;
      summary.checked++;
      // Prior close = last completed daily bar that isn't today's forming bar.
      const today = new Date().toISOString().slice(0, 10);
      const prior = [...series].reverse().find((b) => b.asOf.slice(0, 10) < today);
      if (!prior || prior.close <= 0) continue;
      const pct = ((last - prior.close) / prior.close) * 100;
      const threshold = sym === 'VIXY' ? VIXY_THRESHOLD_PCT : MOVE_THRESHOLD_PCT;
      if (Math.abs(pct) >= threshold && (sym !== 'VIXY' || pct > 0)) {
        summary.movers.push({ ticker: sym, pct: Math.round(pct * 100) / 100 });
      }
    }

    if (summary.movers.length === 0) return json(summary);

    // Journal the trigger, then fire a midday tick.
    await supabase.from('meta_indices').insert({
      key: 'event_tick',
      value: summary.movers[0].pct,
      detail: { movers: summary.movers },
    });

    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/agent-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tick_type: 'midday' }),
    });
    summary.fired = res.ok;
    if (!res.ok) summary.errors.push(`agent-tick invoke: ${res.status} ${(await res.text()).slice(0, 200)}`);

    return json(summary);
  } catch (err) {
    console.error('agent-event-watch failed:', err);
    return json({ error: String(err), ...summary }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
