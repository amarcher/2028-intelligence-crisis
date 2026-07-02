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
  getLatestOptionQuotes,
  getOptionsChain,
  getPositions,
  placeOrder,
  placeSpreadOrder,
  type AlpacaCredentials,
  type AlpacaAccount,
  type AlpacaOrder,
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
  /** Upsert an exit rule for a just-opened position (archetype/time_stop). */
  upsertPositionRule(row: PositionRuleUpsert): Promise<void>;
}

export interface PositionRuleUpsert {
  option_symbol: string; // OCC for options; bare ticker for equity tacticals
  ticker: string;
  archetype: string;
  force_close_date: string | null;
}

/** Persist archetype/time-stop exit rules for archetype trades so the exit
 *  engine can enforce them. Core positions without a time stop skip this —
 *  they get default rules from the exit engine on first sight. */
async function maybeUpsertRule(
  supa: ExecutionSupabase,
  p: Proposal,
  keySymbol: string,
): Promise<void> {
  const archetype = p.archetype ?? 'core';
  if (!p.time_stop && archetype === 'core') return;
  if (p.action !== 'open' && p.action !== 'add') return;
  try {
    await supa.upsertPositionRule({
      option_symbol: keySymbol,
      ticker: p.ticker,
      archetype,
      force_close_date: p.time_stop ?? null,
    });
  } catch (e) {
    console.warn(`rule upsert ${keySymbol} failed (non-fatal):`, String(e).slice(0, 150));
  }
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
  /** Full proposal JSON, stored on status='queued' rows so agent-queue-flush
   *  can re-validate and place the order at the next market open. */
  proposal?: unknown;
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

    const decision = validateTrade(p, ctx);

    if (decision.outcome === 'deferred') {
      // Clean proposal, market closed (premarket / weekly-Monday tick).
      // Persist as queued with the proposal payload; agent-queue-flush
      // re-validates and places it shortly after the open.
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        side: sideFromAction(p.action),
        qty: 0,
        order_type: 'market',
        notional_usd: decision.notional,
        status: 'queued',
        rejection_reason: decision.reason,
        proposal: p,
      });
      queued++;
      continue;
    }

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

    // Multi-leg spreads take their own path (mleg order, both legs resolved).
    if (p.instrument === 'put_spread' || p.instrument === 'call_spread') {
      const res = await executeSpreadProposal(
        creds, p, decision.notional, positions, `${input.digestId.slice(0, 8)}-${i}`,
      );
      if (!res.ok) {
        await input.supa.insertOrder({
          digest_id: input.digestId,
          ticker: p.ticker,
          instrument: p.instrument,
          side,
          qty: 0,
          order_type: 'limit',
          notional_usd: null,
          status: 'rejected',
          rejection_reason: res.reason,
        });
        rejected++;
        continue;
      }
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: res.longSymbol,
        side,
        qty: res.qty,
        order_type: 'limit',
        limit_price: res.limitPrice,
        notional_usd: decision.notional,
        status: 'submitted',
        alpaca_order_id: res.order.id,
        submitted_at: res.order.submitted_at,
        raw_alpaca: res.order,
      });
      await maybeUpsertRule(input.supa, p, res.longSymbol);
      const alertRes = await sendTradeAlert({
        action: p.action,
        side,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: `${res.longSymbol} / ${res.shortSymbol}`,
        expiry: p.expiry,
        strike: p.strike,
        qty: res.qty,
        notional_usd: decision.notional,
        rationale: p.rationale,
        exit_condition: p.exit_condition,
        alpaca_order_id: res.order.id,
      });
      if (!alertRes.ok) errors.push(`trade alert ${p.ticker}: ${alertRes.error ?? 'unknown'}`);
      placed++;
      continue;
    }

    const plan = await buildOrderPlan(creds, p, decision.notional, positions);
    if (!plan.ok) {
      errors.push(`order plan ${p.ticker}: ${plan.reason}`);
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        side,
        qty: 0,
        order_type: 'market',
        notional_usd: null,
        status: 'rejected',
        rejection_reason: plan.reason,
      });
      rejected++;
      continue;
    }
    const { symbol, qty, optionSymbol } = plan;

    // Client order ID for idempotency — digest_id + proposal index
    const clientOrderId = `${input.digestId.slice(0, 8)}-${i}`;

    try {
      const { order: orderRes, orderType, limitPrice } = await placeSmartOrder(creds, {
        symbol,
        qty,
        side,
        isOption: optionSymbol != null,
        clientOrderId,
      });
      await input.supa.insertOrder({
        digest_id: input.digestId,
        ticker: p.ticker,
        instrument: p.instrument,
        option_symbol: optionSymbol,
        side,
        qty,
        order_type: orderType,
        limit_price: limitPrice,
        notional_usd: decision.notional,
        status: 'submitted',
        alpaca_order_id: orderRes.id,
        submitted_at: orderRes.submitted_at,
        raw_alpaca: orderRes,
      });
      await maybeUpsertRule(input.supa, p, optionSymbol ?? p.ticker);
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

export function sideFromAction(action: Proposal['action']): 'buy' | 'sell' {
  if (action === 'open' || action === 'add') return 'buy';
  // trim, close, roll (sell-side of the roll), unwind_all all reduce position
  return 'sell';
}

/** Option price increments: penny under $3.00, nickel above (safe for
 *  non-penny-pilot classes; penny classes just get a slightly coarser limit). */
function roundOptionPrice(price: number): number {
  const tick = price < 3 ? 0.01 : 0.05;
  return Math.max(tick, Math.round(price / tick) * tick);
}

/** Place an order as a MARKETABLE LIMIT when a quote is available — crosses
 *  the spread deliberately (buy at ask+2%, sell at bid−2%) so fills are
 *  near-certain but a wide or broken LEAPS quote can't fill 15% through fair
 *  value the way a bare market order can. Falls back to a market order when
 *  no quote resolves. Equities stay market orders (liquid ETF/large-cap
 *  universe; spread damage lives in the options). */
export async function placeSmartOrder(
  creds: AlpacaCredentials,
  opts: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    isOption: boolean;
    clientOrderId: string;
  },
): Promise<{ order: AlpacaOrder; orderType: 'market' | 'limit'; limitPrice: number | null }> {
  let orderType: 'market' | 'limit' = 'market';
  let limitPrice: number | null = null;

  if (opts.isOption) {
    try {
      const quotes = await getLatestOptionQuotes(creds, [opts.symbol]);
      const q = quotes.get(opts.symbol);
      if (q && q.ask > 0 && (opts.side === 'buy' || q.bid > 0)) {
        orderType = 'limit';
        limitPrice = roundOptionPrice(opts.side === 'buy' ? q.ask * 1.02 : q.bid * 0.98);
      }
    } catch (e) {
      console.warn(`option quote ${opts.symbol} failed — falling back to market:`, String(e).slice(0, 150));
    }
  }

  const params: PlaceOrderParams = {
    symbol: opts.symbol,
    qty: opts.qty,
    side: opts.side,
    type: orderType,
    time_in_force: 'day',
    client_order_id: opts.clientOrderId,
  };
  if (orderType === 'limit' && limitPrice != null) params.limit_price = limitPrice;

  const order = await placeOrder(creds, params);
  return { order, orderType, limitPrice };
}

export type OrderPlan =
  | { ok: true; symbol: string; qty: number; optionSymbol: string | null }
  | { ok: false; reason: string };

/** Resolve the tradable symbol + quantity for an approved proposal.
 *  Shared between the tick executor and agent-queue-flush so queued orders
 *  are planned with exactly the same rules at the open. */
export async function buildOrderPlan(
  creds: AlpacaCredentials,
  p: Proposal,
  notional: number,
  positions: AlpacaPosition[],
): Promise<OrderPlan> {
  if (p.instrument === 'equity') {
    // qty = notional / current price. Without a live quote, estimate from an
    // existing position's price; otherwise a conservative $100 fallback (the
    // guardrail already bounded the notional so downside is capped).
    const existing = positions.find((pos) => pos.symbol === p.ticker);
    const estPrice = existing?.current_price ?? existing?.avg_entry_price ?? 100;
    return {
      ok: true,
      symbol: p.ticker,
      qty: Math.max(1, Math.round(notional / estPrice)),
      optionSymbol: null,
    };
  }

  // Option — resolve OCC symbol, then size in contracts.
  try {
    const resolved = await resolveOptionSymbol(creds, p);
    if (!resolved) {
      return {
        ok: false,
        reason: `could not resolve OCC symbol for ${p.ticker} ${p.instrument} ${p.expiry ?? '?'} ${p.strike ?? '?'}`,
      };
    }
    // Each contract = 100 shares. Use close_price as notional estimate.
    // If no close price, default to $1 (min contract price).
    const perContractCost = (resolved.close_price ?? 1) * 100;
    return {
      ok: true,
      symbol: resolved.symbol,
      qty: Math.max(1, Math.round(notional / perContractCost)),
      optionSymbol: resolved.symbol,
    };
  } catch (e) {
    return { ok: false, reason: `option chain lookup threw: ${String(e).slice(0, 200)}` };
  }
}

interface ResolvedOption {
  symbol: string;
  strike_price: number;
  expiration_date: string;
  close_price: number | undefined;
}

/** Resolve one listed contract nearest a target strike. */
async function resolveContract(
  c: AlpacaCredentials,
  ticker: string,
  type: 'put' | 'call',
  expiry: string,
  strike: number,
): Promise<ResolvedOption | null> {
  const [gte, lte] = expiryToDateRange(expiry);
  if (!gte || !lte) return null;

  const chain = await getOptionsChain(c, ticker, {
    type,
    expiration_date_gte: gte,
    expiration_date_lte: lte,
    strike_price_gte: strike * 0.95,
    strike_price_lte: strike * 1.05,
    limit: 20,
  });
  if (chain.length === 0) return null;

  const sorted = [...chain].sort(
    (a, b) => Math.abs(a.strike_price - strike) - Math.abs(b.strike_price - strike),
  );
  const best = sorted[0];
  return {
    symbol: best.symbol,
    strike_price: best.strike_price,
    expiration_date: best.expiration_date,
    close_price: best.close_price,
  };
}

async function resolveOptionSymbol(
  c: AlpacaCredentials,
  p: Proposal,
): Promise<ResolvedOption | null> {
  if (p.instrument !== 'put' && p.instrument !== 'call') return null;
  if (!p.expiry || p.strike == null) return null;
  return resolveContract(c, p.ticker, p.instrument, p.expiry, p.strike);
}

// ————— spreads (mleg) —————

export type SpreadResult =
  | {
      ok: true;
      order: AlpacaOrder;
      qty: number;
      longSymbol: string;
      shortSymbol: string;
      limitPrice: number;
    }
  | { ok: false; reason: string };

function spreadOptionType(instrument: Proposal['instrument']): 'put' | 'call' | null {
  if (instrument === 'put_spread') return 'put';
  if (instrument === 'call_spread') return 'call';
  return null;
}

/** Open or close a defined-risk two-leg spread via an mleg limit order.
 *  Opens: buy `strike`, sell `strike_short`, net-debit limit from quotes.
 *  Closes: unwind the existing long/short pair on the underlying. */
export async function executeSpreadProposal(
  creds: AlpacaCredentials,
  p: Proposal,
  notional: number,
  positions: AlpacaPosition[],
  clientOrderId: string,
): Promise<SpreadResult> {
  const type = spreadOptionType(p.instrument);
  if (!type) return { ok: false, reason: `not a spread instrument: ${p.instrument}` };

  if (p.action === 'open' || p.action === 'add') {
    if (!p.expiry || p.strike == null || p.strike_short == null) {
      return { ok: false, reason: 'spread open requires expiry, strike, and strike_short' };
    }
    const [longLeg, shortLeg] = await Promise.all([
      resolveContract(creds, p.ticker, type, p.expiry, p.strike),
      resolveContract(creds, p.ticker, type, p.expiry, p.strike_short),
    ]);
    if (!longLeg || !shortLeg) {
      return { ok: false, reason: `could not resolve both spread legs for ${p.ticker} ${p.expiry}` };
    }
    if (longLeg.symbol === shortLeg.symbol) {
      return { ok: false, reason: 'spread legs resolved to the same contract — widen the strikes' };
    }

    // Net-debit limit from NBBO: long ask − short bid, padded 5%. Fall back
    // to close prices when quotes are missing (limit still bounds the damage).
    const quotes = await getLatestOptionQuotes(creds, [longLeg.symbol, shortLeg.symbol]).catch(
      () => new Map<string, { bid: number; ask: number }>(),
    );
    const lq = quotes.get(longLeg.symbol);
    const sq = quotes.get(shortLeg.symbol);
    let netDebit: number | null = null;
    if (lq && sq && lq.ask > 0) {
      netDebit = lq.ask - sq.bid;
    } else if (longLeg.close_price != null && shortLeg.close_price != null) {
      netDebit = (longLeg.close_price - shortLeg.close_price) * 1.10;
    }
    if (netDebit == null || netDebit <= 0) {
      return { ok: false, reason: `could not price the ${p.ticker} spread (no quotes/closes)` };
    }
    const limitPrice = Math.max(0.05, Math.round(netDebit * 1.05 * 20) / 20);
    const qty = Math.max(1, Math.round(notional / (limitPrice * 100)));

    try {
      const order = await placeSpreadOrder(creds, {
        legs: [
          { symbol: longLeg.symbol, side: 'buy', position_intent: 'buy_to_open' },
          { symbol: shortLeg.symbol, side: 'sell', position_intent: 'sell_to_open' },
        ],
        qty,
        limitPrice,
        clientOrderId,
      });
      return { ok: true, order, qty, longSymbol: longLeg.symbol, shortSymbol: shortLeg.symbol, limitPrice };
    } catch (e) {
      return { ok: false, reason: `mleg placeOrder threw: ${String(e).slice(0, 250)}` };
    }
  }

  // close / trim: find the live pair on this underlying + type.
  const legs = positions.filter((pos) => {
    if (pos.asset_class !== 'us_option') return false;
    const m = pos.symbol.match(/^([A-Z]{1,6})\d{6}([CP])/);
    return m?.[1] === p.ticker && m?.[2] === (type === 'put' ? 'P' : 'C');
  });
  const longPos = legs.find((l) => l.qty > 0);
  const shortPos = legs.find((l) => l.qty < 0);
  if (!longPos || !shortPos) {
    return { ok: false, reason: `no open ${p.ticker} spread pair found to ${p.action}` };
  }
  const pairQty = Math.min(Math.abs(longPos.qty), Math.abs(shortPos.qty));
  const qty = p.action === 'trim' ? Math.max(1, Math.floor(pairQty / 3)) : pairQty;

  const quotes = await getLatestOptionQuotes(creds, [longPos.symbol, shortPos.symbol]).catch(
    () => new Map<string, { bid: number; ask: number }>(),
  );
  const lq = quotes.get(longPos.symbol);
  const sq = quotes.get(shortPos.symbol);
  // Closing credit: long bid − short ask, padded down 5%. Floor at 0.01 —
  // Alpaca requires a positive limit on mleg orders.
  const netCredit = lq && sq ? lq.bid - sq.ask : null;
  const limitPrice = Math.max(0.01, Math.round((netCredit ?? 0.05) * 0.95 * 20) / 20);

  try {
    const order = await placeSpreadOrder(creds, {
      legs: [
        { symbol: longPos.symbol, side: 'sell', position_intent: 'sell_to_close' },
        { symbol: shortPos.symbol, side: 'buy', position_intent: 'buy_to_close' },
      ],
      qty,
      limitPrice,
      clientOrderId,
    });
    return { ok: true, order, qty, longSymbol: longPos.symbol, shortSymbol: shortPos.symbol, limitPrice };
  } catch (e) {
    return { ok: false, reason: `mleg close threw: ${String(e).slice(0, 250)}` };
  }
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
