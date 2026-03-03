import { COLORS } from '../../lib/constants';
import type { ArticleClaim } from '../../lib/types';
import VerdictBadge from './VerdictBadge';

interface ClaimCardProps {
  claim: ArticleClaim;
  currentValue?: number;
}

export default function ClaimCard({ claim, currentValue }: ClaimCardProps) {
  return (
    <div
      className="p-3 px-4 rounded-md border"
      style={{ background: COLORS.bg, borderColor: COLORS.border }}
    >
      <div className="flex justify-between items-start gap-2 mb-1.5">
        <div className="text-[11px] font-mono italic leading-[1.5]" style={{ color: COLORS.text }}>
          {claim.claim}
        </div>
        <VerdictBadge type={claim.verdict} />
      </div>
      <div className="flex gap-4 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
        {claim.threshold != null && currentValue != null && (
          <span>
            Current: <span style={{ color: COLORS.textBright }}>{currentValue.toLocaleString()}</span>
            {' / '}
            Target: <span style={{ color: COLORS.accent }}>{claim.threshold.toLocaleString()}</span>
          </span>
        )}
        {claim.threshold != null && currentValue == null && (
          <span>
            Target: <span style={{ color: COLORS.accent }}>{claim.thresholdLabel || claim.threshold.toLocaleString()}</span>
          </span>
        )}
        {claim.targetDate && (
          <span>
            By: <span style={{ color: COLORS.textBright }}>{claim.targetDate.slice(0, 7)}</span>
          </span>
        )}
      </div>
      {claim.notes && (
        <div className="text-[10px] mt-1.5 leading-[1.5]" style={{ color: COLORS.textDim }}>
          {claim.notes}
        </div>
      )}
    </div>
  );
}
