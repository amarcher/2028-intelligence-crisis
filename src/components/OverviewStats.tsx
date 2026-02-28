import { FRED_SERIES } from '../lib/constants';
import { useEconomicData } from '../hooks/useEconomicData';
import MiniStat from './ui/MiniStat';

type DataPoint = { date: string; value: number };

function latest(data: DataPoint[]): number | null {
  return data.length ? data[data.length - 1].value : null;
}

function valueOneYearAgo(data: DataPoint[]): number | null {
  if (data.length < 2) return null;
  const lastDate = new Date(data[data.length - 1].date);
  const targetDate = new Date(lastDate);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  // Find closest point to 1 year ago
  let best = data[0];
  let bestDiff = Infinity;
  for (const d of data) {
    const diff = Math.abs(new Date(d.date).getTime() - targetDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best.value;
}

function yoyChange(data: DataPoint[]): { text: string; positive: boolean } | null {
  const now = latest(data);
  const ago = valueOneYearAgo(data);
  if (now == null || ago == null) return null;
  const diff = now - ago;
  const sign = diff >= 0 ? '+' : '';
  return { text: `${sign}${diff.toFixed(1)}pp YoY`, positive: diff <= 0 };
}

function yoyChangePct(data: DataPoint[]): { text: string; positive: boolean } | null {
  const now = latest(data);
  const ago = valueOneYearAgo(data);
  if (now == null || ago == null || ago === 0) return null;
  const pct = ((now - ago) / ago) * 100;
  const sign = pct >= 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(1)}% YoY`, positive: pct >= 0 };
}

function formatPct(data: DataPoint[], decimals = 1): string {
  const val = latest(data);
  return val != null ? `${val.toFixed(decimals)}%` : '—';
}

function formatK(data: DataPoint[]): string {
  const val = latest(data);
  if (val == null) return '—';
  if (val >= 1000) return `${(val / 1000).toFixed(1)}M`;
  return `${Math.round(val)}K`;
}

function formatInt(data: DataPoint[]): string {
  const val = latest(data);
  return val != null ? Math.round(val).toLocaleString() : '—';
}

export default function OverviewStats() {
  const unemployment = useEconomicData(FRED_SERIES.unemployment, 'unemployment');
  const jolts = useEconomicData(FRED_SERIES.jolts_openings, 'jolts');
  const claims = useEconomicData(FRED_SERIES.initial_claims, 'initial_claims');
  const sp500 = useEconomicData(FRED_SERIES.sp500, 'sp500');
  const treasury = useEconomicData(FRED_SERIES.treasury_10y, 'treasury_10y');

  const unempYoy = yoyChange(unemployment.data);
  const joltsYoy = yoyChangePct(jolts.data);
  const claimsYoy = yoyChangePct(claims.data);
  const sp500Yoy = yoyChangePct(sp500.data);
  const treasuryYoy = yoyChange(treasury.data);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-9">
      <MiniStat label="UNEMPLOYMENT" value={formatPct(unemployment.data)} change={unempYoy?.text} positive={unempYoy?.positive} />
      <MiniStat label="JOLTS OPENINGS" value={formatK(jolts.data)} change={joltsYoy?.text} positive={joltsYoy?.positive} />
      <MiniStat label="INITIAL CLAIMS" value={formatK(claims.data)} change={claimsYoy?.text} positive={claimsYoy?.positive} />
      <MiniStat label="S&P 500" value={formatInt(sp500.data)} change={sp500Yoy?.text} positive={sp500Yoy?.positive} />
      <MiniStat label="10Y YIELD" value={formatPct(treasury.data, 2)} change={treasuryYoy?.text} positive={treasuryYoy?.positive} />
    </div>
  );
}
