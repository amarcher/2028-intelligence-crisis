import { EVIDENCE_VERSION } from '../../lib/evidence';
import { useEffect, useMemo, useState } from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COLORS, FRED_SERIES } from '../../lib/constants';
import { useEconomicData } from '../../hooks/useEconomicData';
import { useSaaSData } from '../../hooks/useSaaSData';
import { computeSignals } from '../../lib/signals';
import { computeProximity } from '../../lib/proximity';
import { supabase } from '../../lib/supabase';
import SectionCard from '../ui/SectionCard';
import ChartSection from '../ui/ChartSection';

interface TaiPoint {
  date: string;
  score: number;
  stance: string;
  version: string;
}

interface EquityPoint {
  date: string;
  agent: number;
  spy: number | null;
}

/** What the agent thinks and does, as data: trigger-proximity ETAs, the fast
 *  signal's history, and the account measured against just-buying-SPY. */
export default function MetaSignals() {
  const jolts = useEconomicData(FRED_SERIES.jolts_openings, 'jolts');
  const claims = useEconomicData(FRED_SERIES.initial_claims, 'initial_claims');
  const sp500 = useEconomicData(FRED_SERIES.sp500, 'sp500');
  const caseShiller = useEconomicData(FRED_SERIES.case_shiller_national, 'case_shiller_national');
  const hyOas = useEconomicData(FRED_SERIES.hy_oas, 'hy_oas');
  const saas = useSaaSData();

  const [tai, setTai] = useState<TaiPoint[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('meta_indices')
      .select('observed_at, value, detail')
      .eq('key', 'tai')
      .order('observed_at', { ascending: false })
      .limit(120)
      .then(({ data }) => {
        if (!data) return;
        setTai(
          [...data].reverse().filter(r => !data.some(point => point.detail?.version === EVIDENCE_VERSION) || r.detail?.version === EVIDENCE_VERSION).map((r) => ({
            date: String(r.observed_at).slice(5, 10),
            score: Number(r.value),
            version: (r.detail as { version?: string } | null)?.version ?? 'legacy / unaudited',
            stance: (r.detail as { stance?: string } | null)?.stance ?? '—',
          })),
        );
      });
    supabase
      .from('agent_equity_snapshots')
      .select('taken_at, equity, spy_close')
      .order('taken_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const chronological = [...data].reverse();
        const first = chronological.find((r) => r.equity != null && r.spy_close != null) ?? chronological[0];
        const baseEq = Number(first.equity) || 1;
        const baseSpy = Number(first.spy_close) || null;
        setEquity(
          chronological.map((r) => ({
            date: String(r.taken_at).slice(5, 10),
            agent: (Number(r.equity) / baseEq) * 100,
            spy: baseSpy && r.spy_close != null ? (Number(r.spy_close) / baseSpy) * 100 : null,
          })),
        );
      });
  }, []);

  const proximity = useMemo(() => {
    const health = computeSignals({
        jolts: jolts.data,
        claims: claims.data,
        sp500: sp500.data,
        caseShiller: caseShiller.data,
        saas: saas.data,
        hyOas: hyOas.data,
      });
    const sp500Fired = health.signals.find(s => s.key === 'sp500')?.state === 'fired';
    return computeProximity({
      jolts: jolts.data,
      claims: claims.data,
      caseShiller: caseShiller.data,
      hyOas: hyOas.data,
      saas: saas.data,
      sp500Fired,
    }).map(p => health.signals.find(s => s.key === p.key)?.state === 'unknown' ? { ...p, etaMonths: null, progressPct: null, note: 'Unavailable or stale input; no trend estimate' } : p);
  }, [jolts.data, claims.data, sp500.data, caseShiller.data, hyOas.data, saas.data]);

  const latestTai = tai.length > 0 ? tai[tai.length - 1] : null;

  return (
    <div id="section-meta-signals">
      <SectionCard
        number="07"
        title="What the agent sees and does, as data"
        quote="Not just positions — the agent's own readings become indicators: how fast each danger line is approaching, and whether the strategy is beating doing nothing."
        verdict="early"
        accentColor={COLORS.accent}
      >
        {/* Trigger proximity table */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold tracking-[0.06em] font-mono mb-2" style={{ color: COLORS.textDim }}>
            HOW CLOSE IS EACH DANGER LINE — AND HOW FAST IS IT APPROACHING?
          </div>
          <div className="grid grid-cols-3 gap-2 max-md:grid-cols-1">
            {proximity.map((p) => (
              <div
                key={p.key}
                className="p-3 rounded-md border"
                style={{ background: COLORS.bg, borderColor: p.etaMonths === 0 ? `${COLORS.accent}50` : COLORS.border }}
              >
                <div className="text-[10px] font-mono tracking-[0.08em]" style={{ color: COLORS.textDim }}>
                  {p.label.toUpperCase()}
                </div>
                <div className="text-[16px] font-extrabold font-display" style={{ color: COLORS.textBright }}>
                  {p.etaMonths == null
                    ? p.key === 'sp500' ? 'NO PACE ESTIMATE' : p.progressPct == null ? 'DATA UNAVAILABLE' : 'no crossing at current pace'
                    : p.etaMonths === 0
                      ? 'LEVEL REACHED'
                      : `~${p.etaMonths} mo away`}
                </div>
                <div className="text-[10px] mt-0.5 font-mono" style={{ color: COLORS.textDim }}>
                  {p.progressPct != null ? `${Math.min(p.progressPct, 100)}% of the way` : 'no read yet'} · {p.note}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs my-3">Fast-score definition: {latestTai?.version ?? 'unavailable'}. {latestTai?.version !== EVIDENCE_VERSION ? 'Legacy scores used inconsistent revenue cohorts; do not compare them with corrected scores.' : 'Corrected same-company revenue comparisons. This is an unvalidated research score, not a probability.'}</p>
        {/* TAI history */}
        <ChartSection
          title={`FAST SIGNAL (SOFTWARE-VS-AI PRESSURE) — ${latestTai ? `${latestTai.score}/100 · ${latestTai.stance.toUpperCase()} · as of ${latestTai.date}` : 'no history yet (starts recording each agent check-in)'}`}
          height={160}
        >
          <ResponsiveContainer>
            <LineChart data={tai} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <Tooltip
                contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, fontSize: 11 }}
              />
              <Line type="monotone" dataKey="score" stroke={COLORS.accent} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Equity vs SPY */}
        <ChartSection
          title="THE ACCOUNT VS JUST BUYING THE S&P 500 (both start at 100 in the displayed window)"
          height={160}
        >
          <ResponsiveContainer>
            <LineChart data={equity} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textDim }} interval="preserveStartEnd" />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: COLORS.textDim }} />
              <Tooltip
                contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, fontSize: 11 }}
              />
              <Line type="monotone" dataKey="agent" name="agent" stroke={COLORS.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="spy" name="S&P 500" stroke={COLORS.textDim} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>

        <div className="text-[11px] mt-3 leading-[1.5]" style={{ color: COLORS.textDim }}>
          The proximity estimates use each reading's pace over the last ~3 months — they answer "at this
          speed, when does the domino fall?", not "will it fall". History for the two charts starts
          accumulating from the day the measurement tables went live.
        </div>
      </SectionCard>
    </div>
  );
}
