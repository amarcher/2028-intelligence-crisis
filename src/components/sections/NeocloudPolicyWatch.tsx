import { useMemo } from 'react';
import { COLORS } from '../../lib/constants';
import { INDEX, PEERS, TARGET, computeEventStudy, fmtPct, type EventResult } from '../../lib/eventStudy';
import { useNeocloudWatch } from '../../hooks/useNeocloudWatch';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';

const th = 'text-left text-[10px] tracking-[0.08em] font-mono font-bold py-2 pr-3';
const td = 'text-[12px] py-2 pr-3 align-top';

function moveColor(x: number | undefined) {
  if (x == null) return COLORS.textDim;
  return x >= 0 ? COLORS.positive : COLORS.accent;
}

export default function NeocloudPolicyWatch() {
  const { prices, events, odds, lastRuns, isLoading, error, isEmpty } = useNeocloudWatch();

  const study = useMemo(() => computeEventStudy(prices, events), [prices, events]);
  const policy = study.summary.find((s) => s.kind === 'policy');
  const other = study.summary.find((s) => s.kind === 'other');
  const lastOk = lastRuns.find((r) => r.status === 'ok');

  return (
    <div id="section-neocloud">
      <SectionCard
        number="09"
        title="Neocloud Policy Watch"
        quote="Does data center regulation move the neocloud trade, or is it all AI sentiment? Event study around each policy and non-policy event: the peer basket against the Nasdaq-100, and IREN against the basket."
        verdict="early"
        accentColor={COLORS.purple}
      >
        {isLoading && (
          <div className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
            Loading prices…
          </div>
        )}
        {!isLoading && error && (
          <div
            className="text-[11px] font-mono px-3 py-2 rounded"
            style={{ color: COLORS.accent, background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40` }}
          >
            Query failed: {error}
          </div>
        )}
        {!isLoading && !error && isEmpty && (
          <div
            className="text-[12px] leading-[1.55] px-4 py-3 rounded"
            style={{ color: COLORS.textDim, background: COLORS.bg, border: `1px dashed ${COLORS.border}` }}
          >
            No prices ingested yet. Invoke <code style={{ color: COLORS.text }}>neocloud-pull</code> with{' '}
            <code style={{ color: COLORS.text }}>{'{"range":"1y"}'}</code> to backfill.
          </div>
        )}

        {!isEmpty && (
          <>
            <div className="grid grid-cols-3 gap-2.5 mb-4 max-md:grid-cols-2 max-sm:grid-cols-1">
              <MiniStat
                label={`POLICY EVENTS · BASKET VS ${INDEX}`}
                value={fmtPct(policy?.avgAbsLayer1).replace('+', '±')}
                change={`avg abs move · ${policy?.events ?? 0} events`}
                signal="neutral"
              />
              <MiniStat
                label={`OTHER EVENTS · BASKET VS ${INDEX}`}
                value={fmtPct(other?.avgAbsLayer1).replace('+', '±')}
                change={`avg abs move · ${other?.events ?? 0} events`}
                signal="neutral"
              />
              <MiniStat
                label="ORDINARY DAY · BASKET VS INDEX"
                value={fmtPct(study.typicalDayLayer1).replace('+', '±')}
                change={`${study.tradingDays} trading days`}
                signal="neutral"
              />
            </div>

            <div className="overflow-x-auto mb-4">
              <table className="w-full" style={{ color: COLORS.text }}>
                <thead style={{ color: COLORS.textDim, borderBottom: `1px solid ${COLORS.border}` }}>
                  <tr>
                    <th className={th}>DATE</th>
                    <th className={th}>KIND</th>
                    <th className={th}>EVENT</th>
                    <th className={th}>{TARGET}</th>
                    <th className={th}>BASKET</th>
                    <th className={th}>BASKET − {INDEX}</th>
                    <th className={th}>{TARGET} − BASKET</th>
                  </tr>
                </thead>
                <tbody>
                  {study.results.map((r: EventResult) => (
                    <tr key={`${r.event.event_date}-${r.event.label}`} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td className={`${td} font-mono whitespace-nowrap`}>{r.event.event_date}</td>
                      <td className={td}>
                        <span
                          className="text-[9px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded"
                          style={{
                            color: r.event.kind === 'policy' ? COLORS.purple : COLORS.textDim,
                            border: `1px solid ${r.event.kind === 'policy' ? COLORS.purple : COLORS.border}`,
                          }}
                        >
                          {r.event.kind.toUpperCase()}
                        </span>
                      </td>
                      <td className={td}>
                        {r.event.source_url ? (
                          <a href={r.event.source_url} target="_blank" rel="noreferrer" style={{ color: COLORS.textBright }}>
                            {r.event.label}
                          </a>
                        ) : (
                          r.event.label
                        )}
                      </td>
                      {r.status === 'pending' ? (
                        <td className={td} colSpan={4} style={{ color: COLORS.textDim }}>
                          not yet
                        </td>
                      ) : (
                        <>
                          <td className={`${td} font-mono`} style={{ color: moveColor(r.target) }}>{fmtPct(r.target)}</td>
                          <td className={`${td} font-mono`} style={{ color: moveColor(r.basket) }}>{fmtPct(r.basket)}</td>
                          <td className={`${td} font-mono`} style={{ color: moveColor(r.layer1) }}>{fmtPct(r.layer1)}</td>
                          <td className={`${td} font-mono`} style={{ color: moveColor(r.layer2) }}>{fmtPct(r.layer2)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[10px] font-mono mt-2" style={{ color: COLORS.textDim }}>
                Window: 1 trading day before to 2 after. Basket = equal-weight {PEERS.join(', ')}. Windows that overlap
                earnings or other big news are not adjusted.
              </div>
            </div>
          </>
        )}

        {odds.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] tracking-[0.15em] font-mono font-bold mb-2" style={{ color: COLORS.textDim }}>
              KALSHI · STATE DATA CENTER MORATORIUM LAW
            </div>
            <div className="flex flex-wrap gap-2">
              {[...odds]
                .sort((a, b) => (a.close_time ?? '').localeCompare(b.close_time ?? ''))
                .map((o) => (
                  <div
                    key={o.market_ticker}
                    className="p-3 px-4 rounded-md border min-w-[160px]"
                    style={{ background: COLORS.bg, borderColor: COLORS.border }}
                  >
                    <div className="text-[10px] font-mono mb-1" style={{ color: COLORS.textDim }}>
                      BY {o.close_time ? o.close_time.slice(0, 10) : '?'}
                    </div>
                    <div className="text-[20px] font-extrabold font-display" style={{ color: COLORS.textBright }}>
                      {o.yes_price == null ? '—' : `${Math.round(o.yes_price * 100)}%`}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: COLORS.textDim }}>
                      vol {o.volume ?? '—'} · obs {o.observed_at.slice(0, 10)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {lastRuns.length > 0 && (
          <div className="mt-4 pt-3 text-[10px] font-mono" style={{ borderTop: `1px solid ${COLORS.border}`, color: COLORS.textDim }}>
            Last successful pull: {lastOk ? `${lastOk.source} · ${lastOk.ran_at.slice(0, 16).replace('T', ' ')} UTC` : 'none yet'}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
