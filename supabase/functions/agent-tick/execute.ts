// Execution orchestration. Called from agent-tick after the digest row lands,
// but only when agent_config.mode = 'auto_execute' AND phase ∈ (paper,
// small_live, scale). Shadow phase skips this entirely (signal-only).
//
// Flow per tick:
//   1. Load Alpaca account + positions + open orders + today's agent_orders
//   2. If phase_flip detected or any proposal is unwind_all → wrap all
//      proposals into one agent_approvals row. No orders placed this tick.
//   3. Otherwise per-proposal:
//      - resolve option OCC symbol if needed
//      - validateTrade() via guardrails
//      - outcome=approved → placeOrder(), insert agent_orders
//      - outcome=requires_approval → insert agent_approvals (single proposal)
//      - outcome=rejected → log + return with reason
//   4. Sync agent_positions_cache from Alpaca response
//
// Spreads (put_spread, call_spread) are NOT YET SUPPORTED — rejected with a
// clear reason until multi-leg ordering lands.

import {
  alpacaFromEnv,
  cancelAllOrders,
  getAccount,
  getOptionsChain,
  getPositions,
  placeOrder,
  type AlpacaCredentials,
  type AlpacaAccount,
  type AlpacaPosition,
  type PlaceOrderParams,
} from './alpaca.ts';
import {
  CAPS,
  validateTrade,
  type GuardrailContext,
  type PriorOrderSummary,
} from './guardrails.ts';
import type { Proposal } from './reasoner.ts';
import { sendApprovalAlert, sendTradeAlert } from './alerts.ts';

export type ExecutionConfig = GuardrailContext['config'];

export interface ExecutionSupabase {
  insertOrder(row: AgentOrderRow): Promise<{ id: string } | null>;
  insertApproval(row: AgentApprovalRow): Promise<{ id: string } | null>;
  todayOrders(): Promise<PriorOrderSummary[]>;
  replacePositionsCache(positions: AlpacaPosition[]): Promise<void>;
  priorDigests(limit: number): Promise<Array<{ fired_count: number }>>;
}

export interface AgentOrderRow {
  digest_id: string;
  approval_id?: string | null;
  ticker: string;
  instrument: string;
  option_symbol?: string | null;
  side: 'buy' | 'sell';
  qty: number;
  order_type: 'market' | 'limit';
  limit_price?: number | null;
  notional_usd: number | null;
  status: string;
  alpaca_order_id?: string | null;
  submitted_at?: string | null;
  rejection_reason?: string | null;
  raw_alpaca?: unknown;
}

export interface AgentApprovalRow {
  digest_id: string;
  kind: 'phase_flip' | 'oversize_ticket' | 'new_ticker' | 'unwind_all';
  proposals: Proposal[];
  rationale: string;
}

export interface ExecutionOutcome {
  mode: 'auto_execute';
  phase: ExecutionConfig['phase'];
  placed: number;
  queued: number;
  rejected: number;
  errors: string[];
}

export interface ExecutionInput {
  digestId: string;
  config: ExecutionConfig;
  proposals: Proposal[];
  firedCountThisTick: number;
  killSwitchTriggered: boolean;
  supa: ExecutionSupabase;
  now?: Date;
}

// ————— orchestration —————

export async function orchestrateExecution(input: ExecutionInput): Promise<ExecutionOutcome> {
  const now = input.now ?? new Date();
  const errors: string[] = [];

  // Guard: only paper/small_live/scale run this path.
  if (input.config.phase === 'shadow') {
    return {
      mode: 'auto_execute',
      phase: 'shadow',
      placed: 0,
      queued: 0,
      rejected: 0,
      errors: ['skipped: phase=shadow (signal-only)'],
    };
  }

  let creds: AlpacaCredentials;
  try {
    creds = alpacaFromEnv(input.config.paper_mode);
  } catch (e) {
    return {
      mode: 'auto_execute',
      phase: input.config.phase,
      placed: 0,
      queued: 0,
      rejected: 0,
      errors: [`alpaca creds missing: ${String(e).slice(0, 200)}`],
    };
  }

  // ————— phase-flip and unwind_all detection → wrap as a single approval —————

  const priorDigests = await input.supa.priorDigests(3);
  const priorFired = priorDigests.length > 0 ? priorDigests[0].fired_count : 0;
  const phaseFlipped = priorFired < 2 && input.firedCountThisTick >= 2;
  const hasUnwindAll = input.proposals.some((p) => p.action === 'unwind_all');

  if (phaseFlipped || hasUnwindAll || input.killSwitchTriggered) {
    const kind: AgentApprovalRow['kind'] = input.killSwitchTriggered || hasUnwindAll
      ? 'unwind_all'
      : 'phase_flip';
    const rationale = input.killSwitchTriggered
      ? `Kill-switch triggered at ${input.firedCountThisTick}/5 — agent proposes full unwind.`
      : phaseFlipped
        ? `Signal count crossed from ${priorFired}/5 to ${input.firedCountThisTick}/5 — agent proposes Phase-2 rotation.`
        : `Agent emitted unwind_all action.`;

    await input.supa.insertApproval({
      digest_id: input.digestId,
      kind,
      proposals: input.proposals,
      rationale,
    });

    // Alert owner immediately — phase flips and unwinds are time-sensitive.
    // Failures are non-fatal; the approval row is already persisted.
    const alertRes = await sendApprovalAlert({
      kind,
      rationale,
      proposals: input.proposals.map((p) => ({
        action: p.action,
        ticker: p.ticker,
        instrument: p.instrument,
        expiry: p.expiry,
        strike: p.strike,
        size_hint: p.size_hint,
        rationale: p.rationale,
      })),
      expiresIn: '24 hours',
    });
    if (!alertRes.ok) {
      errors.push(`approval alert: ${alertRes.error ?? 'unknown'}`);
    }

    return {
      mode: 'auto_execute',
      phase: input.config.phase,
      placed: 0,
      queued: 1,
      rejected: 0,
      errors,
    };
  }

  // ————— per-proposal execution —————

  let account: AlpacaAccount;
  let positions: AlpacaPosition[];
  let todayOrders: PriorOrderSummary[];

  try {
    [account, positions, todayOrders] = await Promise.all([
      getAccount(creds),
      getPositions(creds),
      input.supa.todayOrders(),
    ]);
  } catch (e) {
    return {
      mode: 'auto_execute',
      phase: input.config.phase,
      placed: 0,
      queued: 0,
      rejected: 0,
      errors: [`failed loading account state: ${String(e).slice(0, 300)}`],
    };
  }

  // Sync positions cache. Don't let cache failure block execution.
  try {
    await input.supa.replacePositionsCache(positions);
  } catch (e) {
    errors.push(`positions cache sync failed: ${String(e).slice(0, 200)}`);
  }

  const ctx: GuardrailContext = {
    config: input.config,
    account,
    positions,
    todayOrders,
    now,
  };

  let placed = 0;
  let queued = 0;
  let rejected = 0;

  for (let i = 0; i < input.proposals.length; i++) {
    const p = input.proposals[i];

    // Actions that don't produce orders
    if (p.action === 'hold') continue;
    if (p.action === 'unwind_all') continue; // already handled above as approval

    // Spreads — not yet supported at the execution layer
    if (p.instrument === 'put_spread' || p.instrument === 'call_spread') {
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        side: p.action === 'add' || p.action === 'open' ? 'buy' : 'sell',
        qty: 0,
        order_type: 'market',
        notional_usd: null,
        status: 'rejected',
        rejection_reason: 'spreads not yet supported by execute.ts — pending multi-leg support',
      });
      rejected++;
      continue;
    }

    const decision = validateTrade(p, ctx);

    if (decision.outcome === 'rejected') {
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        side: sideFromAction(p.action),
        qty: 0,
        order_type: 'market',
        notional_usd: null,
        status: 'rejected',
        rejection_reason: decision.reason,
      });
      rejected++;
      continue;
    }

    if (decision.outcome === 'requires_approval') {
      const rationale = `${decision.reason} — notional $${decision.notional.toFixed(0)} (${decision.size_pct.toFixed(1)}% of $${account.equity.toFixed(0)} equity)`;
      await input.supa.insertApproval({
        digest_id: input.digestId,
        kind: 'oversize_ticket',
        proposals: [p],
        rationale,
      });
      // Fire-and-forget alert; don't block execution on email failures.
      const alertRes = await sendApprovalAlert({
        kind: 'oversize_ticket',
        rationale,
        proposals: [{
          action: p.action,
          ticker: p.ticker,
          instrument: p.instrument,
          expiry: p.expiry,
          strike: p.strike,
          size_hint: p.size_hint,
          rationale: p.rationale,
        }],
        expiresIn: '24 hours',
      });
      if (!alertRes.ok) {
        errors.push(`approval alert: ${alertRes.error ?? 'unknown'}`);
      }
      queued++;
      continue;
    }

    // ————— place the order —————

    const side = sideFromAction(p.action);
    let symbol = p.ticker;
    let qty: number;
    let optionSymbol: string | null = null;

    if (p.instrument === 'equity') {
      qty = Math.max(1, Math.floor(decision.notional / Math.max(account.equity * 0.0001, 1)));
      // For equity we just let qty be decision.notional / current_price.
      // Without a quote, use a conservative estimate based on the ticker in
      // existing positions if present; otherwise qty = 1 as a fallback (the
      // guardrail already enforces the notional ceiling so downside is bounded).
      const existing = positions.find((pos) => pos.symbol === p.ticker);
      const estPrice = existing?.current_price ?? existing?.avg_entry_price ?? 100;
      qty = Math.max(1, Math.round(decision.notional / estPrice));
    } else {
      // Option — resolve OCC symbol, then size in contracts
      try {
        const resolved = await resolveOptionSymbol(creds, p);
        if (!resolved) {
          await input.supa.insertOrder({
            digest_id: input.digestId,
            ticker: p.ticker,
            instrument: p.instrument,
            side,
            qty: 0,
            order_type: 'market',
            notional_usd: null,
            status: 'rejected',
            rejection_reason: `could not resolve OCC symbol for ${p.ticker} ${p.instrument} ${p.expiry ?? '?'} ${p.strike ?? '?'}`,
          });
          rejected++;
          continue;
        }
        symbol = resolved.symbol;
        optionSymbol = resolved.symbol;
        // Each contract = 100 shares. Use close_price as notional estimate.
        // If no close price, default to $1 (min contract price).
        const perContractCost = (resolved.close_price ?? 1) * 100;
        qty = Math.max(1, Math.round(decision.notional / perContractCost));
      } catch (e) {
        errors.push(`option resolution failed for ${p.ticker}: ${String(e).slice(0, 200)}`);
        await input.supa.insertOrder({
          digest_id: input.digestId,
          ticker: p.ticker,
          instrument: p.instrument,
          side,
          qty: 0,
          order_type: 'market',
          notional_usd: null,
          status: 'rejected',
          rejection_reason: `option chain lookup threw: ${String(e).slice(0, 200)}`,
        });
        rejected++;
        continue;
      }
    }

    // Client order ID for idempotency — digest_id + proposal index
    const clientOrderId = `${input.digestId.slice(0, 8)}-${i}`;

    const orderParams: PlaceOrderParams = {
      symbol,
      qty,
      side,
      type: 'market',
      time_in_force: 'day',
      client_order_id: clientOrderId,
    };

    try {
      const orderRes = await placeOrder(creds, orderParams);
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: optionSymbol,
        side,
        qty,
        order_type: 'market',
        notional_usd: decision.notional,
        status: 'submitted',
        alpaca_order_id: orderRes.id,
        submitted_at: orderRes.submitted_at,
        raw_alpaca: orderRes,
      });
      // Per-trade Slack/email alert — fire-and-forget. Never blocks execution;
      // failure just adds a non-fatal entry to errors[] so the tick keeps going.
      const alertRes = await sendTradeAlert({
        action: p.action,
        side,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: optionSymbol,
        expiry: p.expiry,
        strike: p.strike,
        qty,
        notional_usd: decision.notional,
        rationale: p.rationale,
        exit_condition: p.exit_condition,
        alpaca_order_id: orderRes.id,
      });
      if (!alertRes.ok) {
        errors.push(`trade alert ${p.ticker}: ${alertRes.error ?? 'unknown'}`);
      }
      placed++;
    } catch (e) {
      const errMsg = String(e).slice(0, 400);
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: optionSymbol,
        side,
        qty,
        order_type: 'market',
        notional_usd: decision.notional,
        status: 'rejected',
        rejection_reason: `Alpaca placeOrder threw: ${errMsg}`,
      });
      errors.push(`placeOrder ${p.ticker}: ${errMsg}`);
      rejected++;
    }
  }

  return {
    mode: 'auto_execute',
    phase: input.config.phase,
    placed,
    queued,
    rejected,
    errors,
  };
}

// ————— helpers —————

function sideFromAction(action: Proposal['action']): 'buy' | 'sell' {
  if (action === 'open' || action === 'add') return 'buy';
  // trim, close, roll (sell-side of the roll), unwind_all all reduce position
  return 'sell';
}

interface ResolvedOption {
  symbol: string;
  strike_price: number;
  expiration_date: string;
  close_price: number | undefined;
}

async function resolveOptionSymbol(
  c: AlpacaCredentials,
  p: Proposal,
): Promise<ResolvedOption | null> {
  if (p.instrument !== 'put' && p.instrument !== 'call') return null;
  if (!p.expiry || p.strike == null) return null;

  const [gte, lte] = expiryToDateRange(p.expiry);
  if (!gte || !lte) return null;

  const chain = await getOptionsChain(c, p.ticker, {
    type: p.instrument,
    expiration_date_gte: gte,
    expiration_date_lte: lte,
    strike_price_gte: p.strike * 0.95,
    strike_price_lte: p.strike * 1.05,
    limit: 20,
  });
  if (chain.length === 0) return null;

  // Pick the contract with strike closest to proposal.strike.
  const sorted = [...chain].sort((a, b) => {
    const da = Math.abs(a.strike_price - (p.strike as number));
    const db = Math.abs(b.strike_price - (p.strike as number));
    return da - db;
  });
  const best = sorted[0];
  return {
    symbol: best.symbol,
    strike_price: best.strike_price,
    expiration_date: best.expiration_date,
    close_price: best.close_price,
  };
}

/** "Jan 2027" → ['2027-01-01', '2027-01-31']. */
function expiryToDateRange(expiry: string): [string | null, string | null] {
  const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const m = expiry.trim().match(/^([A-Za-z]{3,9})\s+(?:'?(\d{2}|\d{4}))$/);
  if (!m) return [null, null];
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo == null) return [null, null];
  const yr = parseInt(m[2], 10);
  const year = yr < 100 ? 2000 + yr : yr;
  const pad = (n: number) => String(n).padStart(2, '0');
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  return [`${year}-${pad(mo + 1)}-01`, `${year}-${pad(mo + 1)}-${pad(daysInMonth)}`];
}

// ————— kill switch: full unwind (cancel open orders) —————
// Called from agent-kill-check (Exec-7) when the medium-kill fires. Does NOT
// close positions — only cancels pending orders so no new exposure lands.
export async function cancelAllOpenOrders(): Promise<{ canceled: number; errors: string[] }> {
  try {
    const creds = alpacaFromEnv();
    const res = await cancelAllOrders(creds);
    return { canceled: res.length, errors: [] };
  } catch (e) {
    return { canceled: 0, errors: [String(e).slice(0, 300)] };
  }
}

// ————— used by guardrails exports —————
export { CAPS };
