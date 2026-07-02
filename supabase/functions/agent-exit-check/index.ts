// Supabase Edge Function: agent-exit-check
//
// The exit engine. Once per trading day (cron 15:00 UTC — in market hours in
// both DST regimes) it evaluates every OPTION position against its
// agent_position_rules row and EXECUTES the exits that trip:
//
//   - stop-loss     unrealized P&L ≤ stop_loss_pct (default −65%) → close.
//                   Convexity floor: if this is the LAST SaaS put in the
//                   book, sell half instead — the slow thesis never goes
//                   fully flat while it's alive.
//   - profit ladder rule of thirds — price ≥ 2× entry → sell ⅓ (once),
//                   price ≥ 4× entry → sell another ⅓ (once).
//   - roll alert    LEAPS with DTE < 90 → Slack suggestion to roll (order
//                   NOT placed; rolls stay human/reasoner decisions for now).
//
// Positions without a rules row get one created with playbook defaults on
// first sight. Equity positions are out of scope (slow-book carry).
//
// Exits were previously prose ("when we'll close it") in Slack that nothing
// evaluated — a DDOG put bled to −96% with no stop. This makes them code.
//
// Deploy: supabase functions deploy agent-exit-check

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  alpacaFromEnv,
  getPositions,
  type AlpacaPosition,
} from '../agent-tick/alpaca.ts';
import { isInMarketHours } from '../agent-tick/guardrails.ts';
import { placeSmartOrder } from '../agent-tick/execute.ts';
import { sendTradeAlert } from '../agent-tick/alerts.ts';

const SAAS_PUT_UNDERLYINGS = new Set(['NOW', 'CRM', 'HUBS', 'WDAY', 'FRSH']);

interface RuleRow {
  option_symbol: string;
  ticker: string;
  stop_loss_pct: number;
  tier1_multiple: number;
  tier2_multiple: number;
  tier1_done: boolean;
  tier2_done: boolean;
  roll_alert_dte: number;
  roll_alerted_at: string | null;
}

interface OccParts {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  type: 'call' | 'put';
  strike: number;
}

/** OCC symbol: ROOT(1-6 letters) + YYMMDD + C/P + strike*1000 (8 digits). */
function parseOcc(symbol: string): OccParts | null {
  const m = symbol.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return {
    underlying: m[1],
    expiry: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === 'P' ? 'put' : 'call',
    strike: Number(m[6]) / 1000,
  };
}

function daysUntil(dateIso: string): number {
  return Math.floor((Date.parse(dateIso) - Date.now()) / 86_400_000);
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const summary = {
    evaluated: 0,
    stops: 0,
    ladder_sells: 0,
    roll_alerts: 0,
    skipped: [] as string[],
    errors: [] as string[],
  };

  try {
    const { data: config } = await supabase
      .from('agent_config')
      .select('enabled, mode, phase, paper_mode, halted, halt_reason')
      .eq('id', 1)
      .single();
    if (!config?.enabled || config.mode !== 'auto_execute' || config.phase === 'shadow') {
      return json({ skipped: true, reason: 'agent disabled / signal-only / shadow phase' });
    }
    // Halted blocks NEW exposure; exits REDUCE risk, so stops still run.
    // Profit-ladder sells also reduce risk — allowed too.

    if (!isInMarketHours(new Date())) {
      return json({ skipped: true, reason: 'outside market hours' });
    }

    const creds = alpacaFromEnv(config.paper_mode !== false);
    const positions = await getPositions(creds);
    const options = positions.filter(
      (p) => p.asset_class === 'us_option' && p.qty > 0,
    );
    if (options.length === 0) return json({ ...summary, note: 'no option positions' });

    const { data: ruleRows, error: rulesErr } = await supabase
      .from('agent_position_rules')
      .select('*');
    if (rulesErr) throw new Error(`load rules: ${rulesErr.message}`);
    const rules = new Map<string, RuleRow>(
      ((ruleRows ?? []) as RuleRow[]).map((r) => [r.option_symbol, r]),
    );

    // Ensure every option position has a rules row (playbook defaults).
    for (const pos of options) {
      if (rules.has(pos.symbol)) continue;
      const occ = parseOcc(pos.symbol);
      const row = {
        option_symbol: pos.symbol,
        ticker: occ?.underlying ?? pos.symbol,
        stop_loss_pct: -65,
        tier1_multiple: 2.0,
        tier2_multiple: 4.0,
        tier1_done: false,
        tier2_done: false,
        roll_alert_dte: 90,
        roll_alerted_at: null,
      };
      const { error } = await supabase.from('agent_position_rules').insert(row);
      if (!error) rules.set(pos.symbol, row as RuleRow);
      else summary.errors.push(`rule insert ${pos.symbol}: ${error.message}`);
    }

    // Convexity floor bookkeeping: how many SaaS puts are alive?
    const saasPuts = options.filter((p) => {
      const occ = parseOcc(p.symbol);
      return occ?.type === 'put' && SAAS_PUT_UNDERLYINGS.has(occ.underlying);
    });

    for (const pos of options) {
      const rule = rules.get(pos.symbol);
      if (!rule) continue;
      summary.evaluated++;
      const occ = parseOcc(pos.symbol);
      const plPct = pos.unrealized_plpc * 100;
      const priceMultiple =
        pos.avg_entry_price > 0 ? pos.current_price / pos.avg_entry_price : 0;
      const isSaasPut =
        occ?.type === 'put' && SAAS_PUT_UNDERLYINGS.has(occ?.underlying ?? '');

      let sellQty = 0;
      let action: 'close' | 'trim' = 'trim';
      let why = '';
      const flags: Record<string, unknown> = {};

      if (plPct <= rule.stop_loss_pct) {
        // Stop-loss. Last-SaaS-put floor: sell half instead of all.
        const lastSaasPut = isSaasPut && saasPuts.length === 1;
        if (lastSaasPut && pos.qty <= 1) {
          summary.skipped.push(
            `${pos.symbol}: stop tripped but it's the last SaaS put and a single contract — held (convexity floor)`,
          );
          continue;
        }
        sellQty = lastSaasPut ? Math.max(1, Math.floor(pos.qty / 2)) : pos.qty;
        action = lastSaasPut ? 'trim' : 'close';
        why = lastSaasPut
          ? `This position lost ${Math.abs(plPct).toFixed(0)}% — the stop-loss rule says sell, but it's our only remaining software put, so we're selling half and keeping half (we never go fully flat on the core prediction).`
          : `This position lost ${Math.abs(plPct).toFixed(0)}%, past the ${Math.abs(rule.stop_loss_pct)}% stop-loss line. Selling it to stop the bleeding.`;
        summary.stops++;
      } else if (!rule.tier2_done && priceMultiple >= rule.tier2_multiple) {
        sellQty = Math.max(1, Math.floor(pos.qty / 3));
        why = `This option is now worth ${priceMultiple.toFixed(1)}× what we paid — banking a third of it (second profit tier). The rest keeps riding.`;
        flags.tier2_done = true;
        if (!rule.tier1_done) flags.tier1_done = true; // gapped past tier 1
        summary.ladder_sells++;
      } else if (!rule.tier1_done && priceMultiple >= rule.tier1_multiple) {
        sellQty = Math.max(1, Math.floor(pos.qty / 3));
        why = `This option doubled (${priceMultiple.toFixed(1)}× entry) — selling a third to lock in the gain. The rest keeps riding.`;
        flags.tier1_done = true;
        summary.ladder_sells++;
      }

      // Sells: qty 1 positions at a profit tier would sell the whole thing —
      // allow it only for stops; for ladder sells keep at least 1 contract.
      if (sellQty > 0 && action === 'trim' && sellQty >= pos.qty && pos.qty > 0) {
        if (pos.qty === 1 && plPct > 0) {
          summary.skipped.push(`${pos.symbol}: single contract at profit tier — held (nothing to ladder)`);
          sellQty = 0;
        } else {
          sellQty = Math.max(1, pos.qty - 1);
        }
      }

      if (sellQty > 0) {
        try {
          const { order } = await placeSmartOrder(creds, {
            symbol: pos.symbol,
            qty: sellQty,
            side: 'sell',
            isOption: true,
            clientOrderId: `exit-${pos.symbol.slice(-9)}-${new Date().toISOString().slice(0, 10)}`,
          });
          await supabase.from('agent_orders').insert({
            ticker: occ?.underlying ?? pos.symbol,
            instrument: occ?.type ?? 'put',
            option_symbol: pos.symbol,
            side: 'sell',
            qty: sellQty,
            order_type: 'market',
            notional_usd: Math.abs(pos.current_price * 100 * sellQty),
            status: 'submitted',
            alpaca_order_id: order.id,
            submitted_at: order.submitted_at,
            rejection_reason: null,
            raw_alpaca: order,
          });
          await supabase
            .from('agent_position_rules')
            .update({ ...flags, last_evaluated_at: new Date().toISOString() })
            .eq('option_symbol', pos.symbol);
          const alertRes = await sendTradeAlert({
            action,
            side: 'sell',
            ticker: occ?.underlying ?? pos.symbol,
            instrument: occ?.type ?? 'put',
            option_symbol: pos.symbol,
            expiry: occ?.expiry ?? null,
            strike: occ?.strike ?? null,
            qty: sellQty,
            notional_usd: Math.abs(pos.current_price * 100 * sellQty),
            rationale: why,
            exit_condition: 'This was the exit — a pre-set rule (stop-loss or profit tier), enforced automatically.',
            alpaca_order_id: order.id,
          });
          if (!alertRes.ok) summary.errors.push(`alert ${pos.symbol}: ${alertRes.error}`);
        } catch (e) {
          summary.errors.push(`sell ${pos.symbol}: ${String(e).slice(0, 200)}`);
        }
        continue; // don't also roll-alert a position we just exited
      }

      // Roll alert (advisory only), throttled to once a week per position.
      if (occ) {
        const dte = daysUntil(occ.expiry);
        const lastAlert = rule.roll_alerted_at ? Date.parse(rule.roll_alerted_at) : 0;
        const weekMs = 7 * 86_400_000;
        if (dte > 0 && dte < rule.roll_alert_dte && Date.now() - lastAlert > weekMs) {
          summary.roll_alerts++;
          await supabase
            .from('agent_position_rules')
            .update({ roll_alerted_at: new Date().toISOString(), last_evaluated_at: new Date().toISOString() })
            .eq('option_symbol', pos.symbol);
          await sendTradeAlert({
            action: 'roll',
            side: 'sell',
            ticker: occ.underlying,
            instrument: occ.type,
            option_symbol: pos.symbol,
            expiry: occ.expiry,
            strike: occ.strike,
            qty: pos.qty,
            notional_usd: Math.abs(pos.market_value),
            rationale: `Heads up — this option expires in ${dte} days (under the ${rule.roll_alert_dte}-day line). The playbook says replace it with the same bet further out (next January). No order was placed; the agent will propose the replacement in its next check-in.`,
            exit_condition: 'Advisory only — nothing was traded.',
          });
        } else {
          await supabase
            .from('agent_position_rules')
            .update({ last_evaluated_at: new Date().toISOString() })
            .eq('option_symbol', pos.symbol);
        }
      }
    }

    // Clean up rules for positions that no longer exist.
    const live = new Set(options.map((p) => p.symbol));
    const stale = [...rules.keys()].filter((s) => !live.has(s));
    if (stale.length > 0) {
      await supabase.from('agent_position_rules').delete().in('option_symbol', stale);
    }

    return json(summary);
  } catch (err) {
    console.error('agent-exit-check failed:', err);
    return json({ error: String(err), ...summary }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
