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
          Data shown uses representative values based on publicly available sources. For a production version, this dashboard would pull live data from:
        </p>
        <div className="font-mono text-[11px]" style={{ color: COLORS.text }}>
          <span style={{ color: COLORS.blue }}>FRED API</span> — BLS employment, JOLTS, unemployment, PCE, Treasury yields, delinquency rates
          <br />
          <span style={{ color: COLORS.purple }}>Layoffs.fyi</span> — Tech layoff tracking (web scrape)
          <br />
          <span style={{ color: COLORS.warning }}>SEC EDGAR</span> — SaaS company quarterly filings, revenue, NRR
          <br />
          <span style={{ color: COLORS.teal }}>Zillow / Redfin</span> — Home values, inventory by metro
          <br />
          <span style={{ color: COLORS.accent }}>Public API pricing</span> — OpenAI, Anthropic published model pricing
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
