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
import { COLORS } from '../../lib/constants';
import { SAAS_DATA } from '../../lib/mockData';
import SectionCard from '../ui/SectionCard';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

export default function SaaSDisruption() {
  return (
    <div id="section-saas">
      <SectionCard
        number="02"
        title="SaaS Revenue Deceleration"
        quote='The procurement manager told him he&apos;d been in conversations with OpenAI about having their "forward deployed engineers" use AI tools to replace the vendor entirely. They renewed at a 30% discount.'
        verdict="trending"
        accentColor={COLORS.blue}
      >
        <ChartSection title="YoY REVENUE GROWTH (%) — PUBLIC SAAS BASKET" height={260} mock>
          <ResponsiveContainer>
            <LineChart data={SAAS_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<CustomTooltip suffix="%" />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="servicenow" name="ServiceNow" stroke={COLORS.blue} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="salesforce" name="Salesforce" stroke={COLORS.purple} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="monday" name="Monday.com" stroke={COLORS.warning} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="hubspot" name="HubSpot" stroke={COLORS.teal} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="freshworks" name="Freshworks" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              <ReferenceLine y={0} stroke={COLORS.accent} strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
        <div className="text-xs mt-3 leading-relaxed" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.blue }}>Status:</strong> Revenue growth is decelerating across the SaaS basket, but not collapsing. The &ldquo;long tail&rdquo; (Monday, Asana, Freshworks) is slowing faster than systems of record. The article predicted ServiceNow ACV growth decelerating to 14% by Q3&apos;26 — current trajectory puts them in the high teens. Close, but not there yet.
        </div>
      </SectionCard>
    </div>
  );
}
