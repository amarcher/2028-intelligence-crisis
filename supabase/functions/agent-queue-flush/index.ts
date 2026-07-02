// Supabase Edge Function: agent-queue-flush
//
// Places orders that agent-tick queued while the market was closed. The
// premarket tick (9:15 ET) and the weekly Monday tick (8:00 ET) reason well
// before the 09:30 open; their clean proposals now land in agent_orders with
// status='queued' + the full proposal JSON instead of being rejected. This
// function runs shortly after the open (cron at 13:36 AND 14:36 UTC — one of
// the two is post-open in each DST regime; the pre-open one no-ops), re-runs
// the guardrails against fresh account state, and submits what still passes.
//
// Also expires queued orders left over from prior days — a proposal is only
// good for the day it was made (freshness principle from the execution plan).
//
// Deploy: supabase functions deploy agent-queue-flush

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  alpacaFromEnv,
  getAccount,
  getPositions,
} from '../agent-tick/alpaca.ts';
import { validateTrade, type GuardrailContext, type PriorOrderSummary } from '../agent-tick/guardrails.ts';
import { buildOrderPlan, executeSpreadProposal, placeSmartOrder, sideFromAction } from '../agent-tick/execute.ts';
import { reconcileOrders } from '../agent-tick/reconcile.ts';
import { sendTradeAlert } from '../agent-tick/alerts.ts';
import type { Proposal } from '../agent-tick/reasoner.ts';

interface QueuedOrderRow {
  id: string;
  digest_id: string | null;
  created_at: string;
  ticker: string;
  instrument: string;
  side: 'buy' | 'sell';
  notional_usd: number | null;
  proposal: Proposal | null;
}

function etToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const summary = {
    expired: 0,
    placed: 0,
    rejected: 0,
    approvals: 0,
    left_queued: 0,
    reconcile: null as unknown,
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

    const todayStart = `${etToday()}T00:00:00-05:00`;

    // Expire yesterday's leftovers first — stale proposals must not execute.
    const { data: expiredRows, error: expireErr } = await supabase
      .from('agent_orders')
      .update({
        status: 'expired',
        rejection_reason: 'queued order expired unfilled (proposal older than today)',
      })
      .eq('status', 'queued')
      .lt('created_at', todayStart)
      .select('id');
    if (expireErr) summary.errors.push(`expire: ${expireErr.message}`);
    summary.expired = expiredRows?.length ?? 0;

    const creds = alpacaFromEnv(config.paper_mode !== false);

    // Reconcile fills while we're here — this function runs right after the
    // open, which is exactly when yesterday's day orders reach terminal state.
    summary.reconcile = await reconcileOrders(supabase, creds);

    if (config.halted) {
      return json({ ...summary, skipped: true, reason: `halted: ${config.halt_reason}` });
    }

    const { data: queuedRaw, error: queueErr } = await supabase
      .from('agent_orders')
      .select('id, digest_id, created_at, ticker, instrument, side, notional_usd, proposal')
      .eq('status', 'queued')
      .gte('created_at', todayStart)
      .order('created_at', { ascending: true });
    if (queueErr) throw new Error(`load queued: ${queueErr.message}`);
    const queued = (queuedRaw ?? []) as QueuedOrderRow[];
    if (queued.length === 0) return json({ ...summary, note: 'no queued orders' });

    const [account, positions, todayOrdersRaw] = await Promise.all([
      getAccount(creds),
      getPositions(creds),
      supabase
        .from('agent_orders')
        .select('id, notional_usd, instrument, status, created_at')
        .gte('created_at', todayStart),
    ]);
    const allToday = (todayOrdersRaw.data ?? []) as Array<PriorOrderSummary & { id: string }>;

    for (const row of queued) {
      const p = row.proposal;
      if (!p) {
        await supabase
          .from('agent_orders')
          .update({ status: 'expired', rejection_reason: 'queued without proposal payload' })
          .eq('id', row.id);
        summary.errors.push(`row ${row.id}: no proposal payload`);
        continue;
      }

      // Exclude the row being flushed from the daily-gross sum — its own
      // queued notional would otherwise double-count against itself.
      const ctx: GuardrailContext = {
        config: {
          halted: false,
          halt_reason: null,
          phase: config.phase,
          paper_mode: config.paper_mode !== false,
        },
        account,
        positions,
        todayOrders: allToday.filter((o) => o.id !== row.id),
        now: new Date(),
      };

      const decision = validateTrade(p, ctx);

      if (decision.outcome === 'deferred') {
        // Still before the open (winter-time 13:36 UTC run). Leave the rest
        // queued; the 14:36 UTC run will pick them up.
        summary.left_queued = queued.length - summary.placed - summary.rejected - summary.approvals;
        break;
      }

      if (decision.outcome === 'rejected') {
        await supabase
          .from('agent_orders')
          .update({ status: 'rejected', rejection_reason: `flush re-validation: ${decision.reason}` })
          .eq('id', row.id);
        summary.rejected++;
        continue;
      }

      if (decision.outcome === 'requires_approval') {
        await supabase.from('agent_approvals').insert({
          digest_id: row.digest_id,
          kind: 'oversize_ticket',
          proposals: [p],
          rationale: `queued order grew past the per-ticket cap by the open: ${decision.reason}`,
        });
        await supabase
          .from('agent_orders')
          .update({ status: 'canceled', rejection_reason: 'converted to owner approval (oversize at flush)' })
          .eq('id', row.id);
        summary.approvals++;
        continue;
      }

      // Spreads take the mleg path.
      if (p.instrument === 'put_spread' || p.instrument === 'call_spread') {
        const res = await executeSpreadProposal(
          creds, p, decision.notional, positions, `q-${row.id.slice(0, 13)}`,
        );
        if (!res.ok) {
          await supabase
            .from('agent_orders')
            .update({ status: 'rejected', rejection_reason: res.reason })
            .eq('id', row.id);
          summary.rejected++;
          continue;
        }
        await supabase
          .from('agent_orders')
          .update({
            status: 'submitted',
            alpaca_order_id: res.order.id,
            submitted_at: res.order.submitted_at,
            qty: res.qty,
            option_symbol: res.longSymbol,
            order_type: 'limit',
            limit_price: res.limitPrice,
            notional_usd: decision.notional,
            raw_alpaca: res.order,
            rejection_reason: null,
          })
          .eq('id', row.id);
        if (p.time_stop || (p.archetype && p.archetype !== 'core')) {
          await supabase.from('agent_position_rules').upsert(
            {
              option_symbol: res.longSymbol,
              ticker: p.ticker,
              archetype: p.archetype ?? 'core',
              force_close_date: p.time_stop ?? null,
            },
            { onConflict: 'option_symbol' },
          );
        }
        summary.placed++;
        continue;
      }

      const plan = await buildOrderPlan(creds, p, decision.notional, positions);
      if (!plan.ok) {
        await supabase
          .from('agent_orders')
          .update({ status: 'rejected', rejection_reason: plan.reason })
          .eq('id', row.id);
        summary.rejected++;
        continue;
      }

      try {
        const { order: orderRes, orderType, limitPrice } = await placeSmartOrder(creds, {
          symbol: plan.symbol,
          qty: plan.qty,
          side: sideFromAction(p.action),
          isOption: plan.optionSymbol != null,
          clientOrderId: `q-${row.id.slice(0, 13)}`,
        });
        await supabase
          .from('agent_orders')
          .update({
            status: 'submitted',
            alpaca_order_id: orderRes.id,
            submitted_at: orderRes.submitted_at,
            qty: plan.qty,
            option_symbol: plan.optionSymbol,
            order_type: orderType,
            limit_price: limitPrice,
            notional_usd: decision.notional,
            raw_alpaca: orderRes,
            rejection_reason: null,
          })
          .eq('id', row.id);
        if ((p.time_stop || (p.archetype && p.archetype !== 'core')) &&
            (p.action === 'open' || p.action === 'add')) {
          await supabase.from('agent_position_rules').upsert(
            {
              option_symbol: plan.optionSymbol ?? p.ticker,
              ticker: p.ticker,
              archetype: p.archetype ?? 'core',
              force_close_date: p.time_stop ?? null,
            },
            { onConflict: 'option_symbol' },
          );
        }
        summary.placed++;

        const alertRes = await sendTradeAlert({
          action: p.action,
          side: sideFromAction(p.action),
          ticker: p.ticker,
          instrument: p.instrument,
          option_symbol: plan.optionSymbol,
          expiry: p.expiry,
          strike: p.strike,
          qty: plan.qty,
          notional_usd: decision.notional,
          rationale: `${p.rationale} (queued at ${row.created_at.slice(11, 16)} UTC, placed at the open)`,
          exit_condition: p.exit_condition,
          alpaca_order_id: orderRes.id,
        });
        if (!alertRes.ok) summary.errors.push(`trade alert ${p.ticker}: ${alertRes.error ?? 'unknown'}`);
      } catch (e) {
        const msg = String(e).slice(0, 300);
        await supabase
          .from('agent_orders')
          .update({ status: 'rejected', rejection_reason: `flush placeOrder threw: ${msg}` })
          .eq('id', row.id);
        summary.rejected++;
        summary.errors.push(`placeOrder ${p.ticker}: ${msg}`);
      }
    }

    return json(summary);
  } catch (err) {
    console.error('agent-queue-flush failed:', err);
    return json({ error: String(err), ...summary }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
