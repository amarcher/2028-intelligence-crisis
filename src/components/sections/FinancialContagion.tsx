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
} from 'recharts';
import { COLORS, FRED_SERIES } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import type { DelinquencyDataPoint } from '../../lib/types';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

export default function FinancialContagion() {
  const ccDelinquency = useEconomicData(FRED_SERIES.cc_delinquency, 'cc_delinquency');
  const mortgageDelinquency = useEconomicData(FRED_SERIES.mortgage_delinquency, 'mortgage_delinquency');
  const treasury = useEconomicData(FRED_SERIES.treasury_10y, 'treasury_10y');

  const delinquencyData: DelinquencyDataPoint[] = useMemo(() =>
    ccDelinquency.data.map((d, i) => ({
      date: d.date,
      cc: d.value,
      mortgage: mortgageDelinquency.data[i]?.value,
    })),
    [ccDelinquency.data, mortgageDelinquency.data]
  );

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
          <MiniStat label="CC DELINQUENCY" value="3.5%" change="+1.1pp from trough" />
          <MiniStat label="MORTGAGE DELINQ." value="1.8%" change="Near historic lows" positive />
        </div>

        <ChartSection title="DELINQUENCY RATES — CREDIT CARDS vs. MORTGAGES (%)" height={220}>
          <ResponsiveContainer>
            <LineChart data={delinquencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="cc" name="Credit Card" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="mortgage" name="Mortgage" stroke={COLORS.teal} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="10-YEAR TREASURY YIELD (%)" height={180}>
          <ResponsiveContainer>
            <AreaChart data={treasury.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Area type="monotone" dataKey="value" name="10Y Yield" stroke={COLORS.teal} fill={`${COLORS.teal}12`} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-relaxed" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.teal }}>Status:</strong> Credit card delinquencies are rising (but from COVID lows — this is normalization, not crisis). Mortgage delinquencies remain near historic lows. No sign of the private credit contagion or PE software defaults the article describes. The &ldquo;daisy chain&rdquo; has not begun.
        </div>
      </SectionCard>
    </div>
  );
}
