import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { COLORS, getMilestoneX, MILESTONE_LABEL, MILESTONE_STROKE } from '../../lib/constants';
import { useSaaSData } from '../../hooks/useSaaSData';
import SectionCard from '../ui/SectionCard';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';
import ArticleLabel from '../ui/ArticleLabel';

export default function SaaSDisruption() {
  const saas = useSaaSData();
  const milestoneX = getMilestoneX(saas.data);
  const endX = saas.data[saas.data.length - 1]?.date;

  return (
    <div id="section-saas">
      <SectionCard
        number="02"
        title="SaaS Revenue Deceleration"
        quote='The procurement manager told him he&apos;d been in conversations with OpenAI about having their "forward deployed engineers" use AI tools to replace the vendor entirely. They renewed at a 30% discount.'
        verdict="trending"
        accentColor={COLORS.blue}
      >
        <ChartSection title="YoY REVENUE GROWTH (%) — PUBLIC SAAS BASKET" height={260}>
          <ResponsiveContainer>
            <LineChart data={saas.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="servicenow" name="ServiceNow" stroke={COLORS.blue} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="salesforce" name="Salesforce" stroke={COLORS.purple} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="hubspot" name="HubSpot" stroke={COLORS.teal} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="freshworks" name="Freshworks" stroke={COLORS.accent} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="workday" name="Workday" stroke={COLORS.warning} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="datadog" name="Datadog" stroke={COLORS.positive} strokeWidth={2} dot={false} connectNulls />
              <ReferenceLine y={0} stroke={COLORS.accent} strokeDasharray="6 3" />
              {endX && <ReferenceLine segment={[{ x: '2026-Q3', y: 14 }, { x: endX, y: 14 }]} stroke={COLORS.accent} strokeDasharray="6 3" label={<ArticleLabel value="Article: NOW ACV 14% by Q3'26" fill={COLORS.accent} />} />}
              {milestoneX && <ReferenceLine x={milestoneX} stroke={MILESTONE_STROKE} strokeDasharray="4 3" label={MILESTONE_LABEL} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.blue }}>Status:</strong> Revenue growth is decelerating across the SaaS basket, but not collapsing. Smaller vendors (Freshworks, HubSpot) are slowing faster than systems of record (ServiceNow, Workday). The article predicted ServiceNow ACV growth decelerating to 14% by Q3&apos;26 — current trajectory puts them in the high teens. Close, but not there yet.
        </div>
      </SectionCard>
    </div>
  );
}
