// Supabase Edge Function: Daily loss-stop watchdog.
// Fires every ~15 minutes during US market hours via pg_cron. Checks the
// Alpaca account's day P&L; if worse than -4%, cancels all open orders and
// flips agent_config.halted = true so the agent can't enter new positions
// until the owner resumes.
//
// Deploy: supabase functions deploy agent-kill-check
// Skipped when: signal-only mode, phase=shadow, already halted, or outside
// market hours — so off-hour cron fires are cheap no-ops.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  alpacaFromEnv,
  cancelAllOrders,
  getAccount,
  type AlpacaCredentials,
} from '../agent-tick/alpaca.ts';

const DAILY_LOSS_STOP_PCT = -0.04;

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: config, error: configErr } = await supabase
      .from('agent_config')
      .select('enabled, mode, phase, halted')
      .eq('id', 1)
      .single();

    if (configErr || !config) return json({ skipped: true, reason: 'no config row' });
    if (!config.enabled) return json({ skipped: true, reason: 'agent disabled' });
    if (config.phase === 'shadow') return json({ skipped: true, reason: 'phase=shadow' });
    if (config.halted) return json({ skipped: true, reason: 'already halted' });

    if (!isInMarketHours(new Date())) {
      return json({ skipped: true, reason: 'outside market hours' });
    }

    let creds: AlpacaCredentials;
    try {
      creds = alpacaFromEnv();
    } catch (e) {
      return json({ skipped: true, reason: `alpaca not configured: ${String(e).slice(0, 200)}` });
    }

    const account = await getAccount(creds);
    const lossRatio =
      account.last_equity > 0 ? (account.equity - account.last_equity) / account.last_equity : 0;

    // P&L above the threshold — nothing to do. Return the observation so the
    // cron job log shows progress.
    if (lossRatio > DAILY_LOSS_STOP_PCT) {
      return json({
        ok: true,
        halted: false,
        day_pl_pct: Number((lossRatio * 100).toFixed(2)),
        equity: account.equity,
        last_equity: account.last_equity,
      });
    }

    // Kill trigger.
    const cancelResult = await cancelAllOrders(creds);
    const lossPct = (lossRatio * 100).toFixed(2);
    const haltReason =
      `Daily loss stop: equity $${account.equity.toFixed(0)} ` +
      `from $${account.last_equity.toFixed(0)} (${lossPct}%)`;

    await supabase
      .from('agent_config')
      .update({
        halted: true,
        halt_reason: haltReason,
        halted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    await supabase.from('agent_approvals').insert({
      kind: 'resume_after_halt',
      proposals: [],
      rationale:
        `${haltReason}. Canceled ${cancelResult.length} open order${cancelResult.length === 1 ? '' : 's'}. ` +
        `Owner must approve before the agent places new entries.`,
    });

    return json({
      ok: true,
      halted: true,
      reason: haltReason,
      day_pl_pct: Number(lossPct),
      canceled_orders: cancelResult.length,
    });
  } catch (err) {
    console.error('agent-kill-check failed:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

function isInMarketHours(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m <= 16 * 60;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
