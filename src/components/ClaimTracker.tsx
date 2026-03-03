import { COLORS, VERDICT, SECTIONS } from '../lib/constants';
import { ARTICLE_CLAIMS } from '../lib/predictions';
import type { VerdictType } from '../lib/types';
import ClaimCard from './ui/ClaimCard';

const VERDICT_ORDER: VerdictType[] = ['confirmed', 'trending', 'early', 'wrong'];

export default function ClaimTracker() {
  const counts = VERDICT_ORDER.reduce((acc, v) => {
    acc[v] = ARTICLE_CLAIMS.filter((c) => c.verdict === v).length;
    return acc;
  }, {} as Record<VerdictType, number>);

  const sectionMap = SECTIONS.map((s) => ({
    ...s,
    claims: ARTICLE_CLAIMS.filter((c) => c.section === s.id),
  })).filter((s) => s.claims.length > 0);

  return (
    <div
      className="rounded-lg mb-10 overflow-hidden relative"
      style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.warning}, transparent)` }}
      />

      <div className="pt-6 px-7">
        <span
          className="text-[10px] font-bold tracking-[0.15em] font-mono"
          style={{ color: COLORS.textDim }}
        >
          CLAIM TRACKER
        </span>
        <h2
          className="text-xl font-extrabold mt-1 tracking-[-0.02em] font-display"
          style={{ color: COLORS.textBright }}
        >
          Article Predictions vs. Reality
        </h2>

        <div className="flex gap-3 mt-3 mb-5 flex-wrap">
          {VERDICT_ORDER.map((v) => {
            const info = VERDICT[v];
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] text-[11px] font-bold tracking-[0.05em] font-mono"
                style={{
                  color: info.color,
                  background: `${info.color}12`,
                  border: `1px solid ${info.color}25`,
                }}
              >
                {info.icon} {counts[v]} {info.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="px-7 pb-6">
        {sectionMap.map((section) => (
          <div key={section.id} className="mb-5 last:mb-0">
            <div
              className="text-[10px] font-bold tracking-[0.12em] font-mono mb-2 flex items-center gap-2"
              style={{ color: section.color }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: section.color }}
              />
              {section.label.toUpperCase()}
            </div>
            <div className="flex flex-col gap-2">
              {section.claims.map((claim) => (
                <ClaimCard key={claim.id} claim={claim} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
