// Hard-cap guardrail middleware.
//
// validateTrade(proposal, ctx) runs BEFORE any order hits Alpaca. Proposals
// can be:
//   - approved (ok: true)              → place the order
//   - queued for owner (requires_approval: true, kind: 'oversize_ticket')
//                                       → write to agent_approvals
//   - rejected (ok: false, reason)      → log, annotate digest, no order
//
// The LLM cannot override these rules. They're enforced in code post-
// extraction, not via the prompt.
//
// Phase-flip and unwind_all approvals are orchestrated at the execution
// module level (Exec-4) — validateTrade handles per-proposal caps only.

import type { Proposal, ProposalSizeHint } from './reasoner.ts';
import type { AlpacaAccount, AlpacaPosition } from './alpaca.ts';
import { WHITELIST } from './filter.ts';

const WHITELIST_SET = new Set<string>(WHITELIST);

// ————— caps (% of account equity) —————

export const CAPS = {
  perTicketMaxPct: 5,
  singleNameMaxPct: 15,
  dailyGrossMaxPct: 20,
  maxOptionTickets: 12,
  marketOpenMinutes: 9 * 60 + 30, // 09:30 ET
  marketCutoffMinutes: 15 * 60 + 55, // 15:55 ET (leave 5min before close)
};

// ————— size_hint → notional translation —————
// For NEW positions (open/add), these map to a target % of account equity.
// For trims, they're a % of the EXISTING position's market value.
const NEW_POSITION_SIZE_PCT: Record<ProposalSizeHint, number> = {
  starter: 1,
  half: 2.5,
  full: 4, // intentionally under the 5% per-ticket cap
  trim_third: 1, // never a new position, but guard against misuse
  trim_half: 1,
};

const TRIM_FRACTION: Record<ProposalSizeHint, number> = {
  trim_third: 1 / 3,
  trim_half: 1 / 2,
  starter: 1 / 3,
  half: 1 / 2,
  full: 1,
};

// ————— context / result types —————

export interface PriorOrderSummary {
  notional_usd: number | null;
  instrument: string;
  status: string;
  created_at: string;
}

export interface GuardrailContext {
  config: {
    halted: boolean;
    halt_reason: string | null;
    phase: 'shadow' | 'paper' | 'small_live' | 'scale';
    paper_mode: boolean;
  };
  account: AlpacaAccount;
  positions: AlpacaPosition[];
  /** Today's agent_orders rows, used for daily-gross sum. */
  todayOrders: PriorOrderSummary[];
  now: Date;
}

export type GuardrailDecision =
  | { outcome: 'approved'; notional: number; size_pct: number }
  | {
      outcome: 'requires_approval';
      kind: 'oversize_ticket';
      reason: string;
      notional: number;
      size_pct: number;
    }
  | { outcome: 'rejected'; reason: string }
  /** Proposal is clean but the market is closed (premarket/weekend tick).
   *  Caller should queue it for the agent-queue-flush pass at the next open
   *  instead of dropping it — the premarket tick used to lose every proposal
   *  to a market-hours rejection. */
  | { outcome: 'deferred'; reason: string; notional: number; size_pct: number };

// ————— helpers —————

function etTimeMinutes(now: Date): { minutes: number; weekday: string } {
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
  return { minutes: hour * 60 + minute, weekday };
}

export function isInMarketHours(now: Date): boolean {
  const { minutes, weekday } = etTimeMinutes(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= CAPS.marketOpenMinutes && minutes <= CAPS.marketCutoffMinutes;
}

/** Positions for this underlying — includes equity position plus any options
 *  with OCC symbols prefixed by the underlying. */
function positionsForTicker(positions: AlpacaPosition[], ticker: string): AlpacaPosition[] {
  return positions.filter(
    (p) => p.symbol === ticker || (p.asset_class === 'us_option' && p.symbol.startsWith(ticker)),
  );
}

function existingNotional(positions: AlpacaPosition[], ticker: string): number {
  return positionsForTicker(positions, ticker).reduce(
    (s, p) => s + Math.abs(p.market_value),
    0,
  );
}

// ————— main —————

export function validateTrade(p: Proposal, ctx: GuardrailContext): GuardrailDecision {
  const { config, account, positions, todayOrders, now } = ctx;

  // Halted — nothing moves except the resume approval itself, which doesn't
  // come through this path.
  if (config.halted) {
    return {
      outcome: 'rejected',
      reason: `agent halted: ${config.halt_reason ?? 'unknown reason'}`,
    };
  }

  // Shadow phase: signal-only mode — no orders should be reaching this function.
  // Fail loudly instead of silently submitting.
  if (config.phase === 'shadow') {
    return { outcome: 'rejected', reason: 'phase=shadow: agent is in signal-only mode' };
  }

  // Actions that don't emit an order — shouldn't be validated here.
  if (p.action === 'hold' || p.action === 'unwind_all') {
    return {
      outcome: 'rejected',
      reason: `action ${p.action} should not be sent through validateTrade (handled at execution layer)`,
    };
  }

  // Whitelist defense-in-depth. Filter.ts annotates but doesn't reject; here we reject.
  if (!WHITELIST_SET.has(p.ticker)) {
    return { outcome: 'rejected', reason: `off-whitelist ticker: ${p.ticker}` };
  }

  // Account status checks from Alpaca
  if (account.trading_blocked || account.account_blocked) {
    return { outcome: 'rejected', reason: 'Alpaca account blocked or trading disabled' };
  }

  // ————— compute notional —————
  const equity = account.equity;
  if (equity <= 0) {
    return { outcome: 'rejected', reason: 'account equity <= 0' };
  }

  let notional: number;
  if (p.action === 'open' || p.action === 'add') {
    const pct = NEW_POSITION_SIZE_PCT[p.size_hint] ?? 1;
    notional = (equity * pct) / 100;
  } else if (p.action === 'trim' || p.action === 'close') {
    const existing = positionsForTicker(positions, p.ticker);
    if (existing.length === 0) {
      return {
        outcome: 'rejected',
        reason: `trim/close on ${p.ticker} but no open position found`,
      };
    }
    const existingValue = existing.reduce((s, pos) => s + Math.abs(pos.market_value), 0);
    const fraction = p.action === 'close' ? 1 : TRIM_FRACTION[p.size_hint] ?? 1 / 3;
    notional = existingValue * fraction;
  } else if (p.action === 'roll') {
    // Rolls are notional-neutral end-to-end (sell old, buy new). Treat as
    // existing position size for cap purposes.
    notional = existingNotional(positions, p.ticker);
    if (notional === 0) {
      return { outcome: 'rejected', reason: `roll on ${p.ticker} but no open position to roll` };
    }
  } else {
    return { outcome: 'rejected', reason: `unhandled action: ${p.action}` };
  }

  const sizePct = (notional / equity) * 100;

  // ————— caps —————

  // Per-ticket: > 5% requires owner approval (not rejection — it can be the
  // right call occasionally)
  if (sizePct > CAPS.perTicketMaxPct) {
    return {
      outcome: 'requires_approval',
      kind: 'oversize_ticket',
      reason: `ticket ${sizePct.toFixed(1)}% exceeds ${CAPS.perTicketMaxPct}% per-ticket cap`,
      notional,
      size_pct: sizePct,
    };
  }

  // Single-name cap: existing single-name exposure + this new notional
  if (p.action === 'open' || p.action === 'add') {
    const existing = existingNotional(positions, p.ticker);
    const newTotal = existing + notional;
    const newPct = (newTotal / equity) * 100;
    if (newPct > CAPS.singleNameMaxPct) {
      return {
        outcome: 'rejected',
        reason: `would exceed ${CAPS.singleNameMaxPct}% single-name cap for ${p.ticker}: existing $${existing.toFixed(0)} + new $${notional.toFixed(0)} = ${newPct.toFixed(1)}%`,
      };
    }
  }

  // Daily gross: sum of today's submitted notionals + this one
  const todayGross = todayOrders
    .filter((o) => o.status !== 'rejected' && o.status !== 'canceled')
    .reduce((s, o) => s + (o.notional_usd ?? 0), 0);
  const newGrossPct = ((todayGross + notional) / equity) * 100;
  if (newGrossPct > CAPS.dailyGrossMaxPct) {
    return {
      outcome: 'rejected',
      reason: `would exceed ${CAPS.dailyGrossMaxPct}% daily gross: today $${todayGross.toFixed(0)} + new $${notional.toFixed(0)} = ${newGrossPct.toFixed(1)}%`,
    };
  }

  // Max open option tickets
  if (p.instrument !== 'equity' && (p.action === 'open' || p.action === 'add')) {
    const openOptions = positions.filter((pos) => pos.asset_class === 'us_option').length;
    const pendingOptions = todayOrders.filter(
      (o) =>
        o.instrument !== 'equity' &&
        (o.status === 'queued' || o.status === 'submitted'),
    ).length;
    if (openOptions + pendingOptions >= CAPS.maxOptionTickets) {
      return {
        outcome: 'rejected',
        reason: `${CAPS.maxOptionTickets} open option tickets (max) — close one before adding another`,
      };
    }
  }

  // Market hours — checked LAST so a clean proposal outside the window
  // (premarket tick, weekly Monday 8am tick) defers to the queue-flush pass
  // at the open instead of being rejected. Cap violations above still reject
  // immediately regardless of clock.
  if (!isInMarketHours(now)) {
    return {
      outcome: 'deferred',
      reason: 'outside trading window (09:30–15:55 ET) — queued for market open',
      notional,
      size_pct: sizePct,
    };
  }

  return { outcome: 'approved', notional, size_pct: sizePct };
}
