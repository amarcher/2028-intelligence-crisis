# Active Roadmap v2 — Critical Pass + Paper-Aggressive Plan

> **Status:** Drafted 2026-07-02 by a Fable-5 review pass over the live system, the prod database, and outside-world data. Supersedes the *pacing* of `active-layer-plan.md` for the **paper** account only; the risk discipline in that doc still governs any future real-money path.
>
> **Companion docs:** `agent-execution-plan.md` (current architecture), `active-layer-plan.md` (six-persona plan — kept as the real-money constitution).

## Why this document exists

The owner's ask: manage the paper portfolio much more actively — consume data at least daily, take action rather than hold for months, use more leveraged structures, extract *meta*-signals from what the agent decides, verify whether the Citrini 2028 GIC thesis (in its delayed form) is actually playing out, and have a concrete plan to capitalize when early indicators confirm it. It's paper money; the goal is learning rate and maximum paper P&L if the thesis is right.

---

## Part 1 — Critical pass on the current methodology

### What's genuinely good (keep)

- **Separation of powers.** LLM proposes; code guardrails dispose (`guardrails.ts`). Whitelist enforced in three layers. This is the right skeleton for everything below.
- **Prompt-cached, structured reasoner** with ground-truth account state, real option-chain strikes, and tape anchoring. Most LLM-trading projects never get this far.
- **Honest backtest culture.** `runs/` contains a payday-effect study that *rejected its own hypothesis* (p=0.13). That harness (alpaca-trading-backtest) is the quality gate for every tactical rule proposed below.
- **Deadman switches, kill-check cron, plain-English delivery.** Operationally mature.

### Finding 1 — The premarket tick is execution-dead by construction

The premarket tick fires at **9:15 ET** (cron 13:15 UTC) and its proposals go straight to `validateTrade`, which rejects everything outside **9:30–15:55 ET**. Every premarket order in `agent_orders` is `rejected` for exactly this reason. Half of the agent's decision points cannot act, and the reasoner isn't told why — it re-proposes the same trade at the close tick, sometimes doubling up.

### Finding 2 — The system cannot measure itself

- `agent_orders.status` is written once (`submitted`) and never reconciled against Alpaca fills. There is **no fill price, no realized P&L, anywhere**.
- There is **no equity-history table**. No equity curve → no Sharpe, no drawdown, no alpha vs. control. The kill clause in `active-layer-plan.md` (≥250 bps alpha, deflated Sharpe ≥ 0.5) is **unmeasurable with current instrumentation** — the plan's own success criterion cannot be evaluated.
- No benchmark series (SPY / QQQ / IGV / hold-the-book control) is recorded.

This is the single highest-leverage fix. Everything the owner wants — performance heuristics, meta-signals, "how would the agent do" — requires a ledger.

### Finding 3 — Data starvation makes passivity structural

The slow inputs (JOLTS monthly, claims weekly, SaaS quarterly, Case-Shiller monthly) are identical across dozens of consecutive ticks. The only daily-varying inputs are 20-day momentum, VIX WoW, and tape. An agent asked twice a day "anything change?" when 90% of its inputs change monthly will correctly answer "no" — hence **zero trades from Apr 20 to Jun 17**. The passivity isn't a personality flaw of the reasoner; it's the information diet.

### Finding 4 — The active sleeve is pinned by an arbitrary symmetry rule

`addCapacityValue = aiLongValue + defensiveValue − saasPutValue` means SaaS puts may never exceed AI longs + defensives. That's a balance-sheet aesthetic, not a risk rule — and it's currently the binding constraint (room ≈ $300–$1,900 on recent ticks) while the *actual* risk budget (20% of equity) still has room. When the thesis is *most* confirmed (SaaS puts gaining value), the rule mechanically forbids pressing — it penalizes winning.

### Finding 5 — Stance flaps daily and there's no hysteresis

Score history over four days: watch(40) → probe(55) → press(80) → press(80) → probe(55). The 20d-momentum cliff edges (−5/−2 thresholds, 40-point jumps) make the headline stance oscillate on noise. The stance history isn't persisted anywhere queryable — it lives only inside digest JSON.

### Finding 6 — Exits are prose, not code

Every proposal carries an `exit_condition` sentence… which lands in Slack and is never evaluated again. Consequences visible in the book right now:

- **DDOG Jan-27 95P: −96%** ($1,080 → $40). No stop, no roll, no review ever fired.
- **CRM Jan-27 210P: +30%** and deep ITM — rule-of-thirds says trim at 2×, but nothing tracks entry multiples.
- LEAPS DTE-90 roll rule exists only as a prompt suggestion.

### Finding 7 — Execution quality is the worst available

Market orders, day TIF, on illiquid Jan-2027 LEAPS. Contract sizing uses `close_price` (stale) and equity sizing falls back to `$100` when there's no existing position. Paper fills flatter this; real spreads on these names are 5–15%. The old plan's D2 (pessimistic fills) was right — but even paper should use marketable limit orders to be honest.

### Finding 8 — The reasoner is flying with instruments taped over

- `tool_choice` forced → **thinking disabled** — the weekly "state of the thesis" runs without extended reasoning.
- No earnings calendar (the plan's archetype 2, pre-print NRR shorts, is impossible without knowing when prints land).
- No news/transcript features (`signal_features` from the plan was never built).
- No awareness of *why* its last orders were rejected — it can't learn the guardrails.

### Finding 9 — The signal layer's data is wrong in both directions

Checked against outside-world data on 2026-07-02:

- **The one "fired" trigger is likely a false positive.** `economic_data` holds only *weekly* SP500 closes; its recorded peak is 7,546 (Jun 5). The real market printed record highs ~7,600 in early June and closed June at 7,499. "No new high for 2 months" fired ~3 weeks after an all-time high — the trigger logic + weekly sampling need an audit.
- **The trigger that actually IS firing cannot fire in our system.** `saas_WDAY` and `saas_DDOG` are **empty tables**. Trigger 3 requires NOW *and* WDAY below 14% — Workday just guided FY27 subscriptions to **12–13%** (below the line!) and the dashboard can't see it. `saas_NOW` was last updated Jan 2026; `saas_CRM` contains a future-dated point (2027-01-01).
- Net: the dashboard says "1/5 fired (S&P stall)" while reality is closer to "0/5 macro + the SaaS leg firing on guidance." The agent has been reasoning from an inverted signal state for weeks.

### Finding 10 — Plan-vs-desire mismatch, resolved by splitting the constitution

`active-layer-plan.md` was written for a real-money on-ramp (90-day soak, 5% sleeve, kill clause). The owner now wants a paper-aggressive lab. These aren't in conflict — they're **two documents**: keep the old plan as the live-money constitution; this doc governs the paper account, where the cost of an error is information, not capital. The sleeve caps, soak periods, and STCG math don't bind paper; the *instrumentation* requirements (Finding 2) bind both.

---

## Part 2 — Is the thesis playing out? (as of 2026-07-02)

**Verdict: early/delayed — not broken, not confirmed. The lead domino (SaaS disruption) is genuinely falling; the downstream macro dominoes are dormant-to-contradicting. This matches the owner's modified thesis almost exactly.**

Trigger-by-trigger, real world vs. dashboard:

| # | Trigger | Real world (Jul 2026) | Status | Dashboard says |
|---|---|---|---|---|
| 1 | JOLTS < 6.0M ×2 | **7.594M — a 2-year HIGH**, rising 2 months | ❌ CONTRADICTING | pending ✓ (right) |
| 2 | Claims 4-wk > 300K | ~224K, +21K off cycle low; **continued claims 1.821M, multi-month high** | 🟡 LEANING | pending ✓ |
| 3 | NOW & WDAY < 14% | NOW cRPO guide 21%→19.5% cc; CRM guide ~10%; **WDAY guide 12–13% — already under the line**; "SaaSpocalypse" repricing: IGV ~−30% from Sep-25 peak, ~$2T software mcap lost; but DDOG +32% *accelerating* | 🔶 **FIRING (guidance basis)** | pending — **unmeasurable, WDAY data missing** |
| 4 | S&P ≥7,500 then no high 2mo | Record ~7,600 early June; 7,499 Jun 30; VIX ~16 — melt-up intact | ❌ NOT FIRING | **fired — false positive (stale weekly data)** |
| 5 | Case-Shiller YoY < 0 | +0.8% nominal, **negative in real terms 11 straight months**, Sun Belt metros negative; April ticked up | 🟡 LEANING | pending ✓ |
| 6 | HY OAS + KRE/IYR stress | HY OAS ~2.7% — historically tight; KRE stable | ❌ NOT FIRING | (not built yet) |

Supporting texture:
- **AI-attributed layoffs are the #1 stated layoff reason 4 months running** — 101,743 YTD (~23% of all cuts), share climbing 7%→25%→40% (Jan→Mar→May). Recent-grad unemployment ~5.7%, above the general rate, 42% underemployed. Aggregate layoffs are *down* 40% y/y though — displacement is a current, not yet a wave.
- Citrini's own June 2026 "State of the Themes" does **not** update the 2028 GIC scenario; their closest line: "budget constraints will pit AI spend against headcounts." The original essay's illustrative 2026 markers (NOW ACV→14%, 15% workforce cuts) have NOT been met. The thesis is publicly contested (Citadel Securities rebuttal; Jefferies coined "SaaSpocalypse" while Ives calls it a generational buy) — i.e., it is the *active market debate*, no longer a fringe view. Our short leg is no longer early; it's crowded-adjacent.

**Implications for the book:**
1. The modified thesis (SaaS repriced before macro breaks) has already partially *paid* — CRM fell far enough that our Jan-27 210P is deep ITM (+30%). The de-rating leg may be mostly done; the next leg needs earnings misses, not multiple compression.
2. The macro shorts (index puts, credit) remain correctly **un-deployed** — triggers genuinely aren't there. The system's discipline held even while its data was wrong.
3. **Next dominoes to watch**: continued claims (already at multi-month highs) and nominal Case-Shiller crossing zero. These two are the highest-value early indicators for Phase-2 rotation — exactly what the Trigger Proximity Index (Part 3) should track with distance × velocity ETAs.
4. DDOG accelerating +32% while seat-based SaaS decays validates the whitelist split — but DDOG is in our *put* book (currently −96%). It's on the wrong side of the AI divide; the exit engine should have cut it long ago, and the whitelist's SaaS-short set should distinguish seat-based (NOW/CRM/WDAY/HUBS) from consumption/AI-infra (DDOG → move to the AI-winners side).

---

## Part 3 — The meta-signal layer (what the owner asked for by name)

Turn the agent's own decisions into persisted, chartable indices. New table `meta_indices (observed_at, key, value, detail jsonb)` written every tick:

| Index | Definition | What it tells you |
|---|---|---|
| **TAI** (Thesis Acceleration Index) | The sleeve score, persisted per tick with component breakdown | Is the fast layer heating up? Slope matters more than level |
| **Trigger Proximity Index** | Per trigger: `distance-to-threshold × 3-month velocity` → ETA in months; composite = min-2 ETA | *The* early-warning number — "at current velocity, claims cross in ~5 months" |
| **Positioning Ratio** | SaaS-put Δ-adjusted notional ÷ (AI long + defensive) | What the agent is actually *doing* vs saying |
| **Leg Attribution** | Daily P&L split: SaaS-short leg / AI-long leg / defensive leg / cash | Which leg of the modified thesis is paying — the cleanest "is it working" chart |
| **Conviction Calibration** | Brier-style score of past `exit_condition` predictions vs outcomes | Is the agent's confidence worth anything? |
| **Regime Disagreement** | |fast score − slow fired-count×20| | The "delayed realization" gauge — high = market pricing thesis before macro confirms |

Dashboard gets a `/meta` panel (sparklines + current values); the weekly Slack digest leads with TAI slope and Trigger Proximity ETAs.

---

## Part 4 — Roadmap

Each milestone is shippable alone; order matters. Cost stays inside the $120/mo cap (D8) until M4, which may need +$29 Polygon.

### M0 — Make the system measurable and un-jam execution (days, not weeks)
0. **Signal data integrity (do first — the agent is reasoning from wrong inputs):**
   - Backfill `saas_WDAY`, `saas_DDOG`, fix the future-dated `saas_CRM` row, refresh `saas_NOW` (stale since Jan). Add a staleness banner per series on the dashboard and in the reasoner prompt.
   - Replace weekly FRED SP500 with daily closes (Alpaca bars are already plumbed — use SPY×10 or a daily index source) and re-audit the Trigger-4 "no new high for 2 months" logic against known June record highs. Expected outcome: fired count drops to 0/5 macro, SaaS trigger becomes measurable.
   - Reclassify DDOG from the SaaS-short set to the AI-winners set (it is a consumption/AI-infra beneficiary, +32% accelerating).
1. **Fill ledger**: per tick, reconcile open `agent_orders` against Alpaca (`GET /v2/orders`), record `filled_avg_price`, `filled_at`, status transitions. Backfill from Alpaca order history (it retains everything since April).
2. **`agent_equity_snapshots`**: every tick + daily post-close: equity, cash, per-leg market values, SPY/QQQ/IGV closes, and a computed hold-the-Apr-20-book control. Powers Sharpe/DD/alpha and every meta-index.
3. **Fix the premarket dead tick**: move premarket execution to a 9:35 ET executor pass (approved proposals from the 9:15 reasoning tick queue to it), or shift the tick to 9:35 and keep 9:15 delivery. Tell the reasoner about prior rejections in the user message.
4. **Persist stance/score history** (`meta_indices` skeleton, TAI first).

### M1 — Exit engine + risk overhaul (week 1–2)
1. **Structured exits**: proposals gain `stop_loss_pct`, `profit_ladder` (e.g. trim ⅓ at 2×, ⅓ at 4×), `max_dte_roll`. Stored per position in `agent_position_rules`; a daily cron evaluates and **executes** them. (This alone would have saved the DDOG −96% and banked the CRM +30%.)
2. **Retire the addCapacity symmetry rule.** Replace with: sleeve budget = 50% of equity (paper), position-level vol-targeted sizing, and a *convexity floor* (never fully flat SaaS puts while thesis alive).
3. **Hysteresis on stance**: enter press at ≥70, exit below 55; smooth the momentum inputs (3-day EMA). Continuous score components instead of cliff-edge 40-point jumps.
4. **Marketable limit orders** (mid + 25% of spread, cancel-and-retry once) instead of market orders.

### M2 — Daily information diet (week 2–4)
1. **Daily FRED adds**: HY OAS (BAMLH0A0HYM2), 2s10s, continued claims; **credit trigger #6** (voted D9) wired into signals + dashboard.
2. **Earnings calendar table** for the whitelist (static quarterly refresh is fine) — reasoner sees "WDAY reports in 6 days."
3. **Cheap news layer (Path B, ~$40/mo)**: Haiku triage of headlines/Reddit for the 12-name core universe → `signal_features` (layoff velocity, AI-displacement mentions, guidance-cut chatter). Weekly Sonnet pass on any new transcripts for NRR language.
4. **Midday tick (12:30 ET)** + **event ticks**: a light 30-min watcher (no LLM) that fires a full tick when VIX +8% intraday, any whitelist name ±5%, or a new macro print lands. More decision points only when information actually arrives.

### M3 — Aggressive paper archetypes (week 4–8)
All paper-only; each must pass a backtest in `runs/` or a 2-week shadow before enabling:
1. **Earnings-window trades**: 2–4 month puts (or put spreads) opened 5–10 days before SaaS prints when TAI ≥ probe + negative news velocity; hard exit T+2 after print.
2. **Spread support in the executor** (multi-leg orders) — put spreads make leverage honest: defined risk, ~3–5× payoff.
3. **Tactical inverse windows**: SQQQ/SPXS allowed *in paper* only with code-enforced 5-trading-day max hold and 2%-of-equity cap (the forbidden list in the old plan still governs live).
4. **Momentum add/trim**: add to SaaS puts on RS breakdowns (IGV/QQQ ratio new 60-day low), trim on 2σ mean-reversion bounces. Rules from backtests, executed by code, sized by the reasoner.
5. **Delta-adjusted exposure reporting** so "leverage" is a measured number in every digest, not a vibe.

### M4 — Phase-2 capitalization playbook (week 6–10, parallel)
The answer to "how do we capitalize when it starts":
1. **Pre-write the rotation as data, not improvisation** (`playbooks` table): at 2/5 fired → close AI longs, roll ⅓ of LEAPS to 3–6-month tenor, open first SPY/QQQ put spreads; at 3/5 → credit shorts (HYG/KRE puts), size defensive up; kill-switch → unwind sleeve first. Each step has pre-declared sizes and instruments.
2. **Drill it**: inject synthetic snapshots (2/5, 3/5, kill) into a staging tick — verify the agent + executor walk the playbook end-to-end in paper. The verification-checklist pattern in `agent-execution-plan.md` already anticipated this.
3. **Profit ladders into panic**: pre-registered VIX-tiered take-profit (e.g. VIX>40 → bank ⅓ of index puts) — crisis alpha dies by round trip; the ladder is decided now, calm.
4. Optional +$29/mo Polygon options flow once M2 signals prove insufficient (D5 said buy at M2; defer until earned).

### M5 — Meta-signal product (week 8–12)
Full Part-3 table live: `/meta` dashboard panel, calibration scoring, leg attribution, Regime Disagreement chart. Weekly Slack "thesis report card": per-trigger distance + velocity + ETA, TAI slope, leg P&L, and one plain-English paragraph: *"the prediction is early/on-track/wrong because…"*.

---

## Part 5 — Slack alerting taxonomy

Today: two digests/day + fills + kill alerts. Upgrade to intent-based routing (same webhook, different prefixes; split channels later if noisy):

- 🟢 **FYI (existing digests)** — twice daily, now led by TAI + equity vs benchmark line.
- 🟡 **Stance change** — only on hysteresis-confirmed transitions (watch↔probe↔press), with component breakdown.
- 🟠 **Trigger proximity** — a trigger crosses 80% of threshold, or ETA < 3 months at current velocity ("claims 4-wk avg 268K — 89% of the 300K line, rising 5 straight weeks").
- 🔴 **Action** — fills (exists), exit-engine executions, playbook steps, oversize approvals.
- ⚫ **System** — deadman, cost cap at 80%, stale-feed warnings.

## Cost check

Current: 2 Opus ticks/day ≈ $25–40/mo. After M2 (+midday/event ticks, Haiku news layer): ≈ $75–100/mo. Within the $120 cap; Polygon deferred to M4-optional. If cost pressure appears, the premarket tick drops to Sonnet — the close tick is where execution lives.

## What this explicitly does NOT change

- Real-money path still requires the old plan's soak + kill clause, unchanged.
- Whitelist stays shared and frozen (D7); additions go through digest proposals.
- Short-vol remains forbidden everywhere, including paper.
- The slow book remains the bet. The paper-aggressive sleeve is a *laboratory* around it — now with instruments calibrated well enough that the experiment can actually be read.
