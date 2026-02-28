import { COLORS } from '../lib/constants';

export default function Methodology() {
  return (
    <>
      <div
        className="rounded-lg p-6 text-xs leading-[1.7]"
        style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, color: COLORS.textDim }}
      >
        <div
          className="text-[10px] font-bold tracking-[0.15em] font-mono mb-2"
          style={{ color: COLORS.textDim }}
        >
          METHODOLOGY &amp; DATA SOURCES
        </div>
        <p className="m-0 mb-2">
          Economic data is pulled live from FRED and updated daily. Charts marked <span className="font-mono" style={{ color: COLORS.textDim }}>MOCK DATA</span> use manually curated or representative values pending automated data sources.
        </p>
        <div className="font-mono text-[11px]" style={{ color: COLORS.text }}>
          <span style={{ color: COLORS.blue }}>FRED API</span> <span style={{ color: COLORS.positive }}>(live)</span> — BLS employment, JOLTS, unemployment, savings rate, consumer sentiment, Treasury yields, delinquency rates
          <br />
          <span style={{ color: COLORS.purple }}>Layoffs.fyi</span> <span style={{ color: COLORS.textDim }}>(manual)</span> — Tech layoff tracking
          <br />
          <span style={{ color: COLORS.warning }}>SEC EDGAR</span> <span style={{ color: COLORS.textDim }}>(manual)</span> — SaaS company quarterly revenue growth
          <br />
          <span style={{ color: COLORS.accent }}>Public API pricing</span> <span style={{ color: COLORS.textDim }}>(manual)</span> — OpenAI, Anthropic published model pricing
        </div>
        <p className="mt-3 mb-0 italic">
          Verdicts are editorial assessments updated as new data becomes available.
        </p>
      </div>

      {/* Footer */}
      <div
        className="text-center mt-10 text-[11px] font-mono"
        style={{ color: COLORS.textDim }}
      >
        Original article:{' '}
        <a
          href="https://www.citriniresearch.com/p/2028gic"
          className="no-underline"
          style={{ color: COLORS.accent }}
        >
          Citrini Research — The 2028 Global Intelligence Crisis
        </a>
        <br />
        <span className="text-[10px] opacity-50">Dashboard by Archer • Last updated: Feb 2026</span>
      </div>
    </>
  );
}
