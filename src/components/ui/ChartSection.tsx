import type { ReactNode } from 'react';
import { COLORS } from '../../lib/constants';

interface ChartSectionProps {
  title?: string;
  children: ReactNode;
  height?: number;
  mock?: boolean;
}

export default function ChartSection({ title, children, height = 220, mock }: ChartSectionProps) {
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
      <div style={{ height, width: '100%', position: 'relative' }}>
        {children}
        {mock && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: '0.15em',
                color: COLORS.textDim,
                opacity: 0.18,
                userSelect: 'none',
              }}
            >
              MOCK DATA
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
