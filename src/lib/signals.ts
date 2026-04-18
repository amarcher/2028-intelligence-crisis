// Phase-Flip Signal computation — shared between the React panel and the
// agent-tick Edge Function. Kept as pure TypeScript (no React, no Vite imports)
// so Deno can consume it too.

import type { DataPoint, SaaSDataPoint, VerdictType } from './types';

export type SignalState = 'fired' | 'pending';

export type SignalKey = 'jolts' | 'claims' | 'saas' | 'sp500' | 'housing';

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
  // Hit 7,500+ and failed to make a new high in 2+ monthly prints.
  const nonNull = data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
  if (nonNull.length === 0) return { fired: false, reading: '—' };
  let maxIdx = 0;
  for (let i = 0; i < nonNull.length; i++) {
    if (nonNull[i].value > nonNull[maxIdx].value) maxIdx = i;
  }
  const peak = nonNull[maxIdx].value;
  const latest = nonNull[nonNull.length - 1].value;
  const monthsSincePeak = nonNull.length - 1 - maxIdx;
  const fired = peak >= 7500 && monthsSincePeak >= 2 && latest < peak;
  return { fired, reading: `peak ${Math.round(peak)} · now ${Math.round(latest)}` };
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
    label: 'JOLTS BREAKDOWN',
    threshold: '< 6.00M for 2 prints',
    note: 'Labor demand collapse — leading indicator for white-collar cuts',
  },
  claims: {
    label: 'CLAIMS SPIKE',
    threshold: '4-wk avg > 300K',
    note: 'First hard evidence of white-collar layoff wave',
  },
  saas: {
    label: 'SaaS GUIDE-DOWN',
    threshold: 'NOW & WDAY both < 14%',
    note: 'Systems-of-record slip confirms build-vs-buy shift',
  },
  sp500: {
    label: 'S&P PEAK STALL',
    threshold: 'peak ≥ 7,500 + 2mo below',
    note: 'Bubble-leg topping — time to flip to short book',
  },
  housing: {
    label: 'HOUSING ROLL',
    threshold: 'Case-Shiller YoY < 0%',
    note: 'Tech-hub housing contagion feeds bank & CRE tail',
  },
};

const PLAYBOOK_PHASE1 =
  'Hold the setup: keep cheap long-dated SaaS LEAPS puts (NOW/CRM/HUBS/WDAY/DDOG, Jan-27/28), carry TLT + GLD + XLP as counterfactual hedges, ride small QQQ/SMH longs for the bubble leg, and wait for ≥2 signals before deploying the short book.';

const PLAYBOOK_PHASE2 =
  'Flip the book: close AI-euphoria longs, roll SaaS LEAPS to 3–6mo near-dated puts, add SPY/QQQ put spreads, layer credit shorts (HYG, KRE). Keep 15–20% dry powder for bear rallies.';

export function computeSignals(input: SignalsInput): SignalsResult {
  const evaluated: Record<SignalKey, { fired: boolean; reading: string }> = {
    jolts: evalJolts(input.jolts),
    claims: evalClaims(input.claims),
    saas: evalSaas(input.saas),
    sp500: evalSp500(input.sp500),
    housing: evalHousing(input.caseShiller),
  };

  const order: SignalKey[] = ['jolts', 'claims', 'saas', 'sp500', 'housing'];
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
  const phaseLabel = flipped ? 'PHASE 2 · INFLECTION' : 'PHASE 1 · COUNTERFACTUAL GRIND';
  const verdict: VerdictType =
    firedCount >= 4 ? 'confirmed' : firedCount >= 2 ? 'trending' : 'early';
  const playbook = flipped ? PLAYBOOK_PHASE2 : PLAYBOOK_PHASE1;

  return { signals, firedCount, phase, phaseLabel, verdict, playbook };
}
