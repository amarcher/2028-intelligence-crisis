import { VERDICT } from '../../lib/constants';
import type { VerdictType } from '../../lib/types';

interface VerdictBadgeProps {
  type: VerdictType;
}

export default function VerdictBadge({ type }: VerdictBadgeProps) {
  const v = VERDICT[type];
  return (
    <span
      className="inline-flex items-center gap-[5px] px-2.5 py-[3px] rounded-[3px] text-[10px] font-bold tracking-[0.08em] font-mono"
      style={{
        color: v.color,
        background: `${v.color}18`,
        border: `1px solid ${v.color}30`,
      }}
    >
      {v.icon} {v.label}
    </span>
  );
}
