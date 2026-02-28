import type { ReactNode } from 'react';
import { COLORS } from '../../lib/constants';
import type { VerdictType } from '../../lib/types';
import VerdictBadge from './VerdictBadge';

interface SectionCardProps {
  number: string;
  title: string;
  quote?: string;
  verdict: VerdictType;
  accentColor?: string;
  children: ReactNode;
}

export default function SectionCard({ number, title, quote, verdict, accentColor, children }: SectionCardProps) {
  const color = accentColor || COLORS.accent;

  return (
    <div
      className="rounded-lg mb-7 overflow-hidden relative"
      style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
    >
      {/* Accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />

      <div className="pt-6 px-7">
        <div className="flex justify-between items-start mb-3">
          <div>
            <span
              className="text-[10px] font-bold tracking-[0.15em] font-mono"
              style={{ color: COLORS.textDim }}
            >
              CHAIN LINK {number}
            </span>
            <h2
              className="text-xl font-extrabold mt-1 tracking-tight font-display"
              style={{ color: COLORS.textBright }}
            >
              {title}
            </h2>
          </div>
          <VerdictBadge type={verdict} />
        </div>

        {quote && (
          <div
            className="pl-3.5 my-3 mb-[18px] text-[12.5px] leading-relaxed italic"
            style={{
              borderLeft: `2px solid ${color}40`,
              color: COLORS.textDim,
            }}
          >
            &ldquo;{quote}&rdquo;
          </div>
        )}
      </div>

      <div className="px-7 pb-6">
        {children}
      </div>
    </div>
  );
}
