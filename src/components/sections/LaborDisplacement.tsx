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
import { COLORS } from '../../lib/constants';
import { MOCK_DATA, LAYOFFS_DATA } from '../../lib/mockData';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

export default function LaborDisplacement() {
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
          <MiniStat label="TECH LAYOFFS 2025" value="~156K" change="vs 264K in 2023" positive />
          <MiniStat label="INFO SECTOR JOBS" value="3.05M" change="-2.1% from peak" />
        </div>

        <ChartSection title="TECH LAYOFFS — QUARTERLY (LAYOFFS.FYI)" height={200}>
          <ResponsiveContainer>
            <BarChart data={LAYOFFS_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="workers" name="Workers Laid Off" fill={COLORS.accent} radius={[3, 3, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="JOLTS JOB OPENINGS (THOUSANDS)" height={200}>
          <ResponsiveContainer>
            <AreaChart data={MOCK_DATA.jolts}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip suffix="K" />} />
              <Area type="monotone" dataKey="value" name="Openings" stroke={COLORS.warning} fill={`${COLORS.warning}15`} strokeWidth={2} />
              <ReferenceLine y={5500} stroke={COLORS.accent} strokeDasharray="6 3" label={{ value: "Article: <5.5M by Oct'26", fill: COLORS.accent, fontSize: 9 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="UNEMPLOYMENT RATE (%)" height={180}>
          <ResponsiveContainer>
            <LineChart data={MOCK_DATA.unemployment}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Line type="monotone" dataKey="value" name="Unemployment" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              <ReferenceLine y={10.2} stroke={COLORS.accent} strokeDasharray="6 3" label={{ value: "Article: 10.2% by Jun'28", fill: COLORS.accent, fontSize: 9 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-relaxed" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.accent }}>Status:</strong> Tech layoffs have declined from 2023 peak but remain elevated. JOLTS openings are trending down but well above the article&apos;s 5.5M threshold. Unemployment remains historically low. The &ldquo;displacement spiral&rdquo; hasn&apos;t materialized yet — this is the key section to watch.
        </div>
      </SectionCard>
    </div>
  );
}
