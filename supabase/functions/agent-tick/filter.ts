// Soft-guardrail filter: annotate proposals that violate the playbook rules
// WITHOUT dropping them. The whole point is to surface what Claude tried to
// say when it misbehaves, not hide it. Violations ride through as filter_flags
// on the proposal and the UI renders them as a warning pill.

import type { Proposal } from './reasoner.ts';

// Canonical whitelist. Shared with the system prompt in reasoner.ts so the
// two sources of truth can't drift.
export const WHITELIST = [
  // Phase-1 longs (AI bubble ride)
  'QQQ', 'SMH', 'IGV', 'NVDA', 'AVGO', 'ORCL', 'ANET', 'VRT', 'CEG',
  'MSFT', 'GOOGL', 'META',
  // Defensive carry
  'TLT', 'GLD', 'IAU', 'XLP', 'KO', 'PG', 'COST', 'WMT',
  // Asymmetric SaaS put thesis
  'NOW', 'CRM', 'HUBS', 'WDAY', 'DDOG', 'FRSH',
  // Credit + CRE shorts
  'KRE', 'HYG', 'JNK', 'IYR', 'VNQ', 'BXP', 'SLG',
  // Housing roll
  'ITB', 'XHB', 'OPEN', 'Z', 'RDFN',
  // Consumer / staffing shorts
  'XLY', 'RH', 'W', 'CCL', 'NCLH', 'UPWK', 'FIVN',
  // Indices + vol
  'SPY', 'IWM', 'VIXY',
  // Tactical inverse (paper-only archetype; guardrails cap at 2% + 5-day
  // time stop — see guardrails.TACTICAL_INVERSE_TICKERS)
  'SQQQ', 'SPXS',
] as const;

const WHITELIST_SET = new Set<string>(WHITELIST);

// SaaS short-thesis names — DTE < 30 on puts here is against the playbook
// (force LEAPS or 3-6 month minimum in Phase 1). DDOG removed: it's an
// AI-infrastructure winner, no longer part of the short set.
const SAAS_SHORTS = new Set(['NOW', 'CRM', 'HUBS', 'WDAY', 'FRSH']);

// Leveraged inverse ETFs — allowed only with explicit tactical justification.
// Not on whitelist, so they'd also fail that check; explicit flag gives a
// clearer reason in the digest than a bare "off-whitelist".
const LEVERAGED_INVERSE = new Set(['SPXS', 'SQQQ', 'SRTY', 'TZA', 'SPXU', 'SDOW']);

// Matches "Jan 2027", "January 2027", "Jan '27", "01/2027".
const EXPIRY_LONG = /^([A-Za-z]{3,9})\s+(?:'?(\d{2}|\d{4}))$/;
const EXPIRY_NUMERIC = /^(\d{1,2})[/-](\d{2}|\d{4})$/;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

/** Rough days-until-expiry. Options typically expire the 3rd Friday; we
 *  approximate with the 15th of the month. Returns null for unparseable
 *  expirations so a bad string doesn't false-flag. */
export function daysUntilExpiry(expiry: string | null | undefined, now = new Date()): number | null {
  if (!expiry) return null;
  const trimmed = expiry.trim();

  let month: number | null = null;
  let year: number | null = null;

  const longMatch = trimmed.match(EXPIRY_LONG);
  if (longMatch) {
    const mo = MONTHS[longMatch[1].toLowerCase()];
    if (mo == null) return null;
    month = mo;
    const yr = parseInt(longMatch[2], 10);
    year = yr < 100 ? 2000 + yr : yr;
  } else {
    const numericMatch = trimmed.match(EXPIRY_NUMERIC);
    if (numericMatch) {
      month = parseInt(numericMatch[1], 10) - 1;
      const yr = parseInt(numericMatch[2], 10);
      year = yr < 100 ? 2000 + yr : yr;
    }
  }

  if (month == null || year == null || month < 0 || month > 11) return null;

  const expiryMs = Date.UTC(year, month, 15);
  return Math.floor((expiryMs - now.getTime()) / 86_400_000);
}

/** Rationale heuristic for leveraged inverse ETFs — must name the trade
 *  as tactical / short-duration / post-inflection. Empty/vague rationales
 *  fail. */
function rationaleJustifiesLeveraged(rationale: string): boolean {
  return /tactical|short[- ]?duration|3[- ]?5\s*day|post[- ]?inflection|brief/i.test(
    rationale,
  );
}

/** Mutates nothing; returns a (possibly new) proposal with filter_flags
 *  populated if any violations are present. Proposals without violations
 *  come back untouched so the JSON is compact. */
export function annotateProposal(p: Proposal, now = new Date()): Proposal {
  const flags: string[] = [];

  // Hold + unwind_all are meta-actions that can reference a sentinel ticker
  // (SPY is common) without needing whitelist clearance — they signal narrative
  // state, not a trade.
  const bypassWhitelist = p.action === 'hold' || p.action === 'unwind_all';

  if (!bypassWhitelist && !WHITELIST_SET.has(p.ticker)) {
    flags.push(`off-whitelist ticker: ${p.ticker}`);
  }

  // Leveraged inverse ETFs — explicit flag even if also off-whitelist.
  if (LEVERAGED_INVERSE.has(p.ticker) && !rationaleJustifiesLeveraged(p.rationale)) {
    flags.push('leveraged inverse ETF without tactical justification');
  }

  // Single-name SaaS put thesis should be LEAPS or 3–6mo minimum in Phase 1.
  const isPutInstr = p.instrument === 'put' || p.instrument === 'put_spread';
  if (isPutInstr && SAAS_SHORTS.has(p.ticker)) {
    const dte = daysUntilExpiry(p.expiry, now);
    if (dte != null && dte >= 0 && dte < 30) {
      flags.push(`DTE < 30 on single-name SaaS short thesis (${p.expiry}, ~${dte}d)`);
    }
  }

  if (flags.length === 0) return p;
  return { ...p, filter_flags: flags };
}

export function annotateProposals(proposals: Proposal[], now = new Date()): Proposal[] {
  return proposals.map((p) => annotateProposal(p, now));
}
