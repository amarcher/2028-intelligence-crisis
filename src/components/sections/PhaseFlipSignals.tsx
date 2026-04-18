import { useMemo } from 'react';
import { COLORS, FRED_SERIES, VERDICT } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import { useSaaSData } from '../../hooks/useSaaSData';
import { computeSignals } from '../../lib/signals';
import SectionCard from '../ui/SectionCard';

export default function PhaseFlipSignals() {
  const jolts = useEconomicData(FRED_SERIES.jolts_openings, 'jolts');
  const claims = useEconomicData(FRED_SERIES.initial_claims, 'initial_claims');
  const sp500 = useEconomicData(FRED_SERIES.sp500, 'sp500');
  const caseShiller = useEconomicData(FRED_SERIES.case_shiller_national, 'case_shiller_national');
  const saas = useSaaSData();

  const { signals, firedCount, phase, phaseLabel, verdict, playbook } = useMemo(
    () =>
      computeSignals({
        jolts: jolts.data,
        claims: claims.data,
        sp500: sp500.data,
        caseShiller: caseShiller.data,
        saas: saas.data,
      }),
    [jolts.data, claims.data, sp500.data, caseShiller.data, saas.data],
  );

  const phaseFlipped = phase === 'inflection';
  const phaseColor = phaseFlipped ? COLORS.accent : COLORS.warning;

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
                key={s.key}
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
