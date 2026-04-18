# Execution Plan — Autonomous "Fun Money" Trading Agent

## Context

The Phase-Flip Signals panel computes a live 0/5 trigger state against the 2028 GIC hypothesis. This execution plan wires a trading agent behind it that:

- Re-evaluates signals on a near-daily cadence (pre-open, mid-day, post-close).
- Proposes and executes trades consistent with the "delayed-but-correct" playbook (`~/.claude/plans/let-s-say-that-we-resilient-fountain.md`).
- Treats the dashboard as its sanity-check: thesis-aligned movement → hold; counterfactual drift → small rebalance; phase-flip signal ≥ 2 → propose a pivot and wait for human approval.

The agent manages a separate, size-capped "fun money" account — never comingled with long-term assets.

---

## Guiding principles

1. **The dashboard is the brain. The agent is the hand.** All decisions trace back to signals that are already visible to a human looking at the site. No black-box alpha. If a trade can't be justified from the panel, the agent doesn't do it.
2. **Hard caps in code beat soft caps in prompts.** Position sizes, daily notional, and max-loss are enforced by middleware, not by asking the LLM nicely.
3. **Paper-first, forever.** Every new behavior runs against Alpaca paper for ≥ 30 calendar days before touching live capital.
4. **Two-key for irreversible moves.** Phase flips, new tickers, and any single trade > 5% of account require human approval before execution.
5. **Mirror existing infra.** The repo already uses Supabase Edge Functions + pg_cron for FRED/SEC ingestion. The agent extends that pattern rather than introducing a new host.

---

## Architecture overview

```
 ┌───────────────────────────────────────────────────────────────────┐
 │                       Supabase (existing + new)                    │
 │                                                                    │
 │  economic_data ─┐                                                  │
 │  predictions  ──┼──► agent_snapshot (daily)                        │
 │  verdicts ──────┘        │                                         │
 │                          ▼                                         │
 │                  agent_decisions (proposed)                        │
 │                          │                                         │
 │                          ▼                                         │
 │                  agent_approvals (human-gated for Phase-flip /     │
 │                    new symbol / >5% tickets)                       │
 │                          │                                         │
 │                          ▼                                         │
 │                  agent_trades (executed)                           │
 │                  agent_positions (Alpaca sync)                     │
 └───────────────┬────────────────────────────────┬──────────────────┘
                 │                                │
                 ▼                                ▼
   ┌──────────────────────────┐    ┌──────────────────────────┐
   │ Edge Function: agent-tick│    │  React dashboard panel:  │
   │ (3× daily via pg_cron)   │    │  /agent (new route)      │
   │                          │    │  — what the agent sees   │
   │ 1. Pull signals          │    │  — pending approvals     │
   │ 2. Pull positions        │    │  — trade log + P&L       │
   │ 3. Prompt Claude         │    │  — kill-switch button    │
   │ 4. Validate + cap        │    └──────────────────────────┘
   │ 5. Execute / queue       │
   │ 6. Log everything        │
   └──────────────────────────┘
                 │
                 ▼
          ┌───────────────┐
          │ Alpaca        │
          │ paper → live  │
          │ (options-enab)│
          └───────────────┘
```

---

## Components

### 1. Brokerage — Alpaca

**Why Alpaca**: free paper + live accounts on the same API; options trading level up to 3 (sufficient for puts, put spreads, covered calls); REST + websocket; fractional shares; OCO/bracket orders; generous rate limits; industry-standard for algo/retail.

**Alternatives considered**:
- **IBKR**: most powerful, but the gateway + auth model is painful and the API is complex — not a solo-project fit.
- **Tradier**: clean options API, small ecosystem, higher friction.
- **Robinhood / Schwab / E*Trade**: no first-class developer API. Non-starter.

**Required account setup** (user must do manually):
1. Create Alpaca paper account → get `APCA_PAPER_KEY_ID` + `APCA_PAPER_SECRET_KEY`.
2. Apply for Options Trading Level 2 (buy puts/calls, defined-risk spreads). Level 3 (naked) is **not** required and should be refused — defined risk only.
3. When graduating to live: separate live account, capped at fun-money budget. Issue fresh keys.

Keys go into Supabase Edge Function secrets (same pattern as `FRED_API_KEY`).

### 2. Data the agent reads each tick

| Source | What | Already in repo? |
|---|---|---|
| `economic_data` table | FRED series used by the 5 signals (JTSJOL, ICSA, SP500, CSUSHPISA) + SaaS series | ✓ |
| `predictions` / `verdicts` | editorial truth table | ✓ |
| Alpaca `/v2/account`, `/v2/positions`, `/v2/orders` | cash, buying power, current positions, open orders | needs integration |
| Alpaca `/v2/options/snapshots` | options chain + greeks + IV for the ticker whitelist | needs integration |
| Alpaca `/v1beta1/quotes` + `/stocks/bars` | equity bars + VIX, for drift detection | needs integration |
| `agent_decisions` (last 30 days) | memory — what did I propose, what did I do, was I right | new table |

**VIX / breadth as the one upgrade** to the dashboard's signal set: the plan needs a "the S&P bubble is topping" detector, and breadth divergence is the standard confirm. Propose adding `^VIX`, `^VIX3M`, and `$ADSPD` (A-D spread) to `economic_data` and wire into Trigger 4.

### 3. Scheduler — Supabase pg_cron + Edge Function

Mirror the existing `fetch-saas-revenue` pattern:

```
supabase/functions/agent-tick/index.ts          ← agent loop
supabase/migrations/003_agent_schema.sql        ← new tables
supabase/migrations/004_agent_cron.sql          ← pg_cron schedules
```

**Cron schedule** (all Eastern Time, converted to UTC in SQL):
- `09:15 ET` — pre-market signal refresh; no trading, just state snapshot + pending-order review
- `11:00 ET` — post-open tick; evaluate yesterday's fills, run agent, execute approved orders
- `15:45 ET` — pre-close tick; last chance to rebalance; never opens new positions in final 5 min
- Weekly Mon `08:00 ET` — generate a rebalance proposal that requires human approval before market open

The market-hours guard is enforced in SQL: skip the job if it's a US market holiday or weekend. Holiday list is hardcoded and refreshed annually.

### 4. Agent reasoner — Claude via Anthropic SDK

Each tick:
1. Build a structured input: signal state, positions, recent decisions (memory), pending approvals, open orders.
2. Prompt Claude with the playbook + tick-type (morning/midday/close/weekly) + hard constraints.
3. Expect **structured output** (tool use / JSON): a list of `{action, ticker, side, quantity, reason, requires_approval}` proposals. No free-form prose commits to state.
4. Validate every proposal against the guardrail middleware (next section). Anything that fails caps or whitelist → rejected, logged, surfaced in UI.
5. Executable proposals go to Alpaca; approval-required proposals land in `agent_approvals` with a UI notification.

**Model**: Claude Sonnet 4.6 for daily ticks (cost-effective, fast). Opus 4.7 for the weekly rebalance proposal (higher reasoning quality where it matters most). Prompt caching on the playbook + guardrail text (both are static across ticks) — ~90% token cost reduction.

### 5. Guardrail middleware (code, not prompt)

Every proposed trade passes through `validateTrade()` which rejects if any rule is violated. The LLM cannot override these.

```
// supabase/functions/agent-tick/guardrails.ts
CAPS = {
  accountNotional: 'env: AGENT_ACCOUNT_CAP_USD',     // hard ceiling; refuse deposits beyond
  singleTicketMaxPct: 5,                              // one fill ≤ 5% of account
  singleNamePositionMaxPct: 15,                       // total exposure to any one symbol
  dailyGrossNotionalPct: 20,                          // total trading volume per day
  maxDailyLossPct: 4,                                 // auto-halt when breached
  maxOpenOptionTickets: 12,                           // complexity ceiling
}
WHITELIST = [
  // Longs (Phase 1 bubble-ride)
  'QQQ','SMH','IGV','NVDA','AVGO','ORCL','ANET','VRT','CEG','MSFT','GOOGL','META',
  // Hedges / defensive
  'TLT','GLD','IAU','XLP','KO','PG','COST','WMT',
  // Asymmetric thesis puts
  'NOW','CRM','HUBS','WDAY','DDOG','FRSH',            // SaaS
  'KRE','HYG','JNK','IYR','VNQ','BXP','SLG',           // credit + CRE
  'ITB','XHB','OPEN','Z','RDFN',                       // housing
  'XLY','RH','W','CCL','NCLH','UPWK','FIVN',           // consumer / staffing
  // Indices
  'SPY','IWM',
  // Volatility
  'VIXY',
]
DISALLOWED = [
  'naked short equity', 'short call without cover',
  'leveraged ETF > 5% of account (SPXS/SQQQ/SRTY only via explicit human approval)',
  'crypto', 'leverage > 1x via margin',
  'any options > 60 DTE for single-name shorts in Phase 2',  // force roll to LEAPS in Phase 1
  'any symbol not on WHITELIST',
]
```

### 6. Kill switches

Hardcoded, always-on, independent of LLM output:

1. **Drawdown halt**: any single trading day where account P&L ≤ −4% → cancel all open orders, halt new entries, email/Slack alert, require human resume.
2. **Anti-thesis kill switch** (from the playbook): if any 2 of {JOLTS > 8M for 2 quarters, ServiceNow/Workday accelerate 2 quarters in a row, UNRATE < 3.8% in 2027, M2V > 1.45 + savings rate < 5%, S&P > 8,500 with broadening breadth} fire, the agent unwinds the asymmetric book over 5 trading days and halts new entries. This unwind still pauses at 50% complete for human confirmation.
3. **Deadman's switch**: if the agent-tick function fails ≥ 3 consecutive runs, cron halts itself via a flag in `agent_config` and alerts the user. No silent failure.
4. **Manual kill**: a `/agent` dashboard button flips `agent_config.enabled = false` and cancels all open orders on next tick (or immediately via the same button hitting Alpaca).

### 7. Human approval UI (new dashboard route)

`src/pages/Agent.tsx` — React route mounted at `/agent`. Four sections:

1. **Status header**: enabled/disabled, phase (1/2), fired-count, last-tick timestamp, cash, total equity, day P&L, cumulative P&L vs. buy-hold QQQ benchmark.
2. **Pending approvals**: list of `agent_decisions` with `requires_approval = true`. Each has ticker, size, reason, a green "Approve" and red "Reject" button. Approvals expire 24h.
3. **Trade log**: last 30 days of fills with reasoning snippet.
4. **Signal diff**: side-by-side of last tick's signal state vs. 7 days ago, to surface drift the agent may have missed.

Auth: Supabase Auth with a single whitelisted email. The approval row flip is the only write from the client.

---

## Agent decision policy

On every tick, the reasoner evaluates in this fixed order. It must justify each step in its structured output.

1. **Kill switches** — if any are triggered, the ONLY allowed action is cancel + halt. Stop.
2. **Phase state check** — compute fired-count from signals. If phase changed since last tick:
   - 0→1: no action (single signal can be noise).
   - 1→2 (Phase 1 → Phase 2): propose the flip trade plan — close bubble longs, roll SaaS LEAPS nearer-dated, add SPY/QQQ put spreads, add HYG/KRE shorts. **`requires_approval = true`** for the whole plan.
   - 2→1: single signal retracing; no action, log observation.
3. **Thesis drift** — compare current FRED prints vs. the dashboard's "trending" trajectory:
   - Strongly thesis-aligned (JOLTS down, claims up, SaaS slowing): hold, do not add size unless an existing position is down > 15% on counterfactual-driven vol.
   - Strongly counterfactual (JOLTS up, SaaS re-accelerating, S&P ripping to new highs on broadening breadth): trim asymmetric book up to 10% of current notional; add small to defensive carry.
4. **Position hygiene**:
   - Any single-name position > 15% of account → trim to 12%.
   - Any LEAPS with DTE < 90 → roll to next Jan expiry (size-preserving).
   - Any profitable put hitting 2× entry → sell 1/3 (rule of thirds).
   - Any losing ticket sized to entry cost → do nothing (options are already leveraged; no double-downs).
5. **Idle** — if nothing above triggers, explicitly log "no action; thesis working."

The reasoner never invents symbols, never sizes beyond caps, never opens positions in the final 5 minutes of the session, and never acts on the weekly proposal without human approval.

---

## New Supabase schema (migration 003)

```sql
-- 003_agent_schema.sql (summary — full DDL in migration)

create table agent_config (
  id int primary key default 1,
  enabled boolean not null default false,
  paper_mode boolean not null default true,
  account_cap_usd numeric not null,
  killed_reason text,
  updated_at timestamptz default now(),
  check (id = 1)
);

create table agent_snapshots (
  tick_id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  tick_type text check (tick_type in ('premarket','midday','close','weekly')),
  signals jsonb not null,       -- the 5 triggers + phase + fired count
  positions jsonb not null,     -- Alpaca positions snapshot
  account jsonb not null        -- cash, equity, buying power
);

create table agent_decisions (
  id uuid primary key default gen_random_uuid(),
  tick_id uuid references agent_snapshots(tick_id),
  created_at timestamptz default now(),
  action text not null,         -- 'buy','sell','roll','cancel','halt','hold'
  ticker text,
  side text,
  quantity numeric,
  limit_price numeric,
  reason text not null,
  requires_approval boolean default false,
  status text default 'pending' -- 'pending','approved','rejected','executed','expired','failed'
);

create table agent_approvals (
  decision_id uuid references agent_decisions(id) primary key,
  approved_at timestamptz,
  approved_by text
);

create table agent_trades (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references agent_decisions(id),
  alpaca_order_id text unique,
  filled_at timestamptz,
  filled_qty numeric,
  filled_avg_price numeric,
  fees numeric,
  raw jsonb                     -- full Alpaca order payload
);

create table agent_positions_cache (
  ticker text primary key,
  qty numeric,
  avg_entry numeric,
  market_value numeric,
  unrealized_pl numeric,
  synced_at timestamptz
);
```

RLS: admin-only for write, authenticated read for the UI owner.

---

## Phased rollout

| Phase | Duration | Capital | Agent powers | Gate to advance |
|---|---|---|---|---|
| **A · Read-only shadow** | 1–2 weeks | $0 | Runs 3× daily. Writes decisions. **No Alpaca connection.** UI shows "what would have been done." | ≥ 30 ticks completed without errors; human reviews decisions and agrees ≥ 80% pass muster. |
| **B · Paper trading** | 30+ calendar days | $100k paper | Wire Alpaca paper API. Agent executes all non-approval decisions against paper. Weekly rebalance still requires click-through. | Positive or flat cumulative P&L vs. QQQ benchmark + zero cap violations + zero disallowed actions attempted. |
| **C · Small live** | open-ended | $500–5,000 real | Live Alpaca keys. Same caps scaled to real account. Phase-flip still human-gated. | User-driven — graduate to D only if comfortable. |
| **D · Scale** | open-ended | user-defined within fun-money cap | Same mechanics, larger caps. Still hard-coded ceilings. | — |

**Do not** deploy Phase B until a dry-run of the entire loop (including a simulated kill-switch + simulated Phase-flip) runs clean against the shadow environment for a week.

---

## Implementation tasks (bite-sized)

Ordered; each should be a single PR.

1. **Schema + config table** (`supabase/migrations/003_agent_schema.sql`). Seed `agent_config` with `enabled=false, paper_mode=true, account_cap_usd=0`.
2. **Shared TypeScript types** in `src/lib/types.ts` + `supabase/functions/_shared/` (signal shape, decision shape — reused by Edge Function and dashboard).
3. **Signal computation library** extracted from `PhaseFlipSignals.tsx` so the Edge Function and the component share one implementation. Move trigger logic to `src/lib/signals.ts`.
4. **`agent-tick` Edge Function skeleton** — no LLM, no Alpaca. Just snapshots signals + positions (positions mocked initially) → writes `agent_snapshots`. Run manually; verify rows land.
5. **pg_cron schedule** for the Edge Function (`004_agent_cron.sql`).
6. **Claude integration** — reasoner module with structured-output tool-use. Prompt caching. Unit tests against canned snapshots.
7. **Guardrail middleware** — `validateTrade()` + whitelist/caps tests. 100% branch coverage required before advancing.
8. **Alpaca client** — thin wrapper, paper only. `getAccount`, `getPositions`, `placeOrder`, `cancelAll`, `getOptionsChain`. Each with retry + rate-limit handling.
9. **Wire reasoner → guardrails → Alpaca (paper)**. Kill switches active from day one.
10. **`/agent` dashboard route** — status, pending approvals, trade log, kill button.
11. **Auth** — Supabase Auth with owner email whitelist for the approval writes + kill button.
12. **Alerting** — email or Slack webhook on kill-switch, on phase-flip proposal, on 3 consecutive tick failures.

Tasks 1–4 = Phase A. Tasks 5–12 + 30-day paper soak = Phase B.

---

## Open questions for the user

1. **Account cap for paper soak and for Phase C live?** (e.g., paper $100k, live $2,000 to start.)
2. **Broker choice confirmation — Alpaca OK?** If you already have a funded account elsewhere (Schwab, Fidelity, IBKR), the architecture holds but the Alpaca module becomes a different adapter.
3. **Which alerting channel** — email, Slack, SMS (Twilio), iOS push? Agent can't phone home without one.
4. **Options clearance level** you have or are willing to apply for on Alpaca? (Level 2 minimum for this plan. If only Level 1, the book is equity-only and the SaaS LEAPS component is replaced with outright short positions on those names — a meaningfully worse risk/reward.)
5. **Should the agent be allowed to recommend (not execute) additions to the ticker whitelist**, surfaced as human approvals? Or is the whitelist frozen?
6. **Benchmark of record** for "is the agent adding value?" — buy-and-hold QQQ, buy-and-hold SPY, or a 60/40?
7. **Kill-switch contact point** — if the agent halts itself, who does it page, and how fast is "fast enough"?

---

## Verification (end-to-end test checklist before ANY live capital)

- [ ] Insert a synthetic `agent_snapshots` row where 3 triggers are fired — reasoner proposes the Phase-flip plan and every proposal lands in `agent_approvals` with `requires_approval=true`.
- [ ] Submit an artificial LLM output that proposes a disallowed action (naked short, off-whitelist symbol, 20% ticket) — guardrail rejects and logs each rejection reason.
- [ ] Force a 5% intraday drawdown in paper — kill switch fires, all open orders are cancelled, `agent_config.enabled` flips to false, alert lands.
- [ ] Kill the Edge Function 3 ticks in a row — deadman's switch trips the cron halt flag and alerts.
- [ ] Approve a pending decision → verify the Alpaca order lands in paper, fills, and the `agent_trades` row reflects the fill.
- [ ] Reject a pending decision → verify nothing is placed, status is `rejected`.
- [ ] Rebalance proposal on Monday → verify expiration at 24h if not approved.
- [ ] Rollover of a LEAPS put with DTE < 90 on paper — position-preserving, no size inflation.
- [ ] `/agent` kill button — immediate cancel-all within 5 seconds.
