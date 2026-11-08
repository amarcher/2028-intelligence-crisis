import type { SaaSDataPoint } from './types.ts';

export const EVIDENCE_VERSION = '2026-11-08-v2';
// Incremental order sizes, never total portfolio allocation targets.
export const ORDER_SIZE_PCT = { starter: 1, half: 2.5, full: 4, trim_third: 0, trim_half: 0 } as const;

export function allocationPct(marketValue: number, equity: number): number | null {
  return Number.isFinite(marketValue) && Number.isFinite(equity) && equity > 0
    ? marketValue / equity * 100 : null;
}

export function observationDate(date: string): number {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(date);
  return quarter ? Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3, 0) : Date.parse(date);
}

export function fresh(date: string | undefined, maxDays: number, now = new Date()): boolean {
  if (!date) return false;
  const age = (now.getTime() - observationDate(date)) / 86_400_000;
  return Number.isFinite(age) && age >= 0 && age <= maxDays;
}

/** Compare each company with itself, then average the same paired cohort. */
export function revenueTrend(data: SaaSDataPoint[], now = new Date()) {
  const fields = ['servicenow', 'salesforce', 'hubspot', 'freshworks', 'workday'] as const;
  const tickers = ['NOW', 'CRM', 'HUBS', 'FRSH', 'WDAY'];
  const pairs = fields.flatMap((field, i) => {
    const rows = data.filter(r => r[field] != null && Number.isFinite(r[field])).sort((a,b) => observationDate(a.date) - observationDate(b.date));
    const latest = rows.at(-1), prior = rows.at(-2);
    if (!latest || !prior || !fresh(latest.date, 180, now)) return [];
    const gap = (observationDate(latest.date) - observationDate(prior.date)) / 86_400_000;
    if (gap < 60 || gap > 120) return [];
    return [{ ticker: tickers[i], latest: latest[field]!, prior: prior[field]!, date: latest.date, priorDate: prior.date }];
  });
  const latestAvg = pairs.length ? pairs.reduce((s,p) => s + p.latest, 0) / pairs.length : null;
  const priorAvg = pairs.length ? pairs.reduce((s,p) => s + p.prior, 0) / pairs.length : null;
  return { latestAvg, priorAvg, delta: latestAvg == null || priorAvg == null ? null : latestAvg - priorAvg,
    deterioratingTickers: pairs.filter(p => p.latest < p.prior - 1).map(p => p.ticker), pairs };
}

export function accountQuality(account: { equity: number; cash: number }, positions: { market_value: number }[], prior?: { equity: number; cash: number; gross_exposure: number } | null): string | null {
  if (![account.equity, account.cash, ...positions.map(p => p.market_value)].every(Number.isFinite) || account.equity <= 0) return 'Invalid broker account values';
  const net = positions.reduce((sum,p) => sum + p.market_value, 0);
  if (Math.abs(account.equity - account.cash - net) > Math.max(100, account.equity * 0.01)) return 'Broker equity does not reconcile with cash and positions';
  if (prior && prior.gross_exposure > 1000 && positions.length === 0 && Math.abs(account.cash - prior.cash) < 100 && account.equity < prior.equity * 0.96) return 'Positions disappeared without corresponding cash proceeds; broker data requires review';
  return null;
}

/** Returns for the complete universe, sharing exactly the same start/end sessions. */
export function alignedReturns(bars: Map<string, Array<{ asOf: string; close: number }>>, tickers: readonly string[], now = new Date()): Map<string, number> | null {
  const series = tickers.map(t => new Map((bars.get(t) ?? []).filter(b => Number.isFinite(b.close) && b.close > 0).map(b => [b.asOf.slice(0,10), b.close])));
  if (!series.length || series.some(s => s.size < 21)) return null;
  const dates = [...series[0].keys()].filter(d => series.every(s => s.has(d))).sort();
  const end = dates.at(-1), start = dates.at(-21);
  if (!end || !start || !fresh(end, 7, now)) return null;
  // Do not silently move the comparison backward when one constituent is missing its latest session.
  if (series.some(s => [...s.keys()].sort().at(-1) !== end)) return null;
  return new Map(tickers.map((t,i) => [t, (series[i].get(end)! / series[i].get(start)! - 1) * 100]));
}
