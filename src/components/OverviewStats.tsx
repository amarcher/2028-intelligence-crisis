import { COLORS, FRED_SERIES } from '../lib/constants';
import { useEconomicData } from '../hooks/useEconomicData';
import MiniStat from './ui/MiniStat';

type DataPoint = { date: string; value: number | null };

function latest(data: DataPoint[]): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value != null) return data[i].value;
  }
  return null;
}

function valueOneYearAgo(data: DataPoint[]): number | null {
  if (data.length < 2) return null;
  // Find last real data point for the reference date
  let lastIdx = data.length - 1;
  while (lastIdx >= 0 && data[lastIdx].value == null) lastIdx--;
  if (lastIdx < 1) return null;
  const lastDate = new Date(data[lastIdx].date);
  const targetDate = new Date(lastDate);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  // Find closest point to 1 year ago that has a real value
  let best: DataPoint | null = null;
  let bestDiff = Infinity;
  for (const d of data) {
    if (d.value == null) continue;
    const diff = Math.abs(new Date(d.date).getTime() - targetDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best?.value ?? null;
}

type Signal = 'alarming' | 'neutral' | 'reassuring';

function yoyChange(data: DataPoint[], risingIsAlarming: boolean): { text: string; signal: Signal } | null {
  const now = latest(data);
  const ago = valueOneYearAgo(data);
  if (now == null || ago == null) return null;
  const diff = now - ago;
  const sign = diff >= 0 ? '+' : '';
  const isRising = diff > 0;
  const signal: Signal = Math.abs(diff) < 0.1 ? 'neutral'
    : (isRising === risingIsAlarming) ? 'alarming' : 'reassuring';
  return { text: `${sign}${diff.toFixed(1)}pp YoY`, signal };
}

function yoyChangePct(data: DataPoint[], risingIsAlarming: boolean): { text: string; signal: Signal } | null {
  const now = latest(data);
  const ago = valueOneYearAgo(data);
  if (now == null || ago == null || ago === 0) return null;
  const pct = ((now - ago) / ago) * 100;
  const sign = pct >= 0 ? '+' : '';
  const isRising = pct > 0;
  const signal: Signal = Math.abs(pct) < 1 ? 'neutral'
    : (isRising === risingIsAlarming) ? 'alarming' : 'reassuring';
  return { text: `${sign}${pct.toFixed(1)}% YoY`, signal };
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

  const unempYoy = yoyChange(unemployment.data, true);       // rising unemployment = alarming
  const joltsYoy = yoyChangePct(jolts.data, false);          // falling openings = alarming
  const claimsYoy = yoyChangePct(claims.data, true);         // rising claims = alarming
  const sp500Yoy = yoyChangePct(sp500.data, false);          // falling market = alarming
  const treasuryYoy = yoyChange(treasury.data, true);        // rising yields = alarming (fiscal stress)

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <MiniStat label="UNEMPLOYMENT" value={formatPct(unemployment.data)} change={unempYoy?.text} signal={unempYoy?.signal} />
        <MiniStat label="JOLTS OPENINGS" value={formatK(jolts.data)} change={joltsYoy?.text} signal={joltsYoy?.signal} />
        <MiniStat label="INITIAL CLAIMS" value={formatK(claims.data)} change={claimsYoy?.text} signal={claimsYoy?.signal} />
        <MiniStat label="S&P 500" value={formatInt(sp500.data)} change={sp500Yoy?.text} signal={sp500Yoy?.signal} />
        <MiniStat label="10Y YIELD" value={formatPct(treasury.data, 2)} change={treasuryYoy?.text} signal={treasuryYoy?.signal} />
      </div>
      <div className="flex items-center justify-center gap-4 mt-2 mb-12 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
        <span>YoY color:</span>
        <span><span style={{ color: COLORS.accent }}>&#9632;</span> = Worsening</span>
        <span><span style={{ color: COLORS.positive }}>&#9632;</span> = Improving</span>
        <span><span style={{ color: COLORS.textDim }}>&#9632;</span> = Flat</span>
      </div>
    </div>
  );
}
