import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { COLORS } from '../../lib/constants';
import { useShippingSignals } from '../../hooks/useShippingSignals';
import type { HistoryPoint, LatestSignal, SourceStatus } from '../../hooks/useShippingSignals';
import SectionCard from '../ui/SectionCard';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

// Which (source, metric) pairs get a MiniStat in the top strip, in display order.
const VITALS: Array<{
  source: string;
  metric: string;
  label: string;
  format: (v: number) => string;
  // If true, a rising value is bearish (shipping demand soft). If false,
  // rising = bullish demand. Used to color the WoW badge directionally.
  risingIsBearish: boolean;
}> = [
  {
    source: 'fbx',
    metric: 'global',
    label: 'FBX GLOBAL',
    format: (v) => `$${Math.round(v).toLocaleString()}`,
    risingIsBearish: false,
  },
  {
    source: 'fbx',
    metric: 'china_ea_to_na_west',
    label: 'CHINA → LA (FBX)',
    format: (v) => `$${Math.round(v).toLocaleString()}`,
    risingIsBearish: false,
  },
  {
    source: 'fbx',
    metric: 'china_ea_to_n_europe',
    label: 'CHINA → N.EUROPE',
    format: (v) => `$${Math.round(v).toLocaleString()}`,
    risingIsBearish: false,
  },
  {
    source: 'bdry',
    metric: 'close',
    label: 'BDRY (BDI PROXY)',
    format: (v) => `$${v.toFixed(2)}`,
    risingIsBearish: false,
  },
  {
    source: 'fred',
    metric: 'retail_inventory_sales_ratio',
    label: 'RETAIL I/S RATIO',
    format: (v) => v.toFixed(2),
    risingIsBearish: true, // climbing = overstock = demand softening
  },
  {
    source: 'fred',
    metric: 'imports_goods_services_bn',
    label: 'US IMPORTS ($BN)',
    format: (v) => `$${v.toFixed(0)}B`,
    risingIsBearish: false,
  },
];

// Which metrics get their own history chart, and what color to draw.
const CHARTS: Array<{
  source: string;
  metric: string;
  title: string;
  color: string;
  suffix?: string;
  prefix?: string;
}> = [
  {
    source: 'fbx',
    metric: 'global',
    title: 'FBX GLOBAL CONTAINER INDEX — USD / 40FT',
    color: COLORS.blue,
    prefix: '$',
  },
  {
    source: 'bdry',
    metric: 'close',
    title: 'BDRY ETF — DRY BULK PROXY (USD / SHARE)',
    color: COLORS.teal,
    prefix: '$',
  },
  {
    source: 'fred',
    metric: 'retail_inventory_sales_ratio',
    title: 'US RETAIL INVENTORY / SALES RATIO (FRED: RETAILIRSA)',
    color: COLORS.warning,
  },
];

function lookupLatest(latest: LatestSignal[], source: string, metric: string) {
  return latest.find((r) => r.source === source && r.metric === metric) ?? null;
}

function lastTwo(history: HistoryPoint[], source: string, metric: string): HistoryPoint[] {
  const rows = history.filter((r) => r.source === source && r.metric === metric);
  return rows.slice(-2);
}

function wowPct(history: HistoryPoint[], source: string, metric: string): number | null {
  const [prev, curr] = lastTwo(history, source, metric);
  if (!prev || !curr || prev.value === 0) return null;
  return ((curr.value - prev.value) / prev.value) * 100;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export default function ShippingPulse() {
  const { latest, history, sourceStatus, isLoading, error, isEmpty } = useShippingSignals();

  const vitals = useMemo(
    () =>
      VITALS.map((v) => {
        const row = lookupLatest(latest, v.source, v.metric);
        const wow = wowPct(history, v.source, v.metric);
        return { ...v, row, wow };
      }),
    [latest, history],
  );

  const chartData = useMemo(() => {
    const out: Record<string, HistoryPoint[]> = {};
    for (const c of CHARTS) {
      out[`${c.source}::${c.metric}`] = history.filter(
        (r) => r.source === c.source && r.metric === c.metric,
      );
    }
    return out;
  }, [history]);

  const freshCount = sourceStatus.filter((s) => s.fresh).length;
  const totalSources = Math.max(sourceStatus.length, 1);

  return (
    <div id="section-shipping">
      <SectionCard
        number="08"
        title="Shipping Pulse"
        quote="The physical half of the prediction — container shipping rates, dry-bulk shipping, and retail flow data. When the real economy shifts, these usually move first."
        verdict="early"
        accentColor={COLORS.blue}
      >
        {/* Freshness banner */}
        <div
          className="flex items-center justify-between mb-4 px-4 py-3 rounded-md"
          style={{
            background: `${COLORS.blue}12`,
            border: `1px solid ${COLORS.blue}40`,
          }}
        >
          <div className="flex flex-col">
            <span
              className="text-[10px] tracking-[0.15em] font-mono font-bold"
              style={{ color: COLORS.blue }}
            >
              WEEKLY PULSE · {sourceStatus.length ? `${freshCount}/${totalSources} sources fresh` : 'AWAITING FIRST PULL'}
            </span>
            <span className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
              Corroborator for the Citrini macro chain. Rising rates = active physical economy; falling rates + rising I/S ratio = demand softening.
            </span>
          </div>
          {sourceStatus.length > 0 && (
            <div className="flex items-baseline gap-1 font-display" style={{ color: COLORS.blue }}>
              <span className="text-[28px] font-extrabold leading-none">{freshCount}</span>
              <span className="text-[14px] font-bold opacity-70">/ {totalSources}</span>
            </div>
          )}
        </div>

        {/* Empty / loading / error states */}
        {isLoading && (
          <div className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
            Loading signals…
          </div>
        )}
        {!isLoading && error && (
          <div
            className="text-[11px] font-mono px-3 py-2 rounded"
            style={{
              color: COLORS.accent,
              background: `${COLORS.accent}12`,
              border: `1px solid ${COLORS.accent}40`,
            }}
          >
            Signal query failed: {error}
          </div>
        )}
        {!isLoading && !error && isEmpty && (
          <div
            className="text-[12px] leading-[1.55] px-4 py-3 rounded"
            style={{
              color: COLORS.textDim,
              background: COLORS.bg,
              border: `1px dashed ${COLORS.border}`,
            }}
          >
            No shipping signals ingested yet. Run <code style={{ color: COLORS.text }}>shipping-pulse-pull</code> (weekly cron, or invoke manually) to populate this tab.
          </div>
        )}

        {/* Vitals grid */}
        {!isEmpty && (
          <div className="grid grid-cols-3 gap-2.5 mb-4 max-md:grid-cols-2 max-sm:grid-cols-1">
            {vitals.map((v) => {
              const hasData = v.row != null;
              const wowColor =
                v.wow == null
                  ? COLORS.textDim
                  : v.risingIsBearish
                  ? v.wow > 0 ? COLORS.accent : COLORS.positive
                  : v.wow > 0 ? COLORS.positive : COLORS.accent;
              return (
                <div
                  key={`${v.source}-${v.metric}`}
                  className="p-3 px-4 rounded-md border min-w-[140px]"
                  style={{ background: COLORS.bg, borderColor: COLORS.border }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-[10px] tracking-[0.08em] font-mono"
                      style={{ color: COLORS.textDim }}
                    >
                      {v.label}
                    </span>
                    {v.wow != null && (
                      <span
                        className="text-[9px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded"
                        style={{
                          color: wowColor,
                          background: `${wowColor}18`,
                          border: `1px solid ${wowColor}30`,
                        }}
                      >
                        {v.wow >= 0 ? '+' : ''}
                        {v.wow.toFixed(1)}% WoW
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[20px] font-extrabold font-display leading-tight"
                    style={{ color: hasData ? COLORS.textBright : COLORS.textDim }}
                  >
                    {hasData ? v.format(v.row!.value) : '—'}
                  </div>
                  <div className="text-[10px] mt-0.5 font-mono" style={{ color: COLORS.textDim }}>
                    {hasData ? `obs ${formatDate(v.row!.observed_at)}` : 'no data yet'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* History charts, one per key metric */}
        {!isEmpty && CHARTS.map((c) => {
          const series = chartData[`${c.source}::${c.metric}`] ?? [];
          if (series.length < 2) return null;
          const chartRows = series.map((r) => ({
            date: r.observed_at.slice(0, 10),
            value: r.value,
          }));
          return (
            <ChartSection key={`${c.source}-${c.metric}`} title={c.title} height={200}>
              <ResponsiveContainer>
                <LineChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: COLORS.textDim }}
                    tickFormatter={(v: number) =>
                      c.prefix
                        ? `${c.prefix}${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`
                        : v.toFixed(2)
                    }
                  />
                  <Tooltip content={<CustomTooltip suffix={c.suffix} prefix={c.prefix} />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={c.title}
                    stroke={c.color}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartSection>
          );
        })}

        {/* Per-source status footer — always visible (even when empty) */}
        <SourceStatusFooter sources={sourceStatus} />
      </SectionCard>
    </div>
  );
}

function SourceStatusFooter({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${COLORS.border}` }}>
      <div
        className="text-[10px] tracking-[0.15em] font-mono font-bold mb-2"
        style={{ color: COLORS.textDim }}
      >
        SOURCE FRESHNESS
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((s) => {
          const stale = !s.fresh;
          const color = stale ? COLORS.accent : COLORS.positive;
          return (
            <div
              key={s.source}
              className="text-[10px] font-mono px-2 py-1 rounded flex items-center gap-2"
              style={{
                background: `${color}10`,
                border: `1px solid ${color}30`,
                color: COLORS.text,
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: color }}
              />
              <span style={{ color: COLORS.textBright }}>{s.source}</span>
              <span style={{ color: COLORS.textDim }}>
                {stale
                  ? `stale · ${s.consecutive_failures} fails · last ok ${formatAge(s.last_ok_at)}`
                  : `ok · ${formatAge(s.last_ok_at)}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
