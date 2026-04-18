# Execution Plan — Signal-Only Agent for the 2028 Crisis Thesis

## Context

The Phase-Flip Signals panel computes a live 0/5 trigger state against the 2028 GIC hypothesis. This execution plan wires a **signal-only agent** behind it that:

- Re-evaluates signals on a near-daily cadence (pre-open, mid-day, post-close).
- Proposes trades consistent with the "delayed-but-correct" playbook (`~/.claude/plans/let-s-say-that-we-resilient-fountain.md`).
- Delivers each batch of proposals as a **digest** to the human via email + Slack.
- **Does not execute.** The human reviews and places trades manually in whatever broker they already use.

This is the inverse of the original plan. The agent is research staff, not a trader. No brokerage integration, no options clearance, no paper soak, no real-money caps to negotiate. Automated execution stays on the roadmap as an optional future extension — not a precondition.

---

## Guiding principles

1. **The dashboard is the brain. The agent is the newsroom.** All proposals trace back to signals already visible to a human looking at the site. No black-box alpha. If a proposal can't be justified from the panel, the agent doesn't write it.
2. **Human in the loop by default, not by exception.** The human is always the executor. The agent never touches capital.
3. **Proposals are disposable.** Every proposal has a 24-hour freshness window. If you didn't act on it, it's gone — the next tick regenerates based on current state, not yesterday's stale advice.
4. **Anti-recommendations are as important as recommendations.** "Hold, thesis working" and "unwind, thesis invalidated" are first-class outputs. Silence is not a strategy.
5. **Mirror existing infra.** The repo already uses Supabase Edge Functions + pg_cron for FRED/SEC ingestion. The agent extends that pattern rather than introducing a new host.

---

## Architecture overview

```
 ┌──────────────────────────────────────────────────────────┐
 │                   Supabase (existing + new)               │
 │                                                           │
 │  economic_data ─┐                                         │
 │  predictions  ──┼──► agent_snapshots (per tick)           │
 │  verdicts ──────┘        │                                │
 │                          ▼                                │
 │                  agent_digests (per tick output)          │
 │                    — proposals: list of suggested moves   │
 │                    — rationale: why, based on which sigs  │
 │                    — phase + drift summary                │
 └───────────────┬──────────────────────────────┬───────────┘
                 │                              │
                 ▼                              ▼
   ┌──────────────────────────┐    ┌───────────────────────┐
   │ Edge Function: agent-tick│    │ React dashboard panel │
   │ (3× daily via pg_cron)   │    │ /agent (new route)    │
   │                          │    │ — today's digest      │
   │ 1. Pull signals          │    │ — last 30 days log    │
   │ 2. Prompt Claude         │    │ — thesis drift chart  │
   │ 3. Write digest row      │    └───────────────────────┘
   │ 4. Notify (email+Slack)  │
   └──────────┬───────────────┘
              │
              ▼
    ┌────────────────────┐
    │ Email (Resend)     │   ← human reads, decides, places
    │ + Slack webhook    │     trades in their own broker
    └────────────────────┘
```

No brokerage in the diagram. That's the point.

---

## Components

### 1. Data the agent reads each tick

| Source | What | Already in repo? |
|---|---|---|
| `economic_data` table | FRED series used by the 5 signals (JTSJOL, ICSA, SP500, CSUSHPISA) + SaaS series | ✓ |
| `predictions` / `verdicts` | editorial truth table | ✓ |
| `agent_digests` (last 30 days) | memory — what did I propose before, did the thesis drift in between | new table |

**One upgrade worth making** to the dashboard's signal set: add VIX + breadth proxies to improve the "S&P peak stall" detector. Propose adding `^VIX`, `^VIX3M`, and an advance-decline spread series to `economic_data` and wiring them into Trigger 4.

**Not needed** (was needed in the original plan, isn't now): Alpaca account data, options chains, live position reconciliation, order state. Signal-only has no state to reconcile.

### 2. Scheduler — Supabase pg_cron + Edge Function

Mirror the existing `fetch-saas-revenue` pattern:

```
supabase/functions/agent-tick/index.ts          ← agent loop
supabase/migrations/003_agent_schema.sql        ← new tables
supabase/migrations/004_agent_cron.sql          ← pg_cron schedules
```

**Cron schedule** (all US Eastern, stored as UTC):
- `09:15 ET` — pre-market digest; the one you read with coffee before deciding if anything needs a trade today.
- `15:45 ET` — pre-close digest; covers intraday drift and anything the pre-market version missed.
- Weekly Mon `08:00 ET` — "State of the thesis" — longer-form, includes a re-scored scorecard of all 5 triggers, P&L-style attribution against your benchmark if you've been tracking fills, and explicit kill-switch monitoring.

Skipped: the mid-day tick. Without auto-execution, there's nothing a mid-day digest unlocks that the pre-close one doesn't.

Market-hours guard in SQL: skip on US market holidays + weekends (weekly digest still runs on Mondays regardless).

### 3. Agent reasoner — Claude via Anthropic SDK

Each tick:
1. Build a structured input: current signal state, prior digest (last tick), prior 5 digests (memory), phase change vs. last tick, and drift summary ("JOLTS fell 0.3M week-over-week, SaaS basket unchanged, S&P up 2.1%").
2. Prompt Claude with the playbook + tick-type (premarket/close/weekly) + recommendation rubric.
3. Expect **structured output** (tool use / JSON) matching the digest schema (below). No free-form prose outside the `narrative` field.
4. Validate proposals against the soft-guardrail filter (next section) — anything off-whitelist or disallowed gets dropped with a logged reason.
5. Write the digest row; fire email + Slack.

**Model**: Claude Sonnet 4.6 for daily digests (fast, cost-effective). Opus 4.7 for the weekly "state of the thesis" digest (higher reasoning matters most there). Prompt caching on the playbook + rubric — ~90% token cost reduction across ticks.

**Proposal schema** (what one digest row looks like in JSON):

```ts
{
  tick_type: 'premarket' | 'close' | 'weekly',
  phase: 'counterfactual_grind' | 'inflection',
  fired_count: number,              // 0..5
  kill_switch_triggered: boolean,
  narrative: string,                // 2-3 sentences, human-readable
  proposals: Array<{
    action: 'open' | 'add' | 'trim' | 'close' | 'roll' | 'hold' | 'unwind_all',
    ticker: string,                 // must be on whitelist (except for 'hold'/'unwind_all')
    instrument: 'equity' | 'put' | 'call' | 'put_spread' | 'call_spread',
    expiry?: string,                // 'Jan 2027', etc. — for options
    strike?: number,
    size_hint: 'starter' | 'half' | 'full' | 'trim_third' | 'trim_half',
    rationale: string,              // why now, which signal, how does it tie to the playbook
    urgency: 'act_today' | 'this_week' | 'waiting_for_trigger',
  }>,
  drift_notes: string,              // one-liner summary of counterfactual-vs-thesis drift
  scorecard: {                      // weekly only
    jolts: 'fired' | 'pending' | 'reversed',
    claims: 'fired' | 'pending' | 'reversed',
    saas: 'fired' | 'pending' | 'reversed',
    sp500_stall: 'fired' | 'pending' | 'reversed',
    housing: 'fired' | 'pending' | 'reversed',
  }
}
```

### 4. Soft guardrails (filter, not middleware)

Without execution, there are no *hard* constraints — nothing bad happens if the LLM proposes a weird trade; the human just ignores it. But we still want the agent to stay in-lane:

```ts
// supabase/functions/agent-tick/filter.ts
WHITELIST = [
  // same list as the original plan — longs, hedges, asymmetric puts, indices, vol
  'QQQ','SMH','IGV','NVDA','AVGO','ORCL','ANET','VRT','CEG','MSFT','GOOGL','META',
  'TLT','GLD','IAU','XLP','KO','PG','COST','WMT',
  'NOW','CRM','HUBS','WDAY','DDOG','FRSH',
  'KRE','HYG','JNK','IYR','VNQ','BXP','SLG',
  'ITB','XHB','OPEN','Z','RDFN',
  'XLY','RH','W','CCL','NCLH','UPWK','FIVN',
  'SPY','IWM','VIXY',
];

DISALLOWED_RECOMMENDATIONS = [
  'naked short equity',
  'short call without cover',
  'leveraged ETF recommendations (SPXS/SQQQ/SRTY) flagged but not blocked — require narrative justification',
  'crypto, futures, forex',
  'margin use',
  'options DTE < 30 days for single-name short thesis (force LEAPS or 3-6 month minimum)',
];
```

Filter is advisory: proposals that violate these get flagged in the digest ("⚠ agent recommended X, filter dropped because Y") rather than silently removed. That way you see what the agent *tried* to say, even when it's wrong.

### 5. Kill switches (reasoning-layer, not execution-layer)

Because no execution exists, the kill switches become **digest content**, not system halts:

1. **Drawdown halt** — N/A. There's no account to halt.
2. **Anti-thesis kill switch** (from the playbook): if any 2 of {JOLTS > 8M for 2 quarters, ServiceNow/Workday accelerate 2 quarters in a row, UNRATE < 3.8% in 2027, M2V > 1.45 + savings rate < 5%, S&P > 8,500 with broadening breadth} fire, the digest **leads with a big red `UNWIND RECOMMENDED`** banner and the proposals section is replaced with an `unwind_all` action. The human decides whether to unwind for real.
3. **Deadman's switch**: if `agent-tick` fails ≥ 3 consecutive runs, cron halts itself via a flag in `agent_config` and emails you. Same as the FRED/SaaS ingest deadman pattern.
4. **Manual mute**: a `/agent` dashboard button flips `agent_config.enabled = false`. Digests stop firing until you re-enable. Useful during vacation, or when you want to opt out of noise for a news cycle you're already tracking yourself.

### 6. Digest delivery — email + Slack

**Email** via Resend (generous free tier, clean API, works with any custom domain). One-time setup: add `RESEND_API_KEY` to Supabase Edge Function secrets, pick a sender address.

**Slack** via incoming webhook. One-time setup: create an app in your workspace, enable incoming webhooks, drop the URL into `SLACK_WEBHOOK_URL` secret. 10 minutes end-to-end.

**Format**: both channels get a compact Markdown/MRKDWN block — phase, fired count, 1-line narrative, bulleted proposals with ticker + size hint + urgency, a permalink to the full digest on `/agent`. Heavy detail stays on the web, the channels are for "should I look at the dashboard today."

### 7. Dashboard route (`/agent`)

Extends the existing Vite dashboard with a new page:

1. **Today's digest** — latest `agent_digests` row, rendered with the same SectionCard visual language used on the homepage. Big phase banner, narrative, proposals table, drift note.
2. **History** — last 30 days of digests, collapsible. Filter by phase, filter by tick type.
3. **Drift panel** — compact chart showing the 5 trigger metrics over the last 90 days, with thesis-trajectory line overlay. Lets you eyeball "am I still on the thesis path or is it diverging?"
4. **Scorecard diff** — weekly digest vs. 4 weeks ago. Shows movement.
5. **Mute / enable button** + last-run timestamp at the bottom.

Auth: Supabase Auth, owner email only — same as the original plan.

---

## Agent reasoning policy

On every tick, the reasoner evaluates in this fixed order. The structured output must answer each step explicitly.

1. **Kill-switch check** — scan the 5 anti-thesis signals. If ≥ 2 are active, set `kill_switch_triggered = true` and emit a single `unwind_all` proposal. Stop. No other proposals this tick.
2. **Phase state check** — compute fired-count from the Phase-Flip signals.
   - 0→1: no change; single-signal firings are noise.
   - 1→2 (Phase 1 → Phase 2): the digest's headline flips; proposals emphasize closing Phase-1 longs and opening Phase-2 shorts. Urgency `act_today` on the top 3 proposals.
   - 2→1: retracement; no action, log observation in `drift_notes`.
3. **Thesis drift assessment** — compare current FRED prints vs. last week's to label direction:
   - Thesis-aligned (JOLTS falling, claims rising, SaaS slowing): proposals skew toward `hold` + small `add` to existing positions.
   - Counterfactual (JOLTS rising, SaaS re-accelerating, S&P ripping): proposals skew toward `trim` on asymmetric book, `add` to defensive carry.
4. **Position hygiene reminders** (the agent can't see your positions, so these are calendar-based):
   - Weekly: "Any LEAPS in your book with DTE < 90? Roll to next Jan expiry."
   - Monthly: "Any profitable put ≥ 2× entry? Remember rule-of-thirds."
5. **Idle** — if nothing else is happening, emit a single `hold` proposal with narrative "Thesis working. No action required."

The reasoner never invents tickers off the whitelist, never omits the narrative, and never emits more than 6 proposals in a single digest (noise floor).

---

## New Supabase schema (migration 003 — signal-only)

```sql
-- 003_agent_schema.sql (signal-only variant)

create table agent_config (
  id int primary key default 1,
  enabled boolean not null default true,
  mode text not null default 'signal_only'  -- forward-compat for 'auto_execute' later
    check (mode in ('signal_only','auto_execute')),
  consecutive_failures int not null default 0,
  killed_reason text,
  updated_at timestamptz default now(),
  check (id = 1)
);

create table agent_snapshots (
  tick_id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  tick_type text check (tick_type in ('premarket','close','weekly')),
  signals jsonb not null,    -- the 5 triggers + phase + fired count at snapshot time
  drift jsonb                -- week-over-week deltas summary
);

create table agent_digests (
  id uuid primary key default gen_random_uuid(),
  tick_id uuid references agent_snapshots(tick_id),
  created_at timestamptz default now(),
  tick_type text not null,
  phase text not null,
  fired_count int not null,
  kill_switch_triggered boolean not null default false,
  narrative text not null,
  proposals jsonb not null,  -- array of proposal objects
  drift_notes text,
  scorecard jsonb,           -- weekly only; null otherwise
  delivered_email boolean default false,
  delivered_slack boolean default false
);
```

No `agent_trades`, `agent_positions_cache`, `agent_approvals`, or Alpaca-related tables. Those come back only if the "auto-execution" extension gets greenlit later.

RLS: admin-only for write (service role key), authenticated read for the UI owner.

---

## Implementation tasks (signal-only scope)

Ordered; each should be a single PR. No phase gating needed because there's no real money at risk — just ship incrementally.

1. **Schema** (`supabase/migrations/003_agent_schema.sql`). Seed `agent_config` with `enabled=true, mode='signal_only'`.
2. **Shared signal library** — extract the trigger computation from `PhaseFlipSignals.tsx` into `src/lib/signals.ts` so the Edge Function and the dashboard panel share one implementation. Refactor the panel to consume the new lib.
3. **Edge Function skeleton** (`supabase/functions/agent-tick/index.ts`) — no Claude yet. Snapshots signals + computes drift → writes one `agent_snapshots` + one stub `agent_digests` row. Run manually; verify rows land.
4. **pg_cron schedule** (`004_agent_cron.sql`) — 3 schedules (premarket, close, weekly) with market-hours guard.
5. **Claude integration** — reasoner module with structured-output tool-use and prompt caching. Unit tests against canned snapshots (thesis-aligned, counterfactual, Phase-flipped, kill-switch triggered).
6. **Soft-guardrail filter** — whitelist + disallowed-recommendation scanner. Proposals that fail are annotated, not dropped silently.
7. **Digest delivery** — Resend email + Slack webhook. Markdown templates. Retry on transient failure.
8. **VIX + breadth ingest** (optional but worth it) — extend the FRED ingest or add Yahoo Finance as a source for `^VIX` and `^VIX3M`. Update Trigger 4.
9. **`/agent` dashboard route** — today's digest, history, drift panel, scorecard diff, mute button.
10. **Auth** — Supabase Auth with owner email whitelist for mute-button writes.
11. **Deadman's switch** — increment `consecutive_failures` on tick error; at 3, flip `enabled=false` and email.

Tasks 1–4 = "the agent exists and runs on schedule." 5–7 = "the digest has real content and reaches you." 8–11 = polish.

Target: tasks 1–7 in ~1 week of focused work. 8–11 another week.

---

## Optional future extension — automated execution

If, after running signal-only for months, you want the agent to actually place trades, the existing plan content for Alpaca integration is the on-ramp. It's already drafted and can live as an appendix here or as a separate `docs/agent-auto-execution.md` when that time comes. Requirements don't change; what changes is you add:

- Alpaca paper + live integration
- Hard guardrail middleware (position caps, daily loss stop, drawdown halt)
- Human approval UI for phase flips and > 5% tickets
- The 30-day paper soak gate

Signal-only mode and auto-execution mode can coexist in the same codebase — the `agent_config.mode` column controls which code path runs post-reasoning.

---

## Remaining open questions

The original 7 questions collapsed to 4 because broker, account caps, and options clearance became moot:

1. **Alerting channel confirmation** — email + Slack webhook, or do you want just one?
2. **Whitelist policy** — frozen at launch with agent *proposing* additions as digest items you can act on manually, or is the whitelist fully editable by you at any time via the dashboard?
3. **Benchmark of record** — if you're manually placing trades and want the weekly digest to include a P&L comparison, you'd need to log your fills somewhere. Two options: (a) skip the benchmark and leave P&L tracking to you; (b) add a lightweight fill-logging UI on `/agent` where you paste fills and the digest tracks vs. QQQ/SPY. Recommend (a) at launch, (b) later if you actually want the metric.
4. **Kill-switch contact** — same email+Slack for anti-thesis kill-switch as for daily digests, or a separate channel/address so it doesn't get lost in the daily stream?

---

## Verification checklist (before going live)

- [ ] Insert a synthetic `agent_snapshots` row where 3 triggers are fired — reasoner emits a Phase-flip digest with `urgency: 'act_today'` on at least 3 proposals, email + Slack both deliver.
- [ ] Insert a synthetic row with 2 anti-thesis signals firing — digest leads with `kill_switch_triggered: true` and a single `unwind_all` proposal.
- [ ] Submit a mocked LLM output with an off-whitelist ticker — filter annotates the digest with the dropped proposal + reason.
- [ ] Kill the Edge Function 3 ticks in a row — `consecutive_failures` increments, `enabled` flips to false at 3, deadman email lands.
- [ ] Mute button on `/agent` — digests stop firing within one tick cycle.
- [ ] Visit `/agent` as an unauthenticated user — read-only access to today's digest works, mute button hidden/disabled.
