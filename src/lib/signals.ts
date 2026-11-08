// Phase-Flip Signal computation — shared between the React panel and the
// agent-tick Edge Function. Kept as pure TypeScript (no React, no Vite imports)
// so Deno can consume it too.

import type { DataPoint, SaaSDataPoint, VerdictType } from './types.ts';
import { fresh, observationDate } from './evidence.ts';

export type SignalState = 'fired' | 'pending' | 'unknown';

export type SignalKey = 'jolts' | 'claims' | 'saas' | 'sp500' | 'housing' | 'credit';

export interface Signal {
  key: SignalKey;
  label: string;
  state: SignalState;
  reading: string;
  threshold: string;
  note: string;
  asOf?: string | null;
  qualityIssue?: string | null;
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
  now?: Date;
}

export interface SignalsResult {
  signals: Signal[];
  firedCount: number;
  unknownCount: number;
  phase: Phase;
  phaseLabel: string;
  verdict: VerdictType;
  playbook: string;
}

// ——— helpers ———

export function lastNonNull(data: DataPoint[]): DataPoint | null {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value != null && Number.isFinite(data[i].value)) return data[i];
  }
  return null;
}

export function lastNNonNull(data: DataPoint[], n: number): DataPoint[] {
  const out: DataPoint[] = [];
  for (let i = data.length - 1; i >= 0 && out.length < n; i--) {
    if (data[i].value != null && Number.isFinite(data[i].value)) out.unshift(data[i]);
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
    last4.length === 4
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
    if (nonNull[i].value >= nonNull[maxIdx].value) maxIdx = i;
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
    note: 'A sustained increase would support broader labor-market deterioration',
  },
  saas: {
    label: 'SOFTWARE GROWTH SLOWDOWN',
    threshold: 'ServiceNow & Workday both below 14% growth',
    note: 'Revenue growth is a proxy, not proof that AI is replacing software spending',
  },
  sp500: {
    label: 'STOCK MARKET STALLS NEAR PEAK',
    threshold: 'S&P 500 hit 7,500+ then no new high for 2 months',
    note: "A sustained stall is a market-pattern observation, not an instruction to trade",
  },
  credit: {
    label: 'BOND MARKET STRESS',
    threshold: 'junk-bond risk premium ≥ 3.5% and up 1+ point off its 3-month low, 5 days running',
    note: 'Persistent spread widening can indicate credit stress; it does not establish a contagion forecast',
  },
  housing: {
    label: 'HOME PRICES FALLING',
    threshold: 'Case-Shiller national down year-over-year',
    note: 'Falling home prices ripple into banks and commercial real estate',
  },
};

const PLAYBOOK_PHASE1 = 'Research regime: fewer than two verified triggers. This does not describe holdings or authorize trades. Review relative SaaS performance, revenue growth and disconfirming evidence alongside the slow macro readings.';
const PLAYBOOK_PHASE2 = 'Research regime: at least two verified triggers. Review the evidence and existing approval rules; a regime change is not an executed trade.';

function quality(input: SignalsInput, key: SignalKey): { asOf: string | null; qualityIssue: string | null } {
  const now = input.now ?? new Date();
  if (key === 'saas') {
    const rows = ['servicenow', 'workday'].map(field => [...input.saas].reverse().find(r => r[field as 'servicenow' | 'workday'] != null));
    const dates = rows.map(r => r?.date).filter((d): d is string => !!d).sort();
    return { asOf: dates[0] ?? null, qualityIssue: rows.some(r => !r || !fresh(r.date, 180, now)) ? 'Both company observations must be available and no more than 180 days old' : null };
  }
  const series = { jolts: input.jolts, claims: input.claims, sp500: input.sp500, housing: input.caseShiller, credit: input.hyOas ?? [] }[key];
  const count = { jolts: 2, claims: 4, sp500: 1, housing: 1, credit: 5 }[key];
  const maxAge = { jolts: 100, claims: 21, sp500: 7, housing: 130, credit: 7 }[key];
  const rows = lastNNonNull(series, count);
  const asOf = rows.at(-1)?.date ?? null;
  let qualityIssue: string | null = null;
  if (rows.length < count) qualityIssue = `Need ${count} observations`;
  else if (!fresh(asOf ?? undefined, maxAge, now)) qualityIssue = `Missing, future-dated or older than ${maxAge} days`;
  else if (key === 'housing' && yoyPct(series) == null) qualityIssue = 'Missing year-earlier comparison';
  else if (count > 1) {
    const maxGap = key === 'jolts' ? 35 : key === 'claims' ? 8 : 4;
    const minGap = key === 'jolts' ? 28 : key === 'claims' ? 6 : 1;
    if (rows.slice(1).some((r,i) => { const gap = (observationDate(r.date) - observationDate(rows[i].date)) / 86_400_000; return gap > maxGap || gap < minGap; })) qualityIssue = 'Observations are not consecutive at the expected cadence';
  }
  return { asOf, qualityIssue };
}

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
  const signals: Signal[] = order.map((key) => {
    const health = quality(input, key);
    return { key, ...SIGNAL_META[key], ...health,
      state: health.qualityIssue ? 'unknown' : evaluated[key].fired ? 'fired' : 'pending',
      reading: evaluated[key].reading };
  });

  const firedCount = signals.filter((s) => s.state === 'fired').length;
  const flipped = firedCount >= 2;
  const phase: Phase = flipped ? 'inflection' : 'counterfactual_grind';
  const unknownCount = signals.filter(s => s.state === 'unknown').length;
  const phaseLabel = unknownCount ? 'INCOMPLETE DATA · RESEARCH ONLY' : flipped ? 'PHASE 2 · TRIGGERS CROSSED' : 'PHASE 1 · WAITING';
  const verdict: VerdictType =
    firedCount >= 4 ? 'confirmed' : firedCount >= 2 ? 'trending' : 'early';
  const playbook = flipped ? PLAYBOOK_PHASE2 : PLAYBOOK_PHASE1;

  return { signals, firedCount, unknownCount, phase, phaseLabel, verdict, playbook };
}
