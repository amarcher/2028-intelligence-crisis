// Anthropic reasoner for agent-tick.
// Uses raw fetch against /v1/messages rather than the SDK — Deno + esm.sh
// compatibility for the TS SDK is fiddly, and the API shape is stable enough
// to hand-roll. Prompt is aggressively cached on the static playbook + rubric
// + tool definition; only the user message varies per tick, so
// cache_read_input_tokens should hit on every invocation after the first.
// Invalidators to avoid: never put timestamps, tick numbers, or session IDs
// in the system prompt or tool schema.

import type { SignalsResult, Signal } from '../../../src/lib/signals.ts';
import { WHITELIST, annotateProposals } from './filter.ts';

export type TickType = 'premarket' | 'close' | 'weekly';

export interface WowSummary {
  last: number | null;
  wow_delta: number | null;
  wow_pct: number | null;
}

export interface DriftSummary {
  jolts: WowSummary;
  claims: WowSummary;
  sp500: WowSummary;
  caseShiller: WowSummary;
  /** VIX regime context for the S&P peak-stall reasoning.
   *  Low + stable VIX = complacency (counterfactual for the thesis).
   *  VIX spiking = risk-off regime shift (thesis-aligned). */
  vix?: WowSummary;
}

export interface RecentDigest {
  created_at: string;
  tick_type: string;
  phase: string;
  fired_count: number;
  narrative: string;
  kill_switch_triggered: boolean;
}

export interface PositionSummary {
  ticker: string;
  instrument: 'equity' | 'option';
  option_symbol?: string;
  qty: number;
  avg_entry: number;
  market_value: number;
  unrealized_pl: number;
}

export interface AccountSummary {
  equity: number;
  cash: number;
  buying_power: number;
}

export interface ShippingReading {
  /** Human label for the prompt line, e.g. 'FBX global composite'. */
  label: string;
  value: number;
  unit: string;
  wow_pct: number | null;
  observed_at: string;
  /** When the underlying source hasn't been pulled successfully in 14+ days,
   *  the reading is passed through but flagged. The reasoner should ignore
   *  stale readings rather than reason off old numbers. */
  stale: boolean;
}

export interface ShippingPulseSummary {
  readings: ShippingReading[];
  /** Pull-level freshness. If the whole Shipping Pulse pipeline is dead
   *  (no signals at all, or >50% stale), skip the section in reasoning. */
  healthy: boolean;
}

export interface ReasonerInput {
  tickType: TickType;
  signals: SignalsResult;
  drift: DriftSummary;
  recentDigests: RecentDigest[];
  /** Live account state. Present when mode=auto_execute + phase != shadow +
   *  Alpaca creds available. Absent in signal-only / shadow. */
  account?: AccountSummary;
  /** Current Alpaca positions. Present when account is. Empty array means
   *  the account has cash but no positions — different from undefined. */
  positions?: PositionSummary[];
  /** Weekly container freight + dry bulk + macro import readings. Optional so
   *  ticks before Phase 1 Shipping Pulse deploy, or when the pipeline is
   *  down, degrade cleanly to the prior drift-only prompt. */
  shippingPulse?: ShippingPulseSummary;
}

export type ProposalAction =
  | 'open'
  | 'add'
  | 'trim'
  | 'close'
  | 'roll'
  | 'hold'
  | 'unwind_all';

export type ProposalInstrument =
  | 'equity'
  | 'put'
  | 'call'
  | 'put_spread'
  | 'call_spread';

export type ProposalSizeHint =
  | 'starter'
  | 'half'
  | 'full'
  | 'trim_third'
  | 'trim_half';

export type ProposalUrgency =
  | 'act_today'
  | 'this_week'
  | 'waiting_for_trigger';

export interface Proposal {
  action: ProposalAction;
  ticker: string;
  instrument: ProposalInstrument;
  expiry: string | null;
  strike: number | null;
  size_hint: ProposalSizeHint;
  rationale: string;
  urgency: ProposalUrgency;
  /** Populated by the soft-guardrail filter when a proposal violates the
   *  playbook rules (off-whitelist, near-dated single-name short, etc.).
   *  Omitted on clean proposals to keep the JSON compact. */
  filter_flags?: string[];
}

export interface ReasonerOutput {
  kill_switch_triggered: boolean;
  narrative: string;
  drift_notes: string | null;
  proposals: Proposal[];
  scorecard: Record<string, 'fired' | 'pending' | 'reversed'> | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  model: string;
  status: 'ok' | 'retried_ok';
}

const MODEL = 'claude-opus-4-7';

// WHITELIST is imported from filter.ts — single source of truth for both
// the system prompt and the post-extraction guardrail filter.

// ---------- static prompt (cached) ----------
// This string is frozen. Never interpolate timestamps, tick IDs, or anything
// that varies per invocation here — that would break the prompt cache.
const SYSTEM_PROMPT = `You are the reasoning agent behind the 2028 Intelligence Crisis dashboard. The dashboard tracks a macro thesis (Citrini Research "2028 GIC") published in February 2026: a causal chain from AI capability acceleration through SaaS revenue decay, white-collar layoffs, consumer spending collapse, and financial contagion — S&P 500 peaks near 8,000 in late 2026 then crashes ~56% to ~3,500 by mid-2027. The user believes the thesis is directionally correct but the timetable is delayed 6–18 months. Your job is to read the current signal state and produce a structured trading digest for a human to review and execute manually in their own brokerage account.

You do not trade. You do not have account access. You do not see positions or P&L. You write proposals; a human decides whether to act on them.

## The five Phase-Flip signals

These are the dashboard's primary triggers. At least two must fire to move from Phase 1 to Phase 2:

1. **JOLTS breakdown** — JOLTS job openings below 6.0M for two prints in a row. Leading indicator for white-collar layoffs.
2. **Claims spike** — Initial unemployment claims, 4-week rolling average above 300K. First hard evidence of the layoff wave.
3. **SaaS guide-down** — ServiceNow AND Workday ACV growth both below 14%. Systems-of-record slipping confirms build-vs-buy shift.
4. **S&P peak stall** — S&P 500 has reached ≥ 7,500 and has failed to make a new high for at least two monthly prints. The bubble is topping.
5. **Housing roll** — Case-Shiller national YoY turns negative. Tech-hub housing contagion feeds bank and CRE tail.

## Phase policy

**Phase 1 · Counterfactual Grind** (0–1 signals fired):
Hold the setup. Keep cheap long-dated SaaS LEAPS puts on NOW/CRM/HUBS/WDAY/DDOG, Jan 2027 and Jan 2028 expiries, 20–30% OTM. Carry TLT + GLD + XLP as counterfactual hedges. Small QQQ/SMH longs for the AI-bubble leg. Do not deploy the short book yet. Position hygiene: roll any LEAPS with DTE < 90 to the next January expiry (size-preserving). Rule of thirds on profitable puts — sell 1/3 at 2× entry, 1/3 at 4×, let 1/3 ride to thesis completion.

**Phase 2 · Inflection** (2+ signals fired):
Flip the book. Close AI-euphoria longs (QQQ, SMH, NVDA, AVGO, hyperscalers). Roll SaaS LEAPS to 3–6 month near-dated puts to harvest gamma. Add SPY/QQQ put spreads (3–6 month, 10–20% OTM). Layer credit shorts: HYG puts, KRE puts, IYR/VNQ/BXP/SLG for commercial real estate exposure. Maintain 15–20% dry powder for bear rallies. The first 2-signal crossing is not a signal to sell everything — it's a signal to START rotating.

## Anti-thesis kill switches

If ≥ 2 of these are active, trigger the kill switch: emit EXACTLY ONE \`unwind_all\` proposal and stop — no other proposals. The user will manually close positions.

- JOLTS re-accelerating above 8M for 2 consecutive quarters (look for wow_pct > +5 across two prints sustaining above 8000).
- ServiceNow AND Workday ACV growth accelerating 2 quarters in a row (infer from the signals reading field; if NOW > 18 and WDAY > 15 and both rising vs prior reading, flag).
- Unemployment < 3.8% in 2027 or later (the dashboard doesn't surface UNRATE directly to this reasoner yet — conservative default: do not fire this trigger unless explicitly present in context).
- M2 velocity climbing past 1.45 AND savings rate stays < 5% (same caveat — not in current context, default to not firing).
- S&P 500 sustains above 8,500 (per signals reading: peak > 8500 AND latest close > 8500 for multiple prints).

Be conservative. The kill-switch path is expensive (you give up the entire asymmetric position); only trigger when the evidence is clear in the current tick's signal state, not speculative.

## Ticker whitelist

You may only propose on these tickers. If your reasoning wants something not in this list, include it in \`narrative\` as "suggested whitelist addition" instead of emitting a proposal:

${WHITELIST.join(', ')}

## Disallowed recommendations

Never propose:
- Naked short equity or naked short options
- Leveraged inverse ETFs (SPXS, SQQQ, SRTY) unless the rationale explicitly names them as a 3–5 day tactical bet post-inflection
- Crypto, futures, forex
- Margin use
- Any options with DTE < 30 days for a single-name short thesis (force LEAPS or 3–6 month minimum for the asymmetric book)

If your reasoning pulls toward any of these, re-route: a defined-risk put spread does most of the work of a naked short with bounded loss.

## Drift interpretation

Each tick receives week-over-week deltas for JOLTS, claims, S&P 500, and Case-Shiller. Classify the drift:
- **Thesis-aligned** — JOLTS falling, claims rising, S&P falling, Case-Shiller decelerating or falling. Narrative: hold, thesis working. Small adds to existing asymmetric positions are OK; don't initiate new ones on thesis-aligned prints alone.
- **Counterfactual** — JOLTS rising, claims falling, S&P ripping higher on broadening breadth, Case-Shiller accelerating. Narrative: trim asymmetric exposure up to 10% of current notional; add small to defensive carry (TLT, GLD, XLP).
- **Mixed / noisy** — one print goes each way. Narrative: hold; note the mixed signal in drift_notes.

## Shipping pulse — corroborator only

When present, the user message includes a "Shipping pulse" block: weekly container freight (Freightos FBX global + key lanes), a dry-bulk ETF proxy (BDRY ≈ Baltic Dry Index), and two FRED macro series (retail inventory/sales ratio, real imports index). These are the physical-economy tell on the thesis — they DO NOT fire Phase-Flip signals and they MUST NOT initiate proposals on their own.

How to use them:
- **Thesis-aligned read:** FBX global falling + BDRY falling + retail I/S ratio rising (> 1.30 and climbing) = physical slowdown with overstock. Sharpen language in drift_notes ("rates rolling over and shelves filling — thesis corroborated by the physical economy"). Do not rotate positions faster than drift alone would justify.
- **Counterfactual read:** FBX ripping + BDRY rising + real imports index climbing + I/S ratio flat = physical expansion. Lean harder on "hold" and defensive carry; if drift is also counterfactual, note the double confirmation but keep trims under 10% of notional.
- **Mixed read:** lanes diverging (e.g. transpacific up, Asia→Europe down) typically reflects routing noise around Red Sea / canal disruptions — not demand. Say so in drift_notes and move on.
- **Stale readings** (marked \`(stale)\`) should be ignored entirely — scraper was down, don't speculate from old numbers.

Cite shipping evidence in at most one sentence of drift_notes or narrative. Never emit a proposal whose rationale starts with shipping — shipping corroborates drift, it doesn't drive trades. Exception: if 3+ shipping readings all say "counterfactual" for multiple weeks in a row while Phase-Flip signals still show 0 fired, that's a valid reason to trim existing asymmetric exposure further.

## Memory + ground truth

You receive the last 3 digests (or 8 on weekly ticks) plus — when the agent is running in auto_execute mode — the LIVE account state (equity, cash, current positions). **Always prefer ground truth over memory.** Your prior digests may describe a LEAPS book that doesn't exist yet. Check the "Current positions" section of the user message before saying "hold".

**Empty-book case.** If the user message says \`Current positions: (none — cash-only account)\`, the Phase 1 book does NOT exist yet and must be OPENED, not held. Emit starter \`open\` proposals for the Phase 1 starter book:

- SaaS LEAPS puts (Jan 2027, 20–30% OTM) on 3–5 of: NOW, CRM, HUBS, WDAY, DDOG — starter size each
- Defensive equity: TLT, GLD, XLP — starter size each
- Small AI-bubble equity: QQQ or NVDA — starter size

Spread these across multiple ticks if the daily-gross cap is tight — 3–4 opens per tick is fine; don't try to build the whole book in one session.

**Book-exists case.** Positions broadly match the playbook's Phase 1 book. Now you can "hold" intelligently. Examples where "hold" is correct:
- Position value is within ~25% of target sizing (starter ~= 1% of equity) → no action
- Counterfactual drift week but positions already sized → "hold, defensive carry intact"
- Thesis-aligned drift but no triggers fired → "hold, LEAPS book working"

**Mismatch case.** Positions exist but don't match the playbook — e.g., you see a position in a name not on the whitelist, or sizing is way off. Call this out in \`narrative\` and emit \`trim\` or \`close\` proposals to reconcile.

Use prior digests to:
- Avoid repeating yourself. If you flagged a trim on NOW yesterday and nothing has changed, say "no change — prior trim stands" rather than re-proposing the same trim.
- Note drift versus your prior read: "yesterday I called the tape thesis-aligned; today JOLTS reversed up, softer read."

## Output rubric

1. First, check for kill-switch conditions using the Phase-Flip signals data you receive. If ≥ 2 anti-thesis signals fire, emit ONE \`unwind_all\` proposal (ticker: 'SPY' as sentinel, instrument: 'equity', rationale: which 2+ anti-thesis signals fired) and stop — no other proposals, narrative explains the kill-switch.
2. Determine phase from \`fired_count\` (0–1 = Phase 1; 2+ = Phase 2; note if it flipped since the last digest).
3. Classify drift.
4. Emit at most 6 proposals. Each must include action, ticker (whitelist only), instrument, size_hint, rationale grounded in specific signal state or drift, and urgency. No timestamps, no prices — this is a human-readable digest, not a trade ticket.
5. \`narrative\`: 2–3 sentences, action-first. Say where we are ("Phase 1 · signal count unchanged"), then what matters ("JOLTS inched lower; keep the LEAPS book; no action").
6. \`drift_notes\`: one sentence on the week-over-week read, or null if nothing noteworthy.
7. If tick_type is 'weekly', emit a scorecard: for each of jolts, claims, saas, sp500, housing — mark 'fired', 'pending', or 'reversed' (fired previously but no longer).

## Tone

Direct, concrete, no hedging. Not: "you might want to consider trimming." Yes: "Trim NOW LEAPS to 12% of book — signal drift counterfactual for a second week."

Call the submit_digest tool exactly once with your full structured output. Do not emit any text outside the tool call.`;

// ---------- static tool definition (cached as part of prefix) ----------
// Frozen shape. Never mutate per-tick.
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const TOOL: AnthropicTool = {
  name: 'submit_digest',
  description:
    'Submit the digest for the current tick. Call exactly once with the full structured output.',
  input_schema: {
    type: 'object',
    properties: {
      kill_switch_triggered: {
        type: 'boolean',
        description:
          'True iff ≥ 2 anti-thesis signals are firing. When true, proposals must be exactly one unwind_all.',
      },
      narrative: {
        type: 'string',
        description:
          '2–3 sentences. Action-first summary of the current state and what (if anything) to do.',
      },
      drift_notes: {
        type: ['string', 'null'],
        description: 'Optional one-liner on week-over-week drift. Null if no noteworthy drift.',
      },
      proposals: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['open', 'add', 'trim', 'close', 'roll', 'hold', 'unwind_all'],
            },
            ticker: { type: 'string', description: 'Must be on the whitelist.' },
            instrument: {
              type: 'string',
              enum: ['equity', 'put', 'call', 'put_spread', 'call_spread'],
            },
            expiry: {
              type: ['string', 'null'],
              description: "e.g., 'Jan 2027'. Null for equities or indeterminate.",
            },
            strike: { type: ['number', 'null'] },
            size_hint: {
              type: 'string',
              enum: ['starter', 'half', 'full', 'trim_third', 'trim_half'],
            },
            rationale: {
              type: 'string',
              description:
                'Concrete justification tied to a specific signal or drift pattern. No more than ~2 sentences.',
            },
            urgency: {
              type: 'string',
              enum: ['act_today', 'this_week', 'waiting_for_trigger'],
            },
          },
          required: ['action', 'ticker', 'instrument', 'size_hint', 'rationale', 'urgency'],
          additionalProperties: false,
        },
      },
      scorecard: {
        type: ['object', 'null'],
        description:
          'Weekly tick only. Map of signal_key (jolts|claims|saas|sp500|housing) to fired|pending|reversed.',
        additionalProperties: { type: 'string', enum: ['fired', 'pending', 'reversed'] },
      },
    },
    required: ['kill_switch_triggered', 'narrative', 'proposals'],
    additionalProperties: false,
  },
};

// ---------- dynamic user message builder ----------
function renderSignal(s: Signal): string {
  const state = s.state === 'fired' ? '🔴 FIRED' : '○ pending';
  return `- ${s.label} [${state}] — reading: ${s.reading} · trigger: ${s.threshold}`;
}

function renderWow(label: string, wow: WowSummary): string {
  if (wow.last == null) return `  ${label}: no data`;
  const delta =
    wow.wow_pct != null
      ? `${wow.wow_pct >= 0 ? '+' : ''}${wow.wow_pct.toFixed(2)}% WoW`
      : 'no prior print';
  return `  ${label}: ${wow.last} (${delta})`;
}

function renderRecentDigests(recent: RecentDigest[]): string {
  if (recent.length === 0) return '(no prior digests — this is the first tick)';
  return recent
    .map(
      (d, i) =>
        `  [${i + 1}] ${d.created_at.slice(0, 10)} · ${d.tick_type} · ${d.phase} · ${d.fired_count}/5${d.kill_switch_triggered ? ' · KILL-SWITCH' : ''}\n      "${d.narrative.slice(0, 240)}"`,
    )
    .join('\n');
}

function renderAccount(a: AccountSummary | undefined): string {
  if (!a) return '(running in signal-only mode — no brokerage account state)';
  return `equity $${a.equity.toFixed(0)} · cash $${a.cash.toFixed(0)} · buying power $${a.buying_power.toFixed(0)}`;
}

function renderPositions(positions: PositionSummary[] | undefined): string {
  if (positions === undefined) return '(not provided — signal-only mode)';
  if (positions.length === 0) return '(none — cash-only account)';
  return positions
    .map((p) => {
      const label = p.instrument === 'option' ? (p.option_symbol ?? p.ticker) : p.ticker;
      const sign = p.unrealized_pl >= 0 ? '+' : '';
      return `  - ${label} ${p.qty} @ $${p.avg_entry.toFixed(2)} · mv $${p.market_value.toFixed(0)} · pnl ${sign}$${p.unrealized_pl.toFixed(0)}`;
    })
    .join('\n');
}

function renderShippingPulse(sp: ShippingPulseSummary | undefined): string {
  if (!sp || !sp.healthy || sp.readings.length === 0) {
    return '(no shipping pulse data — scraper down or not yet deployed; ignore this channel)';
  }
  return sp.readings
    .map((r) => {
      const wow =
        r.wow_pct == null
          ? 'no prior print'
          : `${r.wow_pct >= 0 ? '+' : ''}${r.wow_pct.toFixed(2)}% WoW`;
      const staleTag = r.stale ? ' (stale)' : '';
      const formatted = formatShippingValue(r.value, r.unit);
      return `  ${r.label}: ${formatted} (${wow}) · obs ${r.observed_at.slice(0, 10)}${staleTag}`;
    })
    .join('\n');
}

function formatShippingValue(v: number, unit: string): string {
  switch (unit) {
    case 'usd_per_40ft':
      return `$${Math.round(v).toLocaleString()}/40ft`;
    case 'usd_per_share':
      return `$${v.toFixed(2)}`;
    case 'index':
      return v.toFixed(1);
    case 'ratio':
      return v.toFixed(2);
    case 'usd_bn':
      return `$${v.toFixed(0)}B`;
    default:
      return v.toString();
  }
}

export function buildUserMessage(input: ReasonerInput): string {
  const { tickType, signals, drift, recentDigests, account, positions, shippingPulse } = input;
  return `tick_type: ${tickType}

Account: ${renderAccount(account)}
Current positions:
${renderPositions(positions)}

Current signal state (${signals.firedCount}/5 firing · phase: ${signals.phase}):
${signals.signals.map(renderSignal).join('\n')}

Week-over-week drift (last print · change):
${renderWow('JOLTS', drift.jolts)}
${renderWow('Initial claims', drift.claims)}
${renderWow('S&P 500', drift.sp500)}
${renderWow('Case-Shiller national', drift.caseShiller)}${drift.vix ? `\n${renderWow('VIX', drift.vix)}` : ''}

Shipping pulse (corroborator — never initiates a proposal):
${renderShippingPulse(shippingPulse)}

Recent digests (most-recent first):
${renderRecentDigests(recentDigests)}

Now evaluate the kill-switch, classify drift, **check current positions against the Phase-1 book expectations**, and submit the digest. Remember: if the account has no positions, the book must be OPENED, not held. If ≥ 2 anti-thesis signals fire, the digest must be exactly one unwind_all proposal.`;
}

// ---------- raw API types (just what we consume) ----------
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

type AnthropicContentBlock = AnthropicToolUseBlock | AnthropicTextBlock | AnthropicThinkingBlock;

interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

// ---------- Anthropic call with retry ----------
async function callOnce(apiKey: string, input: ReasonerInput): Promise<ReasonerOutput> {
  const userMessage = buildUserMessage(input);

  // No `thinking` field — Anthropic rejects adaptive thinking when tool_choice
  // forces a specific tool. We need the forced tool_choice to guarantee
  // structured output, so thinking stays off. If a future tick type needs
  // deeper reasoning, remove the tool_choice force and rely on the prompt
  // to get the single tool call.
  const requestBody = {
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_digest' },
    messages: [{ role: 'user', content: userMessage }],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 500)}`);
  }

  const body = (await response.json()) as AnthropicMessagesResponse;

  // Extract the tool_use block — forced via tool_choice, so it must exist.
  const toolUse = body.content.find(
    (b): b is AnthropicToolUseBlock => b.type === 'tool_use' && b.name === 'submit_digest',
  );
  if (!toolUse) {
    throw new Error(
      `reasoner: expected submit_digest tool_use in response, got: ${body.content.map((b) => b.type).join(',')} · stop_reason=${body.stop_reason}`,
    );
  }

  const out = toolUse.input as {
    kill_switch_triggered: boolean;
    narrative: string;
    drift_notes?: string | null;
    proposals: Proposal[];
    scorecard?: Record<string, 'fired' | 'pending' | 'reversed'> | null;
  };

  // Soft-guardrail filter: annotates proposals that violate playbook rules
  // with filter_flags[]. Never drops or silently alters — always passes through
  // so the digest UI can show what Claude tried plus why the filter flagged it.
  const annotatedProposals = annotateProposals(out.proposals ?? []);

  return {
    kill_switch_triggered: out.kill_switch_triggered,
    narrative: out.narrative,
    drift_notes: out.drift_notes ?? null,
    proposals: annotatedProposals,
    scorecard: out.scorecard ?? null,
    usage: {
      input_tokens: body.usage.input_tokens,
      output_tokens: body.usage.output_tokens,
      cache_read_tokens: body.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: body.usage.cache_creation_input_tokens ?? 0,
    },
    model: MODEL,
    status: 'ok',
  };
}

export async function runReasoner(input: ReasonerInput): Promise<ReasonerOutput> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured in Edge Function secrets');
  }

  try {
    return await callOnce(apiKey, input);
  } catch (err) {
    console.warn('reasoner first attempt failed, retrying in 30s:', err);
    await new Promise((r) => setTimeout(r, 30_000));
    const retried = await callOnce(apiKey, input);
    return { ...retried, status: 'retried_ok' };
  }
}
