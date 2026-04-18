import { useMemo } from 'react';
import { COLORS, FRED_SERIES, VERDICT } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import { useSaaSData } from '../../hooks/useSaaSData';
import type { DataPoint, VerdictType } from '../../lib/types';
import SectionCard from '../ui/SectionCard';

type SignalState = 'fired' | 'pending';

interface Signal {
  label: string;
  state: SignalState;
  reading: string;
  threshold: string;
  note: string;
}

function lastNonNull(data: DataPoint[]): DataPoint | null {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value != null) return data[i];
  }
  return null;
}

function lastNNonNull(data: DataPoint[], n: number): DataPoint[] {
  const out: DataPoint[] = [];
  for (let i = data.length - 1; i >= 0 && out.length < n; i--) {
    if (data[i].value != null) out.unshift(data[i]);
  }
  return out;
}

function yoyPct(data: DataPoint[]): number | null {
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

export default function PhaseFlipSignals() {
  const jolts = useEconomicData(FRED_SERIES.jolts_openings, 'jolts');
  const claims = useEconomicData(FRED_SERIES.initial_claims, 'initial_claims');
  const sp500 = useEconomicData(FRED_SERIES.sp500, 'sp500');
  const caseShiller = useEconomicData(FRED_SERIES.case_shiller_national, 'case_shiller_national');
  const saas = useSaaSData();

  const signals = useMemo<Signal[]>(() => {
    // 1. JOLTS < 6.0M, two prints in a row (values are in thousands)
    const joltsLast2 = lastNNonNull(jolts.data, 2);
    const joltsFired = joltsLast2.length === 2 && joltsLast2.every((d) => (d.value ?? Infinity) < 6000);
    const joltsLatest = lastNonNull(jolts.data);
    const joltsReading = joltsLatest?.value != null ? fmtThousands(joltsLatest.value) : '—';

    // 2. Initial claims 4-week rolling avg > 300K
    const claimsLast4 = lastNNonNull(claims.data, 4);
    const claimsAvg =
      claimsLast4.length > 0
        ? claimsLast4.reduce((s, d) => s + (d.value ?? 0), 0) / claimsLast4.length
        : null;
    const claimsFired = claimsAvg != null && claimsAvg > 300_000;
    const claimsReading = claimsAvg != null ? `${Math.round(claimsAvg / 1000)}K` : '—';

    // 3. ServiceNow AND Workday ACV growth < 14% (dashboard lacks guidance data;
    //    require both systems-of-record to slip as a stricter proxy for a "guide-cut" regime)
    const latestSaaS = (field: 'servicenow' | 'workday'): number | null => {
      for (let i = saas.data.length - 1; i >= 0; i--) {
        const v = saas.data[i][field];
        if (v != null) return v;
      }
      return null;
    };
    const now = latestSaaS('servicenow');
    const wday = latestSaaS('workday');
    const saasFired = now != null && wday != null && now < 14 && wday < 14;
    const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
    const saasReading = `NOW ${fmtPct(now)} · WDAY ${fmtPct(wday)}`;

    // 4. S&P 500 peak stall — hit 7,500+ and failed to make a new high in 2+ monthly prints
    const spNonNull = sp500.data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
    let spFired = false;
    let spReading = '—';
    if (spNonNull.length > 0) {
      let maxIdx = 0;
      for (let i = 0; i < spNonNull.length; i++) {
        if (spNonNull[i].value > spNonNull[maxIdx].value) maxIdx = i;
      }
      const peak = spNonNull[maxIdx].value;
      const latest = spNonNull[spNonNull.length - 1].value;
      const monthsSincePeak = spNonNull.length - 1 - maxIdx;
      spFired = peak >= 7500 && monthsSincePeak >= 2 && latest < peak;
      spReading = `peak ${Math.round(peak)} · now ${Math.round(latest)}`;
    }

    // 5. Case-Shiller national YoY turns negative (proxy for regional housing roll —
    //    SF/Seattle data isn't tracked separately, so we use the national index)
    const csYoy = yoyPct(caseShiller.data);
    const csFired = csYoy != null && csYoy < 0;
    const csReading = csYoy != null ? `${csYoy >= 0 ? '+' : ''}${csYoy.toFixed(1)}% YoY` : '—';

    return [
      {
        label: 'JOLTS BREAKDOWN',
        state: joltsFired ? 'fired' : 'pending',
        reading: joltsReading,
        threshold: '< 6.00M for 2 prints',
        note: 'Labor demand collapse — leading indicator for white-collar cuts',
      },
      {
        label: 'CLAIMS SPIKE',
        state: claimsFired ? 'fired' : 'pending',
        reading: claimsReading,
        threshold: '4-wk avg > 300K',
        note: 'First hard evidence of white-collar layoff wave',
      },
      {
        label: 'SaaS GUIDE-DOWN',
        state: saasFired ? 'fired' : 'pending',
        reading: saasReading,
        threshold: 'NOW & WDAY both < 14%',
        note: 'Systems-of-record slip confirms build-vs-buy shift',
      },
      {
        label: 'S&P PEAK STALL',
        state: spFired ? 'fired' : 'pending',
        reading: spReading,
        threshold: 'peak ≥ 7,500 + 2mo below',
        note: 'Bubble-leg topping — time to flip to short book',
      },
      {
        label: 'HOUSING ROLL',
        state: csFired ? 'fired' : 'pending',
        reading: csReading,
        threshold: 'Case-Shiller YoY < 0%',
        note: 'Tech-hub housing contagion feeds bank & CRE tail',
      },
    ];
  }, [jolts.data, claims.data, sp500.data, caseShiller.data, saas.data]);

  const firedCount = signals.filter((s) => s.state === 'fired').length;
  const phaseFlipped = firedCount >= 2;
  const phaseLabel = phaseFlipped ? 'PHASE 2 · INFLECTION' : 'PHASE 1 · COUNTERFACTUAL GRIND';
  const phaseColor = phaseFlipped ? COLORS.accent : COLORS.warning;

  const verdict: VerdictType =
    firedCount >= 4 ? 'confirmed' : firedCount >= 2 ? 'trending' : 'early';

  const playbook = phaseFlipped
    ? 'Flip the book: close AI-euphoria longs, roll SaaS LEAPS to 3–6mo near-dated puts, add SPY/QQQ put spreads, layer credit shorts (HYG, KRE). Keep 15–20% dry powder for bear rallies.'
    : 'Hold the setup: keep cheap long-dated SaaS LEAPS puts (NOW/CRM/HUBS/WDAY/DDOG, Jan-27/28), carry TLT + GLD + XLP as counterfactual hedges, ride small QQQ/SMH longs for the bubble leg, and wait for ≥2 signals before deploying the short book.';

  return (
    <div id="section-phase-flip">
      <SectionCard
        number="06"
        title="Phase-Flip Signals"
        quote="Thesis right, timetable wrong. Don't short into a bubble leg — let the dashboard tell you when to flip."
        verdict={verdict}
        accentColor={COLORS.accent}
      >
        {/* Phase banner */}
        <div
          className="flex items-center justify-between mb-4 px-4 py-3 rounded-md"
          style={{
            background: `${phaseColor}12`,
            border: `1px solid ${phaseColor}40`,
          }}
        >
          <div className="flex flex-col">
            <span
              className="text-[10px] tracking-[0.15em] font-mono font-bold"
              style={{ color: phaseColor }}
            >
              {phaseLabel}
            </span>
            <span className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
              {phaseFlipped
                ? 'Two or more triggers have fired — pivot the book toward the short thesis.'
                : 'Waiting for ≥ 2 triggers to fire before flipping to the short book.'}
            </span>
          </div>
          <div className="flex items-baseline gap-1 font-display" style={{ color: phaseColor }}>
            <span className="text-[28px] font-extrabold leading-none">{firedCount}</span>
            <span className="text-[14px] font-bold opacity-70">/ 5</span>
          </div>
        </div>

        {/* Signal grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-4 max-md:grid-cols-1">
          {signals.map((s) => {
            const fired = s.state === 'fired';
            const stateColor = fired ? COLORS.accent : COLORS.textDim;
            const stateLabel = fired ? VERDICT.confirmed.icon + ' FIRED' : VERDICT.early.icon + ' NOT YET';
            return (
              <div
                key={s.label}
                className="p-3 px-4 rounded-md border min-w-[140px]"
                style={{
                  background: COLORS.bg,
                  borderColor: fired ? `${COLORS.accent}50` : COLORS.border,
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className="text-[10px] tracking-[0.08em] font-mono"
                    style={{ color: COLORS.textDim }}
                  >
                    {s.label}
                  </span>
                  <span
                    className="text-[9px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded"
                    style={{
                      color: stateColor,
                      background: `${stateColor}18`,
                      border: `1px solid ${stateColor}30`,
                    }}
                  >
                    {stateLabel}
                  </span>
                </div>
                <div
                  className="text-[18px] font-extrabold font-display leading-tight"
                  style={{ color: COLORS.textBright }}
                >
                  {s.reading}
                </div>
                <div className="text-[10px] mt-0.5 font-mono" style={{ color: COLORS.textDim }}>
                  trigger: {s.threshold}
                </div>
                <div className="text-[11px] mt-1.5 leading-[1.45]" style={{ color: COLORS.text }}>
                  {s.note}
                </div>
              </div>
            );
          })}
        </div>

        {/* Playbook */}
        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: phaseColor }}>Playbook:</strong> {playbook}
        </div>
      </SectionCard>
    </div>
  );
}
