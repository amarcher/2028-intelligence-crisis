import type { ReactNode } from 'react';
import { COLORS } from '../../lib/constants';

interface ChartSectionProps {
  title?: string;
  children: ReactNode;
  height?: number;
}

export default function ChartSection({ title, children, height = 220 }: ChartSectionProps) {
  return (
    <div className="mt-4">
      {title && (
        <div
          className="text-[11px] font-semibold tracking-[0.06em] font-mono mb-2.5"
          style={{ color: COLORS.textDim }}
        >
          {title}
        </div>
      )}
      <div style={{ height, width: '100%' }}>
        {children}
      </div>
    </div>
  );
}
