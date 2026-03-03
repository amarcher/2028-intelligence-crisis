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
  ReferenceLine,
} from 'recharts';
import { COLORS, FRED_SERIES, getMilestoneX, MILESTONE_LABEL, MILESTONE_STROKE } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';
import ArticleLabel from '../ui/ArticleLabel';

export default function ConsumerImpact() {
  const savings = useEconomicData(FRED_SERIES.savings_rate, 'savings_rate');
  const sentiment = useEconomicData(FRED_SERIES.consumer_confidence, 'consumer_confidence');
  const laborShare = useEconomicData(FRED_SERIES.labor_share, 'labor_share');
  const productivity = useEconomicData(FRED_SERIES.output_per_hour, 'output_per_hour');
  const fedReceipts = useEconomicData(FRED_SERIES.fed_receipts, 'fed_receipts');

  const laborShareEnd = laborShare.data[laborShare.data.length - 1]?.date;
  const savingsMilestone = getMilestoneX(savings.data);
  const sentimentMilestone = getMilestoneX(sentiment.data);
  const laborShareMilestone = getMilestoneX(laborShare.data);
  const productivityMilestone = getMilestoneX(productivity.data);
  const receiptsMilestone = getMilestoneX(fedReceipts.data);

  return (
    <div id="section-consumer">
      <SectionCard
        number="04"
        title="Consumer Spending & Ghost GDP"
        quote="The velocity of money flatlined. The human-centric consumer economy, 70% of GDP, withered. We probably could have figured this out sooner if we just asked how much money machines spend on discretionary goods."
        verdict="early"
        accentColor={COLORS.warning}
      >
        <div className="grid grid-cols-3 gap-2.5 mb-4 max-md:grid-cols-1 max-sm:grid-cols-2">
          <MiniStat label="SAVINGS RATE" value="4.6%" change="No precautionary spike yet" signal="neutral" />
          <MiniStat label="M2 VELOCITY" value="1.36" change="Recovering, not flatlined" signal="reassuring" />
          <MiniStat label="CONSUMER CONF." value="64.7" change="-8.1 MoM — weakening" signal="alarming" />
          <MiniStat label="LABOR SHARE" value="~58%" change="Well above 46% threshold" signal="reassuring" />
          <MiniStat label="PRODUCTIVITY" value="~110" change="No AI surge yet" signal="neutral" />
        </div>

        <ChartSection title="PERSONAL SAVINGS RATE (%)" height={180} mock={savings.isMock}>
          <ResponsiveContainer>
            <AreaChart data={savings.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Area type="monotone" dataKey="value" name="Savings Rate" stroke={COLORS.warning} fill={`${COLORS.warning}12`} strokeWidth={2} />
              {savingsMilestone && <ReferenceLine x={savingsMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="UNIVERSITY OF MICHIGAN CONSUMER SENTIMENT" height={180} mock={sentiment.isMock}>
          <ResponsiveContainer>
            <LineChart data={sentiment.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Sentiment" stroke={COLORS.warning} strokeWidth={2} dot={false} />
              {sentimentMilestone && <ReferenceLine x={sentimentMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="LABOR SHARE OF NONFARM BUSINESS (%)" height={180} mock={laborShare.isMock}>
          <ResponsiveContainer>
            <AreaChart data={laborShare.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Area type="monotone" dataKey="value" name="Labor Share" stroke={COLORS.warning} fill={`${COLORS.warning}12`} strokeWidth={2} />
              {laborShareMilestone && laborShareEnd && <ReferenceLine segment={[{ x: '2027-01', y: 46 }, { x: laborShareEnd, y: 46 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: 46% by early '27" fill={COLORS.accent} />} />}
              {laborShareMilestone && <ReferenceLine x={laborShareMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="OUTPUT PER HOUR — NONFARM BUSINESS (INDEX)" height={180} mock={productivity.isMock}>
          <ResponsiveContainer>
            <LineChart data={productivity.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Output/Hour" stroke={COLORS.warning} strokeWidth={2} dot={false} />
              {productivityMilestone && <ReferenceLine x={productivityMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="FEDERAL RECEIPTS (BILLIONS $)" height={180} mock={fedReceipts.isMock}>
          <ResponsiveContainer>
            <AreaChart data={fedReceipts.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `$${v}B`} />
              <Tooltip content={<CustomTooltip prefix="$" suffix="B" />} />
              <Area type="monotone" dataKey="value" name="Fed Receipts" stroke={COLORS.warning} fill={`${COLORS.warning}12`} strokeWidth={2} />
              {receiptsMilestone && <ReferenceLine x={receiptsMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.warning }}>Status:</strong> Consumer confidence has been weak (tariff-driven, not AI-driven). Savings rates remain low — no sign yet of the precautionary savings spike the article predicts from white-collar fear. Velocity of money is recovering post-COVID, not flatlined. Labor share remains around 58%, far above the 46% crisis threshold. No productivity surge yet. Too early for the &ldquo;Ghost GDP&rdquo; dynamic.
        </div>
      </SectionCard>
    </div>
  );
}
