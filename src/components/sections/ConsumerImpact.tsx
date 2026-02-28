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
} from 'recharts';
import { COLORS } from '../../lib/constants';
import { MOCK_DATA } from '../../lib/mockData';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

export default function ConsumerImpact() {
  return (
    <div id="section-consumer">
      <SectionCard
        number="04"
        title="Consumer Spending & Ghost GDP"
        quote="The velocity of money flatlined. The human-centric consumer economy, 70% of GDP, withered. We probably could have figured this out sooner if we just asked how much money machines spend on discretionary goods."
        verdict="early"
        accentColor={COLORS.warning}
      >
        <div className="grid grid-cols-3 gap-2.5 mb-4 max-md:grid-cols-1">
          <MiniStat label="SAVINGS RATE" value="4.6%" change="Historically low" />
          <MiniStat label="M2 VELOCITY" value="1.36" change="Still recovering" positive />
          <MiniStat label="CONSUMER CONF." value="64.7" change="-8.1 MoM" />
        </div>

        <ChartSection title="PERSONAL SAVINGS RATE (%)" height={180}>
          <ResponsiveContainer>
            <AreaChart data={MOCK_DATA.savings_rate}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Area type="monotone" dataKey="value" name="Savings Rate" stroke={COLORS.warning} fill={`${COLORS.warning}12`} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>

        <ChartSection title="UNIVERSITY OF MICHIGAN CONSUMER SENTIMENT" height={180}>
          <ResponsiveContainer>
            <LineChart data={MOCK_DATA.consumer_confidence}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Sentiment" stroke={COLORS.warning} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-xs mt-3 leading-relaxed" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.warning }}>Status:</strong> Consumer confidence has been weak (tariff-driven, not AI-driven). Savings rates remain low — no sign yet of the precautionary savings spike the article predicts from white-collar fear. Velocity of money is recovering post-COVID, not flatlined. Too early for the &ldquo;Ghost GDP&rdquo; dynamic.
        </div>
      </SectionCard>
    </div>
  );
}
