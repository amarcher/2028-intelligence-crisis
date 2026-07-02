# Active-Layer Plan — Evolving the Slow Macro Agent

> **Status:** Drafted but not committed. This document is the output of a six-persona panel ideation. No code has been written against it yet. Re-read before resuming.
>
> **Companion doc:** `agent-execution-plan.md` — the *current* signal-only architecture. This plan extends, does not replace, that one.

## Purpose

The current Edge Function agent runs 3×/day on FRED prints, emits digests, and proposes LEAPS-shaped trades from a ~50-name whitelist. It works. But it's starved on monthly data while the thesis prices in real time. The question this plan answers: **how do we add a more active trading layer without diluting the slow thesis or encumbering the user's machine for negligible benefit?**

## Where we are today

- Signal-only Claude agent on Supabase Edge Functions (Sonnet 4.6 daily, Opus 4.7 weekly).
- Five Phase-Flip triggers on FRED data (JOLTS, ICSA, S&P stall, SaaS revenue, CSUSHPISA).
- Alpaca paper integration exists in `supabase/functions/agent-tick/` (alpaca.ts, execute.ts, guardrails.ts) — gated behind shadow → paper → small_live → scale phases.
- Ollama installed on M5 Max / 128 GB but currently only used as a chat REPL (`/Users/archer/Programs/local-model/`).

## Panel decisions (voted)

| # | Decision | Vote |
|---|---|---|
| D1 | Single book + sleeve vs. two books | **One book, sleeve capped 20% → 30% post-validation.** Risk's sub-ledger sizing kept inside it. |
| D2 | 30-day vs. 90-day soak with real-spread fills | **90 days, pessimistic fills** (worse of mid+½spread or last-trade), real option-chain snapshots at proposal time. |
| D3 | Pre-registered success criterion | **Adopted**: ≥ 250 bps annualized net-of-tax/spread alpha vs. control + deflated Sharpe ≥ 0.5. |
| D4 | Add IBKR as second broker now? | **Defer to Milestone 4** — only when sleeve actually needs spreads/futures. |
| D5 | Polygon options flow ($29/mo)? | **Buy from Milestone 2.** Cheapest signal-per-dollar. |
| D6 | Local-LLM Pattern (b) — Mac as feature factory | **DEFERRED — see "Pending decision" below.** |
| D7 | Whitelist boundary | **Identical between slow & active.** No active-only universe. |
| D8 | Cost-of-thinking cap | **$120/mo hard cap** ($80 Anthropic + $30 Polygon + $10 misc). |
| D9 | New 6th trigger: HY OAS + KRE/IYR credit stress | **Promote to phase-flip status**, with a higher bar (both fire for 5 consecutive sessions). |

## Persona positions in one line each

- **Signals Architect**: Add 5 cheap thesis-targeted feeds (RS deltas, options flow, news velocity, credit stress, transcript sentiment) and a Thesis Acceleration Index that gates fast signals on slow ones.
- **Brokerage Engineer**: Stay on Alpaca for the equity + single-leg core; IBKR only when archetypes demand multi-leg or futures.
- **Local-LLM Architect**: Tier work — `gemma3:4b` always-on triage, `gemma3:27b` idle-only extraction, `llama3.3:70b` overnight only. Mac writes features to Supabase queue; never in the trading hot path.
- **Risk Manager**: 80/15/5 split (slow/active/reserve). Vol-targeted sizing on sub-book, not Kelly. Per-trade 25 bps loss budget. Layered drawdown gates. Cluster cap of 35% across slow+active. Convexity preservation rule.
- **Skeptic**: Base rate is overwhelmingly negative for retail-active and LLM-driven systems. Demand 90-day soak with pessimistic fills, parallel control P&L, pre-registered success criterion. The active book emotionally closes the slow book — that's the dominant failure mode.
- **Macro Steward**: Active layer must amplify the thesis, not dilute it. Add-only/rotate-only on existing slow positions. Whitelist shared. Kill-switch unwinds active sleeve first and fully. Forbidden: short vol, mega-cap AI longs, leveraged ETFs, DTE < 30 for shorts.

Full persona memos are not included here — they live in the conversation transcript that produced this plan. Decisions table above captures what survived the vote.

---

## Pending decision: how to source unstructured-text features

The original synthesis baked local-LLM (Pattern (b) — Mac as feature factory) into Milestone 1. **You pulled back on that, reasonably, on the grounds that the machine encumbrance isn't worth a marginal benefit.** Below are both paths costed out so you can choose when you return to this plan.

### Path A — Local LLM on M5 Max

| Concern | Reality |
|---|---|
| Always-on `gemma3:4b` (3 GB, Reddit/news triage) | Negligible impact, fans quiet. Probably invisible. |
| Idle-only `gemma3:27b` (17 GB, 8-K + NRR extraction) | Notable GPU contention while running; mitigated with `taskpolicy -b` + HID-idle gate. Browser/Figma/games will fight for GPU. |
| Overnight `llama3.3:70b` (43 GB, transcripts) | Loud fans, ~3% battery/min. AC-only, 1am–6am. |
| Failure mode | Mac sleeps → queue backs up → Claude reads staleness flag → degrades to FRED-only. Not a fault, but feature freshness suffers. |
| Marginal cost | $0/mo (sunk hardware). |
| Marginal benefit | Volume. ~20k items/hr on 4b, ~5k/hr on 27b. Enables tracking 5,000+ Reddit posts/day, ~50 transcripts/night, hourly job-posting diffs. |

### Path B — Cloud-only (Claude Haiku 4.5 + Sonnet 4.6)

| Job | Engine | Volume | Est. monthly cost |
|---|---|---|---|
| Reddit/social sentiment | Haiku 4.5 | ~5k posts/day × 200 tok | ~$10–15 |
| News headline triage | Haiku 4.5 | ~2k headlines/day × 100 tok | ~$5 |
| 8-K clause extraction | Haiku 4.5 | ~200 filings/day, gated by SIC | ~$10 |
| NRR / guidance scanner | Sonnet 4.6 | ~50 transcripts/quarter | ~$10 |
| Archetype RAG | OpenAI `text-embedding-3-small` (cheapest credible) or Voyage | one-time corpus + new transcripts | ~$3 |
| **Total** | | | **~$40/mo** |

This fits inside the $120 cap (D8) with room. No machine encumbrance, no launchd worker, no caffeinate dance, no thermal-pressure check — and feature freshness is whatever the cron schedule says, not "whenever the user walked away from the laptop for 2 minutes."

### Recommendation when you return

**Start with Path B.** The volume advantage of local is real but not load-bearing for the active layer's archetypes. The thesis-amplifier sleeve (Macro Steward's design) needs *quality* signal — clean NRR extraction, clean layoff classification on a tight whitelist of 50 names — not Reddit firehose volume. ~$40/mo is well under the cap. If after Milestone 3 the bottleneck is feature volume rather than feature *quality*, re-open Path A then.

The local-model project (`/Users/archer/Programs/local-model/`) stays as your Ollama playground for non-trading uses. No code from this plan ships to it unless Path A is chosen.

---

## Sequenced roadmap

Milestones are ~weeks of focused work each. Local-LLM Pattern (b) is removed from Milestone 1; the equivalent work is the cloud-side feature pipeline (Path B above) unless the deferred decision flips.

### Milestone 1 — Foundation hardening (weeks 1-3)

Ships:
- 6th credit trigger (HY OAS + KRE/IYR) wired into `agent-tick` and `PhaseFlipSignals.tsx`
- Intraday RS / VIX-term / HYG / KRE signals into `economic_data`
- `signal_features` table for unstructured-text-derived features (Path B writes here from a new Edge Function; Path A would write here from the Mac)
- Cost-cap monitoring + alerting on Anthropic + data-vendor spend

Gate to advance: All signals writing for 14 days clean; staleness flag works; cost dashboard live.

Backed by: Signals, Risk, Skeptic.

### Milestone 2 — Pessimistic shadow harness (weeks 3-7)

Ships:
- Real-chain fill simulator: every proposal gets a snapshotted Polygon option chain at emit time, fills simulated at *worse of mid + ½spread or last-trade*
- Parallel "hold the slow book" control P&L tracker
- Polygon $29/mo subscription live
- TAI composite (40% slow / 30% tape / 20% options / 10% news) gating tactical signals on slow-macro ≥ 50

Gate to advance: 30 days clean shadow data; control P&L reconciles to slow book within 10 bps.

Backed by: Skeptic, Signals, Risk.

### Milestone 3 — 90-day pre-registered soak (weeks 7-20)

Ships: nothing new. *Runs* the soak with success criterion frozen in a signed file in the repo before day 1.

Gate to advance (the kill clause — see below):
- Net-of-tax (40% blended STCG), net-of-spread alpha vs. control ≥ 250 bps annualized
- Deflated Sharpe ≥ 0.5 (Bailey/Lopez de Prado, accounting for variants tried during dev — log every variant)
- At least one Phase-Flip trigger fires in-window (else extend to 120 days)

Backed by: Skeptic, Risk, Macro Steward.

### Milestone 4 — Paper sleeve at 5%, archetypes 1-3 (weeks 20-28)

Ships:
- Real Alpaca paper execution scoped to Macro Steward's archetypes 1 (layoff-vel adds), 2 (NRR pre-print shorts), 3 (counter-rally trims/redeploys)
- IBKR adapter ships *here* if archetype 2 needs spreads
- Risk's per-trade 25 bps + drawdown gates enforced in *middleware*, not prompt
- Cluster-cap and convexity-preservation rules enforced

Gate to advance: 60 days; Sharpe ≥ 1.0 after-tax; beta-to-slow ≤ 0.3; max DD ≤ 6% of sleeve.

Backed by: Risk, Brokerage, Macro Steward.

### Milestone 5 — Small live at 10% sleeve (weeks 28-40)

Ships:
- Real money behind the same code path
- Kill-switch unwinds sleeve *before* slow book on phase flip — hard-coded, not policy
- Signed contamination rule in repo: sleeve drawdown cannot trigger any change to slow book within 30 days

Gate to advance: Two consecutive 90-day windows clearing all four Risk viability metrics.

Backed by: Risk, Macro Steward, Brokerage.

### Milestone 6 — 20% sleeve, archetypes 4-5 (weeks 40-60)

Ships:
- Contagion rotation (archetype 4) and vol-expansion harvest (archetype 5) — only after Trigger 2 has fired in production
- IBKR primary for spreads/futures on archetype 5

Gate to advance: each new archetype produces ≥ 10 trades passing the same metrics.

### Milestone 7 — Conditional 30% scale (post-week 60)

Only if 3+ triggers have fired and slow book is in contagion phase. Otherwise hold at 20%.

Gate: discretionary owner review + panel re-vote.

---

## Kill clause (Skeptic's contribution, accepted)

Before Milestone 3 day 1, sign into the repo: 90 trading days of shadow execution against real-chain pessimistic fills must produce **≥ 250 bps annualized net-of-tax (assume 40% blended STCG), net-of-spread alpha vs. a passive hold-the-slow-book control**, with **deflated Sharpe ≥ 0.5**. At least one Phase-Flip trigger must fire in-window or the soak extends to 120 days. Quiet-tape-only results do not count.

Miss the bar → active layer is killed, slow book is untouched, panel reconvenes only on a materially new architecture, not a tweaked threshold.

## Forbidden archetypes (Macro Steward, non-negotiable)

- Short volatility in any phase
- Buying mega-cap AI longs (NVDA / AVGO / MSFT) at late stage
- Leveraged ETFs (SPXL / TQQQ / SQQQ)
- Crypto, futures (until Milestone 6 archetype 5), forex, naked shorts, margin
- DTE < 30 days for single-name short thesis exposure

## Open questions only the user can answer

These block precise sizing, not the architecture. Answer when ready:

1. **Total deployable capital, and what % is in the slow book today?** The 5/10/20/30% sleeve gates need a denominator. A $40k account can't absorb option-spread cost a $400k account can.
2. **Blended STCG marginal tax rate (federal + state)?** The after-tax Sharpe gate and win-rate hurdle math both depend on this; 32% vs. 50% changes which archetypes are viable.
3. **Weekly attention budget through 2027, in hours?** Milestone 5+ assumes you can do an owner review on weekly drawdown breaches. Below ~3 hrs/week, sleeve cap stays at 10% indefinitely regardless of metrics.

## What's still genuinely deferred

- **Path A vs. Path B for unstructured-text features.** Default is Path B (cloud-only, ~$40/mo, no machine encumbrance). Re-open if Milestone 3 reveals a feature-volume bottleneck rather than a feature-quality one.
- **IBKR adoption.** Built into Milestone 4 only if archetype 2 demands it.
- **Crypto / FX / futures.** All deferred indefinitely; futures only via archetype 5 in Milestone 6.

## When you return to this plan

Read top-to-bottom; the structure is the order of operations. The vote tally captures what was decided once and shouldn't be relitigated without a panel re-vote. The "Pending decision" section is the only place where genuine optionality remains; everything else has a vote behind it.

If you re-open the local-LLM question, the cost/benefit table in Path A vs. Path B is the comparison that matters. If volume is the bottleneck, local wins. If quality is the bottleneck, paying Anthropic is cheaper than encumbering the machine.

The slow book is still the bet. The active layer is a sleeve, not a strategy.
