import { COLORS } from '../../lib/constants';

interface TooltipPayloadEntry {
  name: string;
  value: number | string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  prefix?: string;
  suffix?: string;
}

export default function CustomTooltip({ active, payload, label, prefix, suffix }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-md py-2.5 px-3.5 text-xs font-mono"
      style={{
        background: COLORS.tooltipBg,
        border: `1px solid ${COLORS.borderActive}`,
      }}
    >
      <div className="mb-1" style={{ color: COLORS.textDim }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-0.5" style={{ color: p.color || COLORS.textBright }}>
          {p.name}: {prefix || ''}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}{suffix || ''}
        </div>
      ))}
    </div>
  );
}
