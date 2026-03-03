import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { COLORS } from '../../lib/constants';
import { INFERENCE_COST } from '../../lib/mockData';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';
import ChartSection from '../ui/ChartSection';
import CustomTooltip from '../ui/CustomTooltip';

export default function AICapability() {
  return (
    <div id="section-ai">
      <SectionCard
        number="01"
        title="AI Capability Acceleration"
        quote="In late 2025, agentic coding tools took a step function jump in capability. A competent developer working with Claude Code or Codex could now replicate the core functionality of a mid-market SaaS product in weeks."
        verdict="trending"
        accentColor={COLORS.purple}
      >
        <div className="grid grid-cols-3 gap-2.5 mb-4 max-md:grid-cols-1">
          <MiniStat label="GPT-4 COST/1M TKN" value="$0.60" change="-99% since launch" positive />
          <MiniStat label="CLAUDE COST/1M" value="$0.80" change="-97% since launch" positive />
          <MiniStat label="SWE-BENCH BEST" value="72%" change="+40pp in 12mo" positive />
        </div>
        <ChartSection title="INFERENCE COST PER MILLION TOKENS (OUTPUT) — LOG SCALE COLLAPSE">
          <ResponsiveContainer>
            <ComposedChart data={INFERENCE_COST}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.chartGrid} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: COLORS.textDim }} />
              <YAxis
                scale="log"
                domain={[0.5, 100]}
                tick={{ fontSize: 10, fill: COLORS.textDim }}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip content={<CustomTooltip prefix="$" />} />
              <Line type="stepAfter" dataKey="gpt4" name="GPT-4 class" stroke={COLORS.positive} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="stepAfter" dataKey="claude" name="Claude class" stroke={COLORS.purple} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <ReferenceLine y={1} stroke={COLORS.accent} strokeDasharray="6 3" label={{ value: '$1 threshold', fill: COLORS.accent, fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartSection>
        <div className="text-xs mt-3 leading-[1.6]" style={{ color: COLORS.textDim }}>
          <strong style={{ color: COLORS.purple }}>Status:</strong> Inference costs have collapsed 99%+ in under 3 years. Agentic coding tools (Claude Code, Cursor, Codex) are mainstream among developers.
          The article&apos;s core catalyst — AI capability making build-vs-buy viable — is clearly underway.
        </div>
      </SectionCard>
    </div>
  );
}
