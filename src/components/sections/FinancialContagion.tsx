import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { COLORS, FRED_SERIES, getMilestoneX, MILESTONE_LABEL, MILESTONE_STROKE } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import type { DelinquencyDataPoint } from '../../lib/types';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';
import ArticleLabel from '../ui/ArticleLabel';

export default function FinancialContagion() {
  const ccDelinquency = useEconomicData(FRED_SERIES.cc_delinquency, 'cc_delinquency');
  const mortgageDelinquency = useEconomicData(FRED_SERIES.mortgage_delinquency, 'mortgage_delinquency');
  const treasury = useEconomicData(FRED_SERIES.treasury_10y, 'treasury_10y');
  const sp500 = useEconomicData(FRED_SERIES.sp500, 'sp500');
  const caseShiller = useEconomicData(FRED_SERIES.case_shiller_national, 'case_shiller_national');

  const delinquencyData: DelinquencyDataPoint[] = useMemo(() =>
    ccDelinquency.data.map((d, i) => ({
      date: d.date,
      cc: d.value,
      mortgage: mortgageDelinquency.data[i]?.value,
    })),
    [ccDelinquency.data, mortgageDelinquency.data]
  );

  const treasuryEnd = treasury.data[treasury.data.length - 1]?.date;
  const sp500End = sp500.data[sp500.data.length - 1]?.date;
  const delinqMilestone = getMilestoneX(delinquencyData);
  const treasuryMilestone = getMilestoneX(treasury.data);
  const sp500Milestone = getMilestoneX(sp500.data);
  const caseShillerMilestone = getMilestoneX(caseShiller.data);

  return (
    <div id="section-financial">
      <SectionCard
        number="05"
        title="Financial Contagion & Housing"
        quote="The US residential mortgage market is approximately $13 trillion... We now have to ask a question that seemed absurd just 3 years ago — are prime mortgages money good?"
        verdict="early"
        accentColor={COLORS.teal}
      >
        <div className="grid grid-cols-2 gap-2.5 mb-4 max-md:grid-cols-1">
          <MiniStat label="CC DELINQUENCY" value="3.5%" change="+1.1pp from trough — rising" signal="alarming" />
          <MiniStat label="MORTGAGE DELINQ." value="1.8%" change="Near historic lows — stable" signal="reassuring" />
        </div>

        <ChartSection title="DELINQUENCY RATES — CREDIT CARDS vs. MORTGAGES (%)" height={220} mock={ccDelinquency.isMock}>
          <ResponsiveContainer>
            <LineChart data={delinquencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="cc" name="Credit Card" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="mortgage" name="Mortgage" stroke={COLORS.teal} strokeWidth={2} dot={false} />
              {delinqMilestone && <ReferenceLine x={delinqMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="10-YEAR TREASURY YIELD (%)" height={180} mock={treasury.isMock}>
          <ResponsiveContainer>
            <AreaChart data={treasury.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Area type="monotone" dataKey="value" name="10Y Yield" stroke={COLORS.teal} fill={`${COLORS.teal}12`} strokeWidth={2} />
              {treasuryEnd && <ReferenceLine segment={[{ x: '2027-06', y: 3.2 }, { x: treasuryEnd, y: 3.2 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: 3.2% by mid-'27" fill={COLORS.accent} />} />}
              {treasuryMilestone && <ReferenceLine x={treasuryMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="S&P 500 INDEX" height={200} mock={sp500.isMock}>
          <ResponsiveContainer>
            <AreaChart data={sp500.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" name="S&P 500" stroke={COLORS.teal} fill={`${COLORS.teal}12`} strokeWidth={2} />
              {sp500End && <ReferenceLine segment={[{ x: '2026-10', y: 8000 }, { x: sp500End, y: 8000 }]} stroke={COLORS.warning} strokeDasharray="6 3" label={<ArticleLabel value="Article: 8000 by Oct'26" fill={COLORS.warning} />} />}
              {sp500End && <ReferenceLine segment={[{ x: '2027-06', y: 3500 }, { x: sp500End, y: 3500 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: ~3500 by mid-'27" fill={COLORS.accent} />} />}
              {sp500Milestone && <ReferenceLine x={sp500Milestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="CASE-SHILLER NATIONAL HOME PRICE INDEX" height={180} mock={caseShiller.isMock}>
          <ResponsiveContainer>
            <LineChart data={caseShiller.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Case-Shiller" stroke={COLORS.teal} strokeWidth={2} dot={false} />
              {caseShillerMilestone && <ReferenceLine x={caseShillerMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.teal }}>Status:</strong> Credit card delinquencies are rising (but from COVID lows — this is normalization, not crisis). Mortgage delinquencies remain near historic lows. S&amp;P 500 remains strong near all-time highs, not yet at the article&apos;s 8000 peak target. Case-Shiller index still climbing. No sign of the private credit contagion or PE software defaults the article describes. The &ldquo;daisy chain&rdquo; has not begun.
        </div>
      </SectionCard>
    </div>
  );
}
