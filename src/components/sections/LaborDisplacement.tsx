import {
  BarChart,
  Bar,
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
import { LAYOFFS_DATA } from '../../lib/mockData';
import { useEconomicData } from '../../hooks/useEconomicData';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';
import ArticleLabel from '../ui/ArticleLabel';

export default function LaborDisplacement() {
  const jolts = useEconomicData(FRED_SERIES.jolts_openings, 'jolts');
  const unemployment = useEconomicData(FRED_SERIES.unemployment, 'unemployment');
  const initialClaims = useEconomicData(FRED_SERIES.initial_claims, 'initial_claims');
  const realWage = useEconomicData(FRED_SERIES.real_wage, 'real_wage');

  const layoffsMilestone = getMilestoneX(LAYOFFS_DATA);
  const joltsMilestone = getMilestoneX(jolts.data);
  const unempMilestone = getMilestoneX(unemployment.data);
  const claimsMilestone = getMilestoneX(initialClaims.data);
  const wageMilestone = getMilestoneX(realWage.data);
  const joltsEnd = jolts.data[jolts.data.length - 1]?.date;
  const unempEnd = unemployment.data[unemployment.data.length - 1]?.date;
  const claimsEnd = initialClaims.data[initialClaims.data.length - 1]?.date;

  return (
    <div id="section-labor">
      <SectionCard
        number="03"
        title="White-Collar Labor Displacement"
        quote="Initial claims surged to 487,000, the highest since April 2020... The S&P dropped 6% over the following week."
        verdict="early"
        accentColor={COLORS.accent}
      >
        <div className="grid grid-cols-2 gap-2.5 mb-4 max-md:grid-cols-1">
          <MiniStat label="TECH LAYOFFS 2025" value="~156K" change="Down from 264K peak — easing" signal="reassuring" />
          <MiniStat label="INFO SECTOR JOBS" value="3.05M" change="-2.1% from peak — eroding" signal="alarming" />
        </div>

        <ChartSection title="TECH LAYOFFS — QUARTERLY (LAYOFFS.FYI)" height={200}>
          <ResponsiveContainer>
            <BarChart data={LAYOFFS_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="workers" name="Workers Laid Off" fill={COLORS.accent} radius={[3, 3, 0, 0]} opacity={0.85} />
              {layoffsMilestone && <ReferenceLine x={layoffsMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="JOLTS JOB OPENINGS (THOUSANDS)" height={200} mock={jolts.isMock}>
          <ResponsiveContainer>
            <AreaChart data={jolts.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip suffix="K" />} />
              <Area type="monotone" dataKey="value" name="Openings" stroke={COLORS.warning} fill={`${COLORS.warning}15`} strokeWidth={2} />
              {joltsEnd && <ReferenceLine segment={[{ x: '2026-10', y: 5500 }, { x: joltsEnd, y: 5500 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: <5.5M by Oct'26" fill={COLORS.accent} />} />}
              {joltsMilestone && <ReferenceLine x={joltsMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="UNEMPLOYMENT RATE (%)" height={180} mock={unemployment.isMock}>
          <ResponsiveContainer>
            <LineChart data={unemployment.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Line type="monotone" dataKey="value" name="Unemployment" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              {unempEnd && <ReferenceLine segment={[{ x: '2028-06', y: 10.2 }, { x: unempEnd, y: 10.2 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: 10.2% by Jun'28" fill={COLORS.accent} />} />}
              {unempMilestone && <ReferenceLine x={unempMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="INITIAL UNEMPLOYMENT CLAIMS (THOUSANDS)" height={180} mock={initialClaims.isMock}>
          <ResponsiveContainer>
            <LineChart data={initialClaims.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis domain={[0, 550000]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Initial Claims" stroke={COLORS.warning} strokeWidth={2} dot={false} />
              {claimsEnd && <ReferenceLine segment={[{ x: '2027-07', y: 487000 }, { x: claimsEnd, y: 487000 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: 487K by Q3'27" fill={COLORS.accent} />} />}
              {claimsMilestone && <ReferenceLine x={claimsMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="REAL MEDIAN WEEKLY EARNINGS ($)" height={180} mock={realWage.isMock}>
          <ResponsiveContainer>
            <AreaChart data={realWage.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip content={<CustomTooltip prefix="$" />} />
              <Area type="monotone" dataKey="value" name="Real Wage" stroke={COLORS.accent} fill={`${COLORS.accent}12`} strokeWidth={2} />
              {wageMilestone && <ReferenceLine x={wageMilestone} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.accent }}>Status:</strong> Tech layoffs have declined from 2023 peak but remain elevated. JOLTS openings are trending down but well above the article&apos;s 5.5M threshold. Unemployment remains historically low. Initial claims stable around 215-230K, nowhere near the 487K crisis level. Real wages growing modestly. The &ldquo;displacement spiral&rdquo; hasn&apos;t materialized yet — this is the key section to watch.
        </div>
      </SectionCard>
    </div>
  );
}
