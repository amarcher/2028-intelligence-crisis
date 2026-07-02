// Phase-Flip Signal computation — shared between the React panel and the
// agent-tick Edge Function. Kept as pure TypeScript (no React, no Vite imports)
// so Deno can consume it too.

import type { DataPoint, SaaSDataPoint, VerdictType } from './types';

export type SignalState = 'fired' | 'pending';

export type SignalKey = 'jolts' | 'claims' | 'saas' | 'sp500' | 'housing' | 'credit';

export interface Signal {
  key: SignalKey;
  label: string;
  state: SignalState;
  reading: string;
  threshold: string;
  note: string;
}

export type Phase = 'counterfactual_grind' | 'inflection';

export interface SignalsInput {
  jolts: DataPoint[];
  claims: DataPoint[];
  sp500: DataPoint[];
  caseShiller: DataPoint[];
  saas: SaaSDataPoint[];
  /** ICE BofA US High Yield OAS (FRED BAMLH0A0HYM2), daily, in percent.
   *  Optional so older callers degrade to a pending '—' reading. */
  hyOas?: DataPoint[];
}

export interface SignalsResult {
  signals: Signal[];
  firedCount: number;
  phase: Phase;
  phaseLabel: string;
  verdict: VerdictType;
  playbook: string;
}

// ——— helpers ———

export function lastNonNull(data: DataPoint[]): DataPoint | null {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value != null) return data[i];
  }
  return null;
}

export function lastNNonNull(data: DataPoint[], n: number): DataPoint[] {
  const out: DataPoint[] = [];
  for (let i = data.length - 1; i >= 0 && out.length < n; i--) {
    if (data[i].value != null) out.unshift(data[i]);
  }
  return out;
}

export function yoyPct(data: DataPoint[]): number | null {
  const last = lastNonNull(data);
  if (!last || last.value == null) return null;
  const [ly, lm] = last.date.slice(0, 7).split('-').map(Number);
  const targetPrefix = `${ly - 1}-${String(lm).padStart(2, '0')}`;
  const prior = data.find((d) => d.date.startsWith(targetPrefix) && d.value != null);
  if (!prior || prior.value == null) return null;
  return ((last.value - prior.value) / prior.value) * 100;
}

function fmtThousands(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)}M` : `${Math.round(v)}K`;
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

function latestSaaSField(
  data: SaaSDataPoint[],
  field: 'servicenow' | 'workday',
): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = data[i][field];
    if (v != null) return v;
  }
  return null;
}

// ——— individual triggers ———
// Each returns { fired, reading } so the caller composes the full Signal object.
// Exported individually for unit testing.

export function evalJolts(data: DataPoint[]) {
  const last2 = lastNNonNull(data, 2);
  const fired = last2.length === 2 && last2.every((d) => (d.value ?? Infinity) < 6000);
  const latest = lastNonNull(data);
  const reading = latest?.value != null ? fmtThousands(latest.value) : '—';
  return { fired, reading };
}

export function evalClaims(data: DataPoint[]) {
  const last4 = lastNNonNull(data, 4);
  const avg =
    last4.length > 0
      ? last4.reduce((s, d) => s + (d.value ?? 0), 0) / last4.length
      : null;
  const fired = avg != null && avg > 300_000;
  const reading = avg != null ? `${Math.round(avg / 1000)}K` : '—';
  return { fired, reading };
}

export function evalSaas(data: SaaSDataPoint[]) {
  // Require both ServiceNow AND Workday to slip below 14% — stricter proxy for
  // a systemic "guide-cut" regime since dashboard lacks guidance data.
  const now = latestSaaSField(data, 'servicenow');
  const wday = latestSaaSField(data, 'workday');
  const fired = now != null && wday != null && now < 14 && wday < 14;
  const reading = `NOW ${fmtPct(now)} · WDAY ${fmtPct(wday)}`;
  return { fired, reading };
}

export function evalSp500(data: DataPoint[]) {
  // Hit 7,500+ and failed to make a new high for 2+ calendar months.
  // Measured in DAYS between the peak print's date and the latest print's
  // date — NOT in array positions. The series cadence has changed over time
  // (weekly → daily), and counting prints once fired this trigger three weeks
  // after an all-time high because three weekly prints looked like "3 months".
  const nonNull = data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
  if (nonNull.length === 0) return { fired: false, reading: '—' };
  let maxIdx = 0;
  for (let i = 0; i < nonNull.length; i++) {
    if (nonNull[i].value > nonNull[maxIdx].value) maxIdx = i;
  }
  const peak = nonNull[maxIdx].value;
  const latest = nonNull[nonNull.length - 1].value;
  const daysSincePeak =
    (Date.parse(nonNull[nonNull.length - 1].date) - Date.parse(nonNull[maxIdx].date)) / 86_400_000;
  const fired = peak >= 7500 && daysSincePeak >= 60 && latest < peak;
  return {
    fired,
    reading: `peak ${Math.round(peak)} (${nonNull[maxIdx].date.slice(0, 10)}) · now ${Math.round(latest)}`,
  };
}

export function evalCredit(data: DataPoint[] | undefined) {
  // Credit stress (panel decision D9, adapted): high-yield spreads must show a
  // REAL widening episode — OAS at least 3.5% AND at least 100bps above its
  // trailing-90-day low — and hold it for 5 consecutive daily prints. The
  // 5-session persistence requirement is D9's higher bar; the KRE/IYR leg of
  // D9 lives in the fast layer's creditStress20d momentum (not FRED data).
  if (!data || data.length === 0) return { fired: false, reading: '—' };
  const nonNull = data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
  if (nonNull.length < 5) return { fired: false, reading: '—' };

  const latest = nonNull[nonNull.length - 1];
  const cutoff = Date.parse(latest.date) - 90 * 86_400_000;
  const window = nonNull.filter((d) => Date.parse(d.date) >= cutoff);
  const low90 = Math.min(...window.map((d) => d.value));

  const stressed = (v: number) => v >= 3.5 && v >= low90 + 1.0;
  const last5 = nonNull.slice(-5);
  const fired = last5.every((d) => stressed(d.value));

  return {
    fired,
    reading: `OAS ${latest.value.toFixed(2)}% · 90d low ${low90.toFixed(2)}%`,
  };
}

export function evalHousing(data: DataPoint[]) {
  // Case-Shiller national YoY turns negative. Proxy for regional roll —
  // SF/Seattle not tracked separately in the dashboard.
  const yoy = yoyPct(data);
  const fired = yoy != null && yoy < 0;
  const reading =
    yoy != null ? `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}% YoY` : '—';
  return { fired, reading };
}

// ——— main ———

const SIGNAL_META: Record<SignalKey, { label: string; threshold: string; note: string }> = {
  jolts: {
    label: 'JOB OPENINGS DROP',
    threshold: 'below 6.00M two months in a row',
    note: 'Companies posting fewer jobs — usually shows up before layoffs do',
  },
  claims: {
    label: 'UNEMPLOYMENT FILINGS RISE',
    threshold: '4-week average above 300K',
    note: 'First hard proof that the layoff wave is here',
  },
  saas: {
    label: 'SOFTWARE GROWTH SLOWDOWN',
    threshold: 'ServiceNow & Workday both below 14% growth',
    note: 'When the biggest enterprise software companies slow, it shows AI is replacing software spend',
  },
  sp500: {
    label: 'STOCK MARKET STALLS NEAR PEAK',
    threshold: 'S&P 500 hit 7,500+ then no new high for 2 months',
    note: "The bull run is running out of steam — time to start positioning for a downturn",
  },
  credit: {
    label: 'BOND MARKET STRESS',
    threshold: 'junk-bond risk premium ≥ 3.5% and up 1+ point off its 3-month low, 5 days running',
    note: 'When lenders demand much more to hold risky company debt, credit is drying up — the contagion phase is near',
  },
  housing: {
    label: 'HOME PRICES FALLING',
    threshold: 'Case-Shiller national down year-over-year',
    note: 'Falling home prices ripple into banks and commercial real estate',
  },
};

const PLAYBOOK_PHASE1 =
  "Stay defensive while we wait. Hold long-dated put options on the big software companies (NOW, CRM, HUBS, WDAY, DDOG, expiring Jan 2027 / Jan 2028) — these pay off if those stocks fall. Hold safe-haven positions in bonds (TLT), gold (GLD), and consumer staples (XLP). Keep small AI-stock holdings (QQQ, SMH) so we don't miss the last leg up. Don't make aggressive bets against the market until at least 2 of the 5 economic readings cross their danger lines.";

const PLAYBOOK_PHASE2 =
  "Switch to action mode. Sell the AI-stock holdings. Replace the long-dated software put options with shorter, more aggressive ones (3–6 months out). Add bear bets on the broader market (SPY, QQQ put spreads), and on commercial real estate and junk bonds (HYG, KRE). Keep 15–20% in cash so we can take advantage of bear-market rallies.";

export function computeSignals(input: SignalsInput): SignalsResult {
  const evaluated: Record<SignalKey, { fired: boolean; reading: string }> = {
    jolts: evalJolts(input.jolts),
    claims: evalClaims(input.claims),
    saas: evalSaas(input.saas),
    sp500: evalSp500(input.sp500),
    housing: evalHousing(input.caseShiller),
    credit: evalCredit(input.hyOas),
  };

  const order: SignalKey[] = ['jolts', 'claims', 'saas', 'sp500', 'housing', 'credit'];
  const signals: Signal[] = order.map((key) => ({
    key,
    label: SIGNAL_META[key].label,
    state: evaluated[key].fired ? 'fired' : 'pending',
    reading: evaluated[key].reading,
    threshold: SIGNAL_META[key].threshold,
    note: SIGNAL_META[key].note,
  }));

  const firedCount = signals.filter((s) => s.state === 'fired').length;
  const flipped = firedCount >= 2;
  const phase: Phase = flipped ? 'inflection' : 'counterfactual_grind';
  const phaseLabel = flipped ? 'PHASE 2 · ACTION' : 'PHASE 1 · WAITING';
  const verdict: VerdictType =
    firedCount >= 4 ? 'confirmed' : firedCount >= 2 ? 'trending' : 'early';
  const playbook = flipped ? PLAYBOOK_PHASE2 : PLAYBOOK_PHASE1;

  return { signals, firedCount, phase, phaseLabel, verdict, playbook };
}
