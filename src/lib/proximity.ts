// Trigger Proximity Index — distance-to-threshold × velocity → ETA per
// phase-flip trigger. Pure TypeScript (no React/Vite imports) so the
// dashboard and the Deno edge functions share one implementation, like
// signals.ts. This is the "delayed realization" early-warning gauge: at the
// current 3-month pace, when does each domino fall?

import type { DataPoint, SaaSDataPoint } from './types';
import { lastNonNull, yoyPct } from './signals.ts';

export interface TriggerProximity {
  key: 'jolts' | 'claims' | 'saas' | 'sp500' | 'housing' | 'credit';
  label: string;
  current: number | null;
  threshold: number;
  /** 'falling' = trigger fires when the reading drops below threshold. */
  direction: 'falling' | 'rising';
  /** How far along toward the threshold, 0–100+. 100 = at/over the line. */
  progressPct: number | null;
  /** Months until crossing at the trailing-90-day pace. Null = moving away
   *  from the threshold, no data, or not a trending metric. */
  etaMonths: number | null;
  note: string;
}

function valueDaysAgo(data: DataPoint[], days: number): number | null {
  const last = lastNonNull(data);
  if (!last) return null;
  const target = Date.parse(last.date) - days * 86_400_000;
  let best: DataPoint | null = null;
  for (const d of data) {
    if (d.value == null) continue;
    if (Date.parse(d.date) <= target) best = d;
    else break;
  }
  return best?.value ?? null;
}

function trendEta(
  current: number | null,
  past: number | null,
  threshold: number,
  direction: 'falling' | 'rising',
  lookbackDays: number,
): number | null {
  if (current == null || past == null) return null;
  const perMonth = ((current - past) / lookbackDays) * 30;
  const gap = direction === 'falling' ? current - threshold : threshold - current;
  if (gap <= 0) return 0; // already crossed
  const towardPerMonth = direction === 'falling' ? -perMonth : perMonth;
  if (towardPerMonth <= 0) return null; // moving away or flat
  return Math.round((gap / towardPerMonth) * 10) / 10;
}

function progress(
  current: number | null,
  start: number,
  threshold: number,
  direction: 'falling' | 'rising',
): number | null {
  if (current == null) return null;
  const total = direction === 'falling' ? start - threshold : threshold - start;
  const done = direction === 'falling' ? start - current : current - start;
  if (total <= 0) return null;
  return Math.round(Math.max(0, (done / total) * 100));
}

export interface ProximityInput {
  jolts: DataPoint[];
  claims: DataPoint[];
  caseShiller: DataPoint[];
  hyOas?: DataPoint[];
  saas: SaaSDataPoint[];
  sp500Fired: boolean;
}

export function computeProximity(input: ProximityInput): TriggerProximity[] {
  const out: TriggerProximity[] = [];

  // JOLTS: below 6.0M. Progress measured from a 8.0M reference ceiling.
  const joltsNow = lastNonNull(input.jolts)?.value ?? null;
  out.push({
    key: 'jolts',
    label: 'Job openings',
    current: joltsNow,
    threshold: 6000,
    direction: 'falling',
    progressPct: progress(joltsNow, 8000, 6000, 'falling'),
    etaMonths: trendEta(joltsNow, valueDaysAgo(input.jolts, 90), 6000, 'falling', 90),
    note: 'openings must fall below 6.0M',
  });

  // Claims: 4-week average above 300K. Reference floor 200K.
  const last4 = input.claims.filter((d) => d.value != null).slice(-4);
  const claimsAvg = last4.length > 0 ? last4.reduce((s, d) => s + (d.value ?? 0), 0) / last4.length : null;
  out.push({
    key: 'claims',
    label: 'Unemployment filings',
    current: claimsAvg,
    threshold: 300_000,
    direction: 'rising',
    progressPct: progress(claimsAvg, 200_000, 300_000, 'rising'),
    etaMonths: trendEta(claimsAvg, valueDaysAgo(input.claims, 90), 300_000, 'rising', 90),
    note: '4-week average must rise above 300K',
  });

  // SaaS: NOW AND WDAY both below 14%. ETA = the laggard's ETA.
  const saasField = (field: 'servicenow' | 'workday'): DataPoint[] =>
    input.saas
      .filter((r) => r[field] != null)
      .map((r) => ({ date: r.date, value: r[field] as number }));
  const nowSeries = saasField('servicenow');
  const wdaySeries = saasField('workday');
  const nowVal = lastNonNull(nowSeries)?.value ?? null;
  const wdayVal = lastNonNull(wdaySeries)?.value ?? null;
  const nowEta = trendEta(nowVal, valueDaysAgo(nowSeries, 365), 14, 'falling', 365);
  const wdayEta = trendEta(wdayVal, valueDaysAgo(wdaySeries, 365), 14, 'falling', 365);
  const worst = nowVal != null && wdayVal != null ? Math.max(nowVal, wdayVal) : nowVal ?? wdayVal;
  out.push({
    key: 'saas',
    label: 'Software growth',
    current: worst,
    threshold: 14,
    direction: 'falling',
    progressPct: progress(worst, 25, 14, 'falling'),
    etaMonths:
      nowEta == null || wdayEta == null ? null : Math.max(nowEta, wdayEta),
    note: 'ServiceNow AND Workday growth below 14% (slower of the two shown)',
  });

  // S&P peak stall: binary/pattern trigger — no trend ETA.
  out.push({
    key: 'sp500',
    label: 'Market stall',
    current: null,
    threshold: 7500,
    direction: 'falling',
    progressPct: input.sp500Fired ? 100 : null,
    etaMonths: input.sp500Fired ? 0 : null,
    note: 'pattern trigger (7,500+ then 2 months without a new high) — no pace estimate',
  });

  // Housing: Case-Shiller YoY below 0. Reference start +5%.
  const housingYoy = yoyPct(input.caseShiller);
  const housingPast = (() => {
    const cutoffIdx = input.caseShiller.length - 4; // ~3 monthly prints back
    return cutoffIdx > 12 ? yoyPct(input.caseShiller.slice(0, cutoffIdx)) : null;
  })();
  out.push({
    key: 'housing',
    label: 'Home prices',
    current: housingYoy,
    threshold: 0,
    direction: 'falling',
    progressPct: progress(housingYoy, 5, 0, 'falling'),
    etaMonths: trendEta(housingYoy, housingPast, 0, 'falling', 90),
    note: 'year-over-year change must turn negative',
  });

  // Credit: OAS ≥ 3.5%. Reference floor 2.5%.
  const oasNow = input.hyOas ? lastNonNull(input.hyOas)?.value ?? null : null;
  out.push({
    key: 'credit',
    label: 'Bond-market stress',
    current: oasNow,
    threshold: 3.5,
    direction: 'rising',
    progressPct: progress(oasNow, 2.5, 3.5, 'rising'),
    etaMonths: input.hyOas ? trendEta(oasNow, valueDaysAgo(input.hyOas, 90), 3.5, 'rising', 90) : null,
    note: 'junk-bond risk premium must rise to 3.5% (plus a widening episode)',
  });

  return out;
}
