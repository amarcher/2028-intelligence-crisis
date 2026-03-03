import { COLORS } from '../../lib/constants';

interface MiniStatProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
}

export default function MiniStat({ label, value, change, positive }: MiniStatProps) {
  return (
    <div className="p-3 px-4 rounded-md border min-w-[140px]" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
      <div className="text-[10px] tracking-[0.08em] font-mono mb-1" style={{ color: COLORS.textDim }}>
        {label}
      </div>
      <div className="text-[22px] font-extrabold font-display" style={{ color: COLORS.textBright }}>
        {value}
      </div>
      {change && (
        <div className="text-[11px] mt-0.5" style={{ color: positive ? COLORS.positive : COLORS.accent }}>
          {change}
        </div>
      )}
    </div>
  );
}
