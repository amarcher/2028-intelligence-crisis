import { useMemo, useState } from 'react';
import { COLORS } from '../../lib/constants';
import { useAgentData } from '../../hooks/useAgentData';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import type { AgentConfig, AgentDigest, AgentProposal, VerdictType } from '../../lib/types';
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
  if (u === 'act_today') return { label: 'ACT TODAY', color: COLORS.accent };
  if (u === 'this_week') return { label: 'THIS WEEK', color: COLORS.warning };
  return { label: 'WAITING', color: COLORS.textDim };
}

function actionPill(a: AgentProposal['action']): string {
  return a.replace('_', ' ').toUpperCase();
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
          {p.size_hint.replace('_', ' ')}
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
      {tickType.toUpperCase()}
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
      {isFlipped ? 'PHASE 2' : 'PHASE 1'}
    </span>
  );
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
        WEEKLY SCORECARD
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
                {key}
              </div>
              <div
                className="text-[11px] font-bold tracking-[0.08em] font-mono mt-1"
                style={{ color }}
              >
                {(state ?? 'pending').toUpperCase()}
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
          🛑 KILL-SWITCH TRIGGERED — agent is recommending a full unwind
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TickTypeBadge tickType={digest.tick_type} />
        <PhaseBadge phase={digest.phase} />
        <span className="text-[12px] font-display font-extrabold" style={{ color: COLORS.textBright }}>
          {digest.fired_count}/5 firing
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
          Drift: {digest.drift_notes}
        </div>
      )}

      {digest.proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-bold tracking-[0.15em] font-mono mt-2"
            style={{ color: COLORS.textDim }}
          >
            PROPOSALS ({digest.proposals.length})
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
            KILL
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
      <MiniStat
        label="STATUS"
        value={enabled ? 'ENABLED' : 'DISABLED'}
        change={config?.killed_reason ? `killed: ${config.killed_reason.slice(0, 50)}` : config ? `mode: ${config.mode}` : 'no config'}
        signal={enabledSignal}
      />
      <MiniStat
        label="PHASE"
        value={latest ? (latest.phase === 'inflection' ? 'PHASE 2' : 'PHASE 1') : '—'}
        change={latest ? `${latest.fired_count}/5 firing` : 'no digests yet'}
        signal={latest?.phase === 'inflection' ? 'alarming' : 'neutral'}
      />
      <MiniStat
        label="LAST TICK"
        value={latest ? timeAgo(latest.created_at) : '—'}
        change={latest ? `${latest.tick_type} · reasoner ${latest.reasoner_status ?? '—'}` : ''}
        signal={latest?.reasoner_status === 'ok' || latest?.reasoner_status === 'retried_ok' ? 'reassuring' : 'neutral'}
      />
      <MiniStat
        label="DIGEST HISTORY"
        value={`${digestCount}`}
        change={digestCount >= 15 ? 'showing 15 most recent' : 'all digests'}
        signal="neutral"
      />
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
    const verb = willEnable ? 'enable' : 'mute';
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
    if (!window.confirm('Reset deadman counter?')) return;
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
            {config?.enabled ? 'MUTE AGENT' : 'ENABLE AGENT'}
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
              RESET DEADMAN ({config?.consecutive_failures ?? 0})
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

export default function AgentDigestSection() {
  const { digests, config, isLoading, error, refetch } = useAgentData();
  const latest = digests[0];
  const hasData = latest !== undefined;

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
        title="Agent Digest"
        quote="The agent reads signals, writes proposals. You execute. Here is what it saw last and what it wants you to do."
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

        <StatusStrip config={config} latest={latest} digestCount={digests.length} />

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
            No digests yet. Wait for the next scheduled tick (premarket 13:15 UTC, close 19:45 UTC Mon–Fri, weekly Mon 12:00 UTC).
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
              HISTORY · {digests.length - 1} prior {digests.length - 1 === 1 ? 'digest' : 'digests'}
            </div>
            <div className="flex flex-col gap-1.5">
              {digests.slice(1).map((d) => (
                <HistoryRow key={d.id} d={d} />
              ))}
            </div>
          </div>
        )}

        <CostSummary digests={digests} />

        <AgentControls config={config} onUpdate={refetch} />
      </SectionCard>
    </div>
  );
}
