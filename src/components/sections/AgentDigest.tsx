import { useMemo, useState } from 'react';
import { COLORS } from '../../lib/constants';
import { useAgentData } from '../../hooks/useAgentData';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import type {
  ActiveSleeveSnapshot,
  AgentApproval,
  AgentConfig,
  AgentDigest,
  AgentOrder,
  AgentProposal,
  VerdictType,
} from '../../lib/types';
import SectionCard from '../ui/SectionCard';
import MiniStat from '../ui/MiniStat';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function urgencyPill(u: AgentProposal['urgency']): { label: string; color: string } {
  if (u === 'act_today') return { label: 'DO TODAY', color: COLORS.accent };
  if (u === 'this_week') return { label: 'THIS WEEK', color: COLORS.warning };
  return { label: 'WAIT FOR SIGNAL', color: COLORS.textDim };
}

function actionPill(a: AgentProposal['action']): string {
  switch (a) {
    case 'open': return 'BUY';
    case 'add': return 'BUY MORE';
    case 'trim': return 'SELL SOME';
    case 'close': return 'SELL';
    case 'roll': return 'REPLACE';
    case 'hold': return 'HOLD';
    case 'unwind_all': return 'CLOSE EVERYTHING';
  }
}

function sizeHintLabel(s: AgentProposal['size_hint']): string {
  switch (s) {
    case 'starter': return 'small starter position';
    case 'half': return 'half position';
    case 'full': return 'full position';
    case 'trim_third': return 'sell 1/3';
    case 'trim_half': return 'sell 1/2';
  }
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
}

function ProposalRow({ p }: { p: AgentProposal }) {
  const urgency = urgencyPill(p.urgency);
  const instrDetail = [
    p.instrument !== 'equity' ? p.instrument.replace('_', ' ') : null,
    p.expiry ?? null,
    p.strike != null ? `@${p.strike}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className="grid gap-3 items-start py-2.5 px-3 rounded-md"
      style={{
        gridTemplateColumns: 'auto 1fr auto',
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      <div className="flex flex-col gap-0.5 items-start">
        <span
          className="text-[10px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded"
          style={{
            color: COLORS.textBright,
            background: `${COLORS.accent}18`,
            border: `1px solid ${COLORS.accent}30`,
          }}
        >
          {actionPill(p.action)}
        </span>
        <span className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
          {sizeHintLabel(p.size_hint)}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[15px] font-extrabold font-display" style={{ color: COLORS.textBright }}>
            {p.ticker}
          </span>
          {instrDetail && (
            <span className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
              {instrDetail}
            </span>
          )}
        </div>
        <div className="text-[12px] mt-1 leading-[1.5]" style={{ color: COLORS.text }}>
          {p.rationale}
        </div>
        {p.filter_flags && p.filter_flags.length > 0 && (
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {p.filter_flags.map((flag, i) => (
              <span
                key={i}
                className="text-[9px] font-mono font-bold tracking-[0.04em] px-1.5 py-[2px] rounded"
                style={{
                  color: COLORS.warning,
                  background: `${COLORS.warning}18`,
                  border: `1px solid ${COLORS.warning}40`,
                }}
              >
                ⚠ {flag}
              </span>
            ))}
          </div>
        )}
      </div>
      <span
        className="text-[9px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded whitespace-nowrap"
        style={{
          color: urgency.color,
          background: `${urgency.color}18`,
          border: `1px solid ${urgency.color}30`,
        }}
      >
        {urgency.label}
      </span>
    </div>
  );
}

function tickTypeText(t: AgentDigest['tick_type']): string {
  if (t === 'premarket') return 'MORNING';
  if (t === 'close') return 'END OF DAY';
  return 'WEEKLY';
}

function TickTypeBadge({ tickType }: { tickType: AgentDigest['tick_type'] }) {
  return (
    <span
      className="text-[9px] font-bold tracking-[0.1em] font-mono px-1.5 py-[2px] rounded"
      style={{
        color: COLORS.textDim,
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      {tickTypeText(tickType)}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: AgentDigest['phase'] }) {
  const isFlipped = phase === 'inflection';
  const color = isFlipped ? COLORS.accent : COLORS.warning;
  return (
    <span
      className="text-[9px] font-bold tracking-[0.1em] font-mono px-1.5 py-[2px] rounded"
      style={{
        color,
        background: `${color}18`,
        border: `1px solid ${color}30`,
      }}
    >
      {isFlipped ? 'ACTION PHASE' : 'WAITING PHASE'}
    </span>
  );
}

const SIGNAL_SHORT_LABEL: Record<string, string> = {
  jolts: 'job openings',
  claims: 'unemployment',
  saas: 'software growth',
  sp500: 'stock market',
  housing: 'home prices',
};

function scorecardStateLabel(state: string | undefined): string {
  if (state === 'fired') return 'CROSSED';
  if (state === 'reversed') return 'PULLED BACK';
  return 'NOT YET';
}

function ScorecardGrid({ scorecard }: { scorecard: AgentDigest['scorecard'] }) {
  if (!scorecard) return null;
  const order = ['jolts', 'claims', 'saas', 'sp500', 'housing'];
  return (
    <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${COLORS.border}` }}>
      <div
        className="text-[10px] font-bold tracking-[0.15em] font-mono mb-2"
        style={{ color: COLORS.textDim }}
      >
        WEEKLY READING SUMMARY
      </div>
      <div className="grid grid-cols-5 gap-2">
        {order.map((key) => {
          const state = scorecard[key];
          const color =
            state === 'fired' ? COLORS.accent : state === 'reversed' ? COLORS.positive : COLORS.textDim;
          return (
            <div
              key={key}
              className="px-2 py-2 rounded-md text-center"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
            >
              <div className="text-[9px] font-mono" style={{ color: COLORS.textDim }}>
                {SIGNAL_SHORT_LABEL[key] ?? key}
              </div>
              <div
                className="text-[11px] font-bold tracking-[0.08em] font-mono mt-1"
                style={{ color }}
              >
                {scorecardStateLabel(state)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LatestDigest({ digest }: { digest: AgentDigest }) {
  return (
    <div
      className="rounded-md p-4"
      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
    >
      {digest.kill_switch_triggered && (
        <div
          className="rounded px-3 py-2 mb-3 text-[11px] font-bold tracking-[0.08em] font-mono"
          style={{
            color: COLORS.accent,
            background: `${COLORS.accent}18`,
            border: `1px solid ${COLORS.accent}40`,
          }}
        >
          🛑 ABORT SIGNAL — the prediction looks wrong. The agent is suggesting we close every position.
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TickTypeBadge tickType={digest.tick_type} />
        <PhaseBadge phase={digest.phase} />
        <span className="text-[12px] font-display font-extrabold" style={{ color: COLORS.textBright }}>
          {digest.fired_count}/5 readings have crossed
        </span>
        <span className="text-[11px] font-mono flex-1 text-right" style={{ color: COLORS.textDim }}>
          {timeAgo(digest.created_at)} · {new Date(digest.created_at).toLocaleString()}
        </span>
      </div>

      <div className="text-[14px] leading-[1.55] mb-3" style={{ color: COLORS.textBright }}>
        {digest.narrative}
      </div>

      {digest.drift_notes && (
        <div
          className="text-[12px] italic leading-[1.5] pl-3 mb-3"
          style={{ color: COLORS.textDim, borderLeft: `2px solid ${COLORS.accent}40` }}
        >
          This week's economic update: {digest.drift_notes}
        </div>
      )}

      {digest.proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-bold tracking-[0.15em] font-mono mt-2"
            style={{ color: COLORS.textDim }}
          >
            SUGGESTED MOVES ({digest.proposals.length})
          </div>
          {digest.proposals.map((p, i) => (
            <ProposalRow key={`${digest.id}-${i}`} p={p} />
          ))}
        </div>
      )}

      <ScorecardGrid scorecard={digest.scorecard} />

      <div
        className="mt-4 pt-3 text-[10px] font-mono flex items-center gap-4 flex-wrap"
        style={{ color: COLORS.textDim, borderTop: `1px solid ${COLORS.border}` }}
      >
        <span>
          {digest.delivered_email ? '✓' : '✗'} email
        </span>
        <span>
          {digest.delivered_slack ? '✓' : '✗'} slack
        </span>
        {digest.cost_model && (
          <span>
            {digest.cost_model} · {digest.cost_input_tokens ?? 0}in / {digest.cost_output_tokens ?? 0}out /{' '}
            {digest.cost_cache_read_tokens ?? 0} cached
          </span>
        )}
        {digest.reasoner_status && digest.reasoner_status !== 'ok' && (
          <span style={{ color: COLORS.warning }}>reasoner: {digest.reasoner_status}</span>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ d }: { d: AgentDigest }) {
  const [open, setOpen] = useState(false);
  const summary = d.narrative.split(/(?<=[.!?])\s/)[0];
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 flex-wrap cursor-pointer transition-colors"
        style={{ color: COLORS.text }}
      >
        <TickTypeBadge tickType={d.tick_type} />
        <PhaseBadge phase={d.phase} />
        <span className="text-[11px] font-mono font-bold" style={{ color: COLORS.textBright }}>
          {d.fired_count}/5
        </span>
        {d.kill_switch_triggered && (
          <span
            className="text-[9px] font-bold tracking-[0.08em] font-mono px-1.5 py-[2px] rounded"
            style={{ color: COLORS.accent, background: `${COLORS.accent}18`, border: `1px solid ${COLORS.accent}40` }}
          >
            ABORT
          </span>
        )}
        <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: COLORS.text }}>
          {summary}
        </span>
        <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: COLORS.textDim }}>
          {timeAgo(d.created_at)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: COLORS.textDim }}>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <div className="text-[13px] leading-[1.5] mb-2" style={{ color: COLORS.textBright }}>
            {d.narrative}
          </div>
          {d.drift_notes && (
            <div
              className="text-[11px] italic leading-[1.4] pl-2 mb-2"
              style={{ color: COLORS.textDim, borderLeft: `2px solid ${COLORS.border}` }}
            >
              Drift: {d.drift_notes}
            </div>
          )}
          {d.proposals.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2">
              {d.proposals.map((p, i) => (
                <ProposalRow key={`${d.id}-${i}`} p={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusStrip({
  config,
  latest,
  digestCount,
}: {
  config: ReturnType<typeof useAgentData>['config'];
  latest: AgentDigest | undefined;
  digestCount: number;
}) {
  const enabled = config?.enabled ?? false;
  const enabledSignal: 'alarming' | 'reassuring' = enabled ? 'reassuring' : 'alarming';
  const phaseValue = config?.phase ?? 'shadow';
  const execMode = config?.mode === 'auto_execute' ? 'EXECUTING' : 'SIGNAL ONLY';
  const paperLabel = config?.paper_mode ? 'paper' : 'LIVE';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
      <MiniStat
        label="AGENT"
        value={enabled ? 'RUNNING' : 'PAUSED'}
        change={config?.killed_reason ? `stopped: ${config.killed_reason.slice(0, 50)}` : config ? `${execMode} · ${paperLabel}` : 'no config'}
        signal={enabledSignal}
      />
      <MiniStat
        label="EXECUTION MODE"
        value={phaseValue.replace('_', ' ').toUpperCase()}
        change={latest ? `latest digest: ${latest.phase === 'inflection' ? 'Action phase' : 'Waiting phase'} · ${latest.fired_count}/5 readings` : 'no digests yet'}
        signal={phaseValue === 'small_live' || phaseValue === 'scale' ? 'alarming' : 'neutral'}
      />
      <MiniStat
        label="LAST CHECK"
        value={latest ? timeAgo(latest.created_at) : '—'}
        change={latest ? `${tickTypeText(latest.tick_type).toLowerCase()} · agent ${latest.reasoner_status ?? '—'}` : ''}
        signal={latest?.reasoner_status === 'ok' || latest?.reasoner_status === 'retried_ok' ? 'reassuring' : 'neutral'}
      />
      <MiniStat
        label="HISTORY"
        value={`${digestCount}`}
        change={digestCount >= 15 ? 'showing 15 most recent' : 'all digests'}
        signal="neutral"
      />
    </div>
  );
}

const ACTIVE_STANCE_COLOR: Record<ActiveSleeveSnapshot['stance'], string> = {
  inactive: COLORS.textDim,
  watch: COLORS.warning,
  probe: COLORS.blue,
  press: COLORS.accent,
};

function ActiveSleeveStrip({ active }: { active: ActiveSleeveSnapshot | undefined }) {
  if (!active) return null;
  const color = ACTIVE_STANCE_COLOR[active.stance];
  const sleeve = active.currentSleeve;
  const perf = active.performance;
  const risk = active.riskBudget;
  const addCapacityValue = sleeve
    ? sleeve.addCapacityValue ?? sleeve.aiLongValue + sleeve.defensiveValue - sleeve.saasPutValue
    : null;
  const addAllowed = sleeve ? sleeve.addAllowed ?? (addCapacityValue ?? 0) > 0 : false;
  const riskColor = risk?.posture === 'over_budget'
    ? COLORS.accent
    : risk?.posture === 'near_limit'
      ? COLORS.warning
      : COLORS.positive;

  return (
    <div
      className="mb-4 rounded-md p-3"
      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span
          className="text-[9px] font-bold tracking-[0.1em] font-mono px-1.5 py-[2px] rounded"
          style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
        >
          ACTIVE SLEEVE · {active.stance.toUpperCase()} · {active.score}/100
        </span>
        {risk && (
          <span
            className="text-[9px] font-bold tracking-[0.1em] font-mono px-1.5 py-[2px] rounded"
            style={{ color: riskColor, background: `${riskColor}18`, border: `1px solid ${riskColor}40` }}
          >
            RISK · {risk.posture.replace(/_/g, ' ').toUpperCase()}
          </span>
        )}
        <span className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
          SaaS vs AI {fmtPct(active.momentum.saasVsAi20d)} over 20 trading days
        </span>
        <span className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
          SaaS {fmtPct(active.momentum.saas20d)} · AI {fmtPct(active.momentum.ai20d)}
        </span>
      </div>

      {(perf || risk) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          {perf && (
            <>
              <MiniStat
                label="EQUITY"
                value={fmtUsd(perf.equity)}
                change={`cash ${fmtUsd(perf.cash)}`}
                signal="neutral"
              />
              <MiniStat
                label="TODAY"
                value={fmtUsd(perf.dayProfitLoss)}
                change={fmtPct(perf.dayProfitLossPct)}
                signal={perf.dayProfitLoss >= 0 ? 'reassuring' : 'alarming'}
              />
            </>
          )}
          {risk && (
            <>
              <MiniStat
                label="ACTIVE ROOM"
                value={fmtUsd(risk.activeSleeveRoomValue)}
                change={`${risk.activeSleeveUsedPct.toFixed(0)}% of ${risk.activeSleeveBudgetPct}% sleeve used`}
                signal={risk.posture === 'over_budget' ? 'alarming' : risk.posture === 'near_limit' ? 'neutral' : 'reassuring'}
              />
              <MiniStat
                label="GROSS EXPOSURE"
                value={fmtPct(risk.grossExposurePct)}
                change={fmtUsd(risk.grossExposureValue)}
                signal={risk.grossExposurePct > 75 ? 'alarming' : risk.grossExposurePct > 50 ? 'neutral' : 'reassuring'}
              />
            </>
          )}
        </div>
      )}

      {sleeve && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <MiniStat
            label="SAAS PUTS"
            value={fmtUsd(sleeve.saasPutValue)}
            change={`${fmtUsd(sleeve.saasPutProfitLoss)} profit/loss`}
            signal={sleeve.saasPutProfitLoss >= 0 ? 'reassuring' : 'alarming'}
          />
          <MiniStat
            label="AI LONGS"
            value={fmtUsd(sleeve.aiLongValue)}
            change="QQQ / AI winners"
            signal="neutral"
          />
          <MiniStat
            label="SAFE-HAVEN"
            value={fmtUsd(sleeve.defensiveValue)}
            change="bonds / gold / staples"
            signal="neutral"
          />
          <MiniStat
            label="ADD ROOM"
            value={addAllowed ? fmtUsd(addCapacityValue) : 'NO'}
            change={addAllowed ? 'before SaaS exceeds offsets' : `${fmtUsd(addCapacityValue)} over cap`}
            signal={addAllowed ? 'reassuring' : 'alarming'}
          />
        </div>
      )}

      {active.reasons.length > 0 && (
        <div className="flex flex-col gap-1">
          {active.reasons.map((reason, i) => (
            <div key={i} className="text-[11px] leading-[1.45]" style={{ color: COLORS.text }}>
              {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CostSummary({ digests }: { digests: AgentDigest[] }) {
  const monthCosts = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonth = digests.filter((d) => new Date(d.created_at) >= monthStart);
    const inTokens = thisMonth.reduce((s, d) => s + (d.cost_input_tokens ?? 0), 0);
    const outTokens = thisMonth.reduce((s, d) => s + (d.cost_output_tokens ?? 0), 0);
    const cacheRead = thisMonth.reduce((s, d) => s + (d.cost_cache_read_tokens ?? 0), 0);
    const cacheCreate = thisMonth.reduce((s, d) => s + (d.cost_cache_creation_tokens ?? 0), 0);
    // Opus 4.7 rough pricing, same as migration 006's view.
    const estUsd =
      (inTokens * 5 + outTokens * 25 + cacheRead * 0.5 + cacheCreate * 6.25) / 1_000_000;
    return { tickCount: thisMonth.length, inTokens, outTokens, cacheRead, cacheCreate, estUsd };
  }, [digests]);

  if (monthCosts.tickCount === 0) return null;

  return (
    <div
      className="mt-4 pt-3 text-[10px] font-mono flex items-center gap-4 flex-wrap"
      style={{ color: COLORS.textDim, borderTop: `1px solid ${COLORS.border}` }}
    >
      <span>THIS MONTH</span>
      <span>{monthCosts.tickCount} ticks</span>
      <span>
        {(monthCosts.inTokens / 1000).toFixed(1)}K in / {(monthCosts.outTokens / 1000).toFixed(1)}K out
      </span>
      <span>{(monthCosts.cacheRead / 1000).toFixed(1)}K cached reads</span>
      <span style={{ color: COLORS.textBright }}>~${monthCosts.estUsd.toFixed(2)} est (Opus 4.7)</span>
    </div>
  );
}

function AgentControls({ config, onUpdate }: { config: AgentConfig | null; onUpdate: () => void }) {
  const { email, loading, signInWithEmail, signOut } = useAuth();
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInInput, setSignInInput] = useState('');
  const [signInStatus, setSignInStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (loading) return null;

  const isOwner = email != null && config?.owner_email != null && email === config.owner_email;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInInput.trim()) return;
    setSignInStatus('sending');
    setSignInError(null);
    const res = await signInWithEmail(signInInput.trim());
    if (res.ok) {
      setSignInStatus('sent');
    } else {
      setSignInStatus('error');
      setSignInError(res.error);
    }
  };

  const handleToggleEnabled = async () => {
    if (!supabase || !config) return;
    const willEnable = !config.enabled;
    const verb = willEnable ? 'restart' : 'pause';
    if (!window.confirm(`${verb} the agent?`)) return;
    setUpdating(true);
    setUpdateError(null);
    const { error: err } = await supabase
      .from('agent_config')
      .update({
        enabled: willEnable,
        ...(willEnable ? { consecutive_failures: 0, killed_reason: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    setUpdating(false);
    if (err) {
      setUpdateError(err.message);
    } else {
      onUpdate();
    }
  };

  const handleResetDeadman = async () => {
    if (!supabase || !config) return;
    if (!window.confirm("Clear the agent's error count and restart it?")) return;
    setUpdating(true);
    setUpdateError(null);
    const { error: err } = await supabase
      .from('agent_config')
      .update({
        consecutive_failures: 0,
        killed_reason: null,
        enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    setUpdating(false);
    if (err) {
      setUpdateError(err.message);
    } else {
      onUpdate();
    }
  };

  // Unauthenticated — inline sign-in form
  if (!email) {
    return (
      <div
        className="mt-4 p-3 rounded-md flex flex-col gap-2"
        style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
      >
        {!showSignIn ? (
          <button
            onClick={() => setShowSignIn(true)}
            className="text-[11px] font-mono tracking-[0.08em] self-start px-2 py-1 rounded transition-colors cursor-pointer"
            style={{ color: COLORS.textDim, background: 'transparent' }}
          >
            owner sign-in →
          </button>
        ) : signInStatus === 'sent' ? (
          <div className="text-[12px] font-mono" style={{ color: COLORS.positive }}>
            ✓ magic link sent. check your email and click the link to return here signed in.
          </div>
        ) : (
          <form onSubmit={handleSignIn} className="flex gap-2 flex-wrap items-center">
            <span className="text-[10px] font-mono tracking-[0.1em]" style={{ color: COLORS.textDim }}>
              OWNER EMAIL
            </span>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={signInInput}
              onChange={(e) => setSignInInput(e.target.value)}
              className="text-[12px] font-mono px-2 py-1 rounded flex-1 min-w-[200px] outline-none"
              style={{
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.textBright,
              }}
            />
            <button
              type="submit"
              disabled={signInStatus === 'sending'}
              className="text-[10px] font-mono font-bold tracking-[0.1em] px-3 py-1 rounded cursor-pointer"
              style={{
                color: COLORS.accent,
                background: `${COLORS.accent}18`,
                border: `1px solid ${COLORS.accent}40`,
                opacity: signInStatus === 'sending' ? 0.5 : 1,
              }}
            >
              {signInStatus === 'sending' ? 'SENDING…' : 'SEND MAGIC LINK'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSignIn(false);
                setSignInStatus('idle');
              }}
              className="text-[10px] font-mono px-2 py-1 rounded cursor-pointer"
              style={{ color: COLORS.textDim }}
            >
              cancel
            </button>
            {signInError && (
              <div className="text-[11px] basis-full" style={{ color: COLORS.accent }}>
                {signInError}
              </div>
            )}
          </form>
        )}
      </div>
    );
  }

  // Authenticated — show whether they're the owner + action buttons
  return (
    <div
      className="mt-4 p-3 rounded-md flex gap-3 items-center flex-wrap"
      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
    >
      <span className="text-[10px] font-mono tracking-[0.1em]" style={{ color: COLORS.textDim }}>
        SIGNED IN · {email}
      </span>

      {!isOwner ? (
        <span className="text-[11px] font-mono" style={{ color: COLORS.warning }}>
          read-only (not an owner)
        </span>
      ) : (
        <>
          <button
            onClick={handleToggleEnabled}
            disabled={updating}
            className="text-[10px] font-mono font-bold tracking-[0.1em] px-3 py-1 rounded cursor-pointer"
            style={{
              color: config?.enabled ? COLORS.accent : COLORS.positive,
              background: `${config?.enabled ? COLORS.accent : COLORS.positive}18`,
              border: `1px solid ${(config?.enabled ? COLORS.accent : COLORS.positive)}40`,
              opacity: updating ? 0.5 : 1,
            }}
          >
            {config?.enabled ? 'PAUSE AGENT' : 'RESTART AGENT'}
          </button>
          {(config?.consecutive_failures ?? 0) > 0 || config?.killed_reason ? (
            <button
              onClick={handleResetDeadman}
              disabled={updating}
              className="text-[10px] font-mono font-bold tracking-[0.1em] px-3 py-1 rounded cursor-pointer"
              style={{
                color: COLORS.warning,
                background: `${COLORS.warning}18`,
                border: `1px solid ${COLORS.warning}40`,
                opacity: updating ? 0.5 : 1,
              }}
            >
              CLEAR ERROR COUNT ({config?.consecutive_failures ?? 0})
            </button>
          ) : null}
        </>
      )}

      <button
        onClick={signOut}
        className="text-[10px] font-mono px-2 py-1 rounded cursor-pointer ml-auto"
        style={{ color: COLORS.textDim }}
      >
        sign out
      </button>

      {updateError && (
        <div className="text-[11px] basis-full" style={{ color: COLORS.accent }}>
          update failed: {updateError}
        </div>
      )}
    </div>
  );
}

function KillBanner({ config }: { config: AgentConfig }) {
  if (!config.halted) return null;
  const since = config.halted_at ? timeAgo(config.halted_at) : 'unknown';
  return (
    <div
      className="mb-4 rounded-md px-4 py-3"
      style={{
        background: `${COLORS.accent}12`,
        border: `1px solid ${COLORS.accent}60`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-[10px] font-bold tracking-[0.15em] font-mono"
          style={{ color: COLORS.accent }}
        >
          🛑 AGENT STOPPED
        </span>
        <span className="text-[11px] font-mono" style={{ color: COLORS.textDim }}>
          {since}
        </span>
      </div>
      <div className="text-[13px] mt-1" style={{ color: COLORS.textBright }}>
        {config.halt_reason ?? 'agent stopped (no reason recorded)'}
      </div>
      <div className="text-[11px] mt-1 font-mono" style={{ color: COLORS.textDim }}>
        The owner has to restart it via the "Restart agent" button or by approving the request below.
      </div>
    </div>
  );
}

const APPROVAL_KIND_COLOR: Record<AgentApproval['kind'], string> = {
  phase_flip: COLORS.warning,
  oversize_ticket: COLORS.warning,
  new_ticker: COLORS.blue,
  unwind_all: COLORS.accent,
  resume_after_halt: COLORS.accent,
};

const APPROVAL_KIND_LABEL: Record<AgentApproval['kind'], string> = {
  phase_flip: 'PHASE CHANGE',
  oversize_ticket: 'LARGE TRADE',
  new_ticker: 'NEW TICKER',
  unwind_all: 'CLOSE EVERYTHING',
  resume_after_halt: 'RESTART AGENT',
};

function ApprovalCard({
  approval,
  isOwner,
  onAction,
}: {
  approval: AgentApproval;
  isOwner: boolean;
  onAction: (id: string, status: 'approved' | 'rejected') => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const color = APPROVAL_KIND_COLOR[approval.kind];
  const kindLabel = APPROVAL_KIND_LABEL[approval.kind] ?? approval.kind.replace(/_/g, ' ').toUpperCase();
  const isPending = approval.status === 'pending';
  const expired = isPending && new Date(approval.expires_at) < new Date();

  const act = async (status: 'approved' | 'rejected') => {
    if (!isOwner) return;
    if (!window.confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this ${kindLabel.toLowerCase()}?`)) return;
    setUpdating(true);
    setErr(null);
    try {
      await onAction(approval.id, status);
    } catch (e) {
      setErr(String(e));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div
      className="rounded-md p-3"
      style={{
        background: COLORS.bg,
        border: `1px solid ${isPending ? `${color}60` : COLORS.border}`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span
          className="text-[9px] font-bold tracking-[0.1em] font-mono px-1.5 py-[2px] rounded"
          style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
        >
          {kindLabel}
        </span>
        <span
          className="text-[9px] font-bold tracking-[0.08em] font-mono"
          style={{ color: isPending ? (expired ? COLORS.textDim : COLORS.warning) : COLORS.textDim }}
        >
          {expired ? 'EXPIRED' : approval.status.toUpperCase()}
        </span>
        <span className="text-[11px] font-mono flex-1 text-right" style={{ color: COLORS.textDim }}>
          {timeAgo(approval.created_at)}
        </span>
      </div>
      <div className="text-[13px] leading-[1.5] mb-2" style={{ color: COLORS.textBright }}>
        {approval.rationale}
      </div>
      {approval.proposals.length > 0 && (
        <details>
          <summary
            className="cursor-pointer text-[11px] font-mono"
            style={{ color: COLORS.textDim }}
          >
            {approval.proposals.length} suggested move{approval.proposals.length === 1 ? '' : 's'}
          </summary>
          <div className="flex flex-col gap-1.5 mt-2">
            {approval.proposals.map((p, i) => (
              <div
                key={i}
                className="text-[11px] font-mono leading-[1.45] rounded p-2"
                style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
              >
                <span style={{ color: COLORS.textBright }}>{actionPill(p.action)}</span>{' '}
                <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{p.ticker}</span>{' '}
                <span style={{ color: COLORS.textDim }}>
                  {p.instrument !== 'equity' ? `${p.instrument.replace('_', ' ')} ` : ''}
                  {p.expiry ?? ''} {p.strike != null ? `@${p.strike}` : ''} · {sizeHintLabel(p.size_hint)}
                </span>
                <div style={{ color: COLORS.text }} className="mt-1">
                  {p.rationale}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {isPending && !expired && isOwner && (
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            onClick={() => act('approved')}
            disabled={updating}
            className="text-[10px] font-mono font-bold tracking-[0.1em] px-3 py-1 rounded cursor-pointer"
            style={{
              color: COLORS.positive,
              background: `${COLORS.positive}18`,
              border: `1px solid ${COLORS.positive}40`,
              opacity: updating ? 0.5 : 1,
            }}
          >
            APPROVE
          </button>
          <button
            onClick={() => act('rejected')}
            disabled={updating}
            className="text-[10px] font-mono font-bold tracking-[0.1em] px-3 py-1 rounded cursor-pointer"
            style={{
              color: COLORS.accent,
              background: `${COLORS.accent}18`,
              border: `1px solid ${COLORS.accent}40`,
              opacity: updating ? 0.5 : 1,
            }}
          >
            DECLINE
          </button>
        </div>
      )}
      {err && (
        <div className="text-[11px] mt-2" style={{ color: COLORS.accent }}>
          {err}
        </div>
      )}
    </div>
  );
}

const ORDER_STATUS_COLOR: Record<AgentOrder['status'], string> = {
  queued: COLORS.textDim,
  submitted: COLORS.blue,
  filled: COLORS.positive,
  partially_filled: COLORS.warning,
  canceled: COLORS.textDim,
  rejected: COLORS.accent,
  expired: COLORS.textDim,
};

function OrdersList({ orders }: { orders: AgentOrder[] }) {
  if (orders.length === 0) return null;
  return (
    <div className="mt-5">
      <div
        className="text-[10px] font-bold tracking-[0.15em] font-mono mb-2"
        style={{ color: COLORS.textDim }}
      >
        RECENT TRADES · {orders.length}
      </div>
      <div className="flex flex-col gap-1">
        {orders.map((o) => {
          const statusColor = ORDER_STATUS_COLOR[o.status];
          const instrDetail = o.option_symbol ?? o.instrument;
          return (
            <div
              key={o.id}
              className="rounded px-3 py-2 flex items-center gap-2 flex-wrap text-[11px] font-mono"
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
            >
              <span
                className="font-bold tracking-[0.08em] px-1.5 py-[1px] rounded"
                style={{ color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}30` }}
              >
                {o.status.toUpperCase()}
              </span>
              <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{o.side.toUpperCase()}</span>
              <span style={{ color: COLORS.textBright, fontWeight: 700 }}>{o.ticker}</span>
              <span style={{ color: COLORS.textDim }}>{o.qty} · {instrDetail}</span>
              {o.notional_usd != null && (
                <span style={{ color: COLORS.textDim }}>~${Math.round(o.notional_usd)}</span>
              )}
              {o.filled_avg_price != null && (
                <span style={{ color: COLORS.positive }}>@{o.filled_avg_price.toFixed(2)}</span>
              )}
              <span className="flex-1 text-right" style={{ color: COLORS.textDim }}>
                {timeAgo(o.created_at)}
              </span>
              {o.rejection_reason && (
                <div className="basis-full text-[10px]" style={{ color: COLORS.accent }}>
                  ⚠ {o.rejection_reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AgentDigestSection() {
  const { digests, latestSnapshot, config, approvals, orders, isLoading, error, refetch } = useAgentData();
  const latest = digests[0];
  const activeSleeve = latestSnapshot?.drift?.active_sleeve;
  const hasData = latest !== undefined;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending' && new Date(a.expires_at) > new Date());

  const verdict: VerdictType = !hasData
    ? 'early'
    : latest.kill_switch_triggered
      ? 'confirmed'
      : latest.phase === 'inflection'
        ? 'trending'
        : 'early';

  return (
    <div id="section-agent">
      <SectionCard
        number="07"
        title="What the agent thinks we should do"
        quote="The agent reads the economic data and suggests trades. You decide whether to act. Here's the latest read and what it's recommending."
        verdict={verdict}
        accentColor={COLORS.accent}
      >
        {error && (
          <div
            className="mb-4 rounded-md p-3 text-[12px]"
            style={{
              background: `${COLORS.accent}10`,
              border: `1px solid ${COLORS.accent}40`,
              color: COLORS.accent,
            }}
          >
            Failed to load agent data: {error}
          </div>
        )}

        {config && <KillBanner config={config} />}

        <StatusStrip config={config} latest={latest} digestCount={digests.length} />

        <ActiveSleeveStrip active={activeSleeve} />

        {isLoading && digests.length === 0 ? (
          <div
            className="text-[12px] p-4 rounded-md text-center"
            style={{ color: COLORS.textDim, background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
          >
            Loading digests…
          </div>
        ) : !hasData ? (
          <div
            className="text-[12px] p-4 rounded-md text-center"
            style={{ color: COLORS.textDim, background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
          >
            No digests yet. The agent runs three times: morning (13:15 UTC, Mon–Fri), end of day (19:45 UTC, Mon–Fri), and weekly (Mondays at 12:00 UTC).
          </div>
        ) : (
          <LatestDigest digest={latest} />
        )}

        {digests.length > 1 && (
          <div className="mt-5">
            <div
              className="text-[10px] font-bold tracking-[0.15em] font-mono mb-2"
              style={{ color: COLORS.textDim }}
            >
              EARLIER UPDATES · {digests.length - 1} {digests.length - 1 === 1 ? 'check' : 'checks'}
            </div>
            <div className="flex flex-col gap-1.5">
              {digests.slice(1).map((d) => (
                <HistoryRow key={d.id} d={d} />
              ))}
            </div>
          </div>
        )}

        <ApprovalsBlock approvals={pendingApprovals} config={config} onAction={refetch} />

        <OrdersList orders={orders} />

        <CostSummary digests={digests} />

        <AgentControls config={config} onUpdate={refetch} />
      </SectionCard>
    </div>
  );
}

function ApprovalsBlock({
  approvals,
  config,
  onAction,
}: {
  approvals: AgentApproval[];
  config: AgentConfig | null;
  onAction: () => Promise<void>;
}) {
  const { email } = useAuth();
  const isOwner = !!email && !!config?.owner_email && email === config.owner_email;

  if (approvals.length === 0) return null;

  const handleAction = async (id: string, status: 'approved' | 'rejected') => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error: err } = await supabase
      .from('agent_approvals')
      .update({
        status,
        approved_at: new Date().toISOString(),
        approved_by: email,
      })
      .eq('id', id);
    if (err) throw new Error(err.message);
    await onAction();
  };

  return (
    <div className="mt-5">
      <div
        className="text-[10px] font-bold tracking-[0.15em] font-mono mb-2 flex items-center gap-2"
        style={{ color: COLORS.warning }}
      >
        WAITING ON YOUR OKAY · {approvals.length}
        {!isOwner && (
          <span style={{ color: COLORS.textDim }} className="tracking-normal">
            (sign in as owner to approve or decline)
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {approvals.map((a) => (
          <ApprovalCard key={a.id} approval={a} isOwner={isOwner} onAction={handleAction} />
        ))}
      </div>
    </div>
  );
}
