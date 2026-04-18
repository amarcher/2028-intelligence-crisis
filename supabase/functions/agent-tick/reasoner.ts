// Anthropic reasoner for agent-tick.
// Prompt is aggressively cached on the static playbook + rubric + tool definition —
// only the user message varies per tick, so cache_read_input_tokens should hit
// on every invocation after the first. Invalidators to avoid: never put timestamps,
// tick numbers, or session IDs in the system prompt or tool schema.

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.39.0';
import type { SignalsResult, Signal } from '../../../src/lib/signals.ts';

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
}

export interface RecentDigest {
  created_at: string;
  tick_type: string;
  phase: string;
  fired_count: number;
  narrative: string;
  kill_switch_triggered: boolean;
}

export interface ReasonerInput {
  tickType: TickType;
  signals: SignalsResult;
  drift: DriftSummary;
  recentDigests: RecentDigest[];
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

const WHITELIST = [
  // Phase-1 longs (AI bubble ride)
  'QQQ', 'SMH', 'IGV', 'NVDA', 'AVGO', 'ORCL', 'ANET', 'VRT', 'CEG',
  'MSFT', 'GOOGL', 'META',
  // Defensive carry
  'TLT', 'GLD', 'IAU', 'XLP', 'KO', 'PG', 'COST', 'WMT',
  // Asymmetric SaaS put thesis
  'NOW', 'CRM', 'HUBS', 'WDAY', 'DDOG', 'FRSH',
  // Credit + CRE shorts
  'KRE', 'HYG', 'JNK', 'IYR', 'VNQ', 'BXP', 'SLG',
  // Housing roll
  'ITB', 'XHB', 'OPEN', 'Z', 'RDFN',
  // Consumer / staffing shorts
  'XLY', 'RH', 'W', 'CCL', 'NCLH', 'UPWK', 'FIVN',
  // Indices + vol
  'SPY', 'IWM', 'VIXY',
];

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

## Memory

You receive the last 3 digests (or 8 on weekly ticks). Use them to:
- Avoid repeating yourself. If you flagged a trim on NOW yesterday and nothing has changed, say "no change — prior trim stands" rather than re-proposing the same trim.
- Note drift versus your prior read: "yesterday I called the tape thesis-aligned; today JOLTS reversed up, softer read."
- Track whether the user is acting on your proposals (you can't see this directly, but patterns in signal state across digests can hint at it).

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
const TOOL: Anthropic.Tool = {
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

export function buildUserMessage(input: ReasonerInput): string {
  const { tickType, signals, drift, recentDigests } = input;
  return `tick_type: ${tickType}

Current signal state (${signals.firedCount}/5 firing · phase: ${signals.phase}):
${signals.signals.map(renderSignal).join('\n')}

Week-over-week drift (last print · change):
${renderWow('JOLTS', drift.jolts)}
${renderWow('Initial claims', drift.claims)}
${renderWow('S&P 500', drift.sp500)}
${renderWow('Case-Shiller national', drift.caseShiller)}

Recent digests (most-recent first):
${renderRecentDigests(recentDigests)}

Now evaluate the kill-switch, classify drift, and submit the digest. Remember: if ≥ 2 anti-thesis signals fire, the digest must be exactly one unwind_all proposal.`;
}

// ---------- Anthropic call with retry ----------
async function callOnce(
  client: Anthropic,
  input: ReasonerInput,
): Promise<ReasonerOutput> {
  const userMessage = buildUserMessage(input);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
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
  });

  // Extract the tool_use block — forced via tool_choice, so it must exist.
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_digest',
  );
  if (!toolUse) {
    throw new Error(
      `reasoner: expected submit_digest tool_use in response, got: ${response.content.map((b) => b.type).join(',')}`,
    );
  }

  const out = toolUse.input as {
    kill_switch_triggered: boolean;
    narrative: string;
    drift_notes?: string | null;
    proposals: Proposal[];
    scorecard?: Record<string, 'fired' | 'pending' | 'reversed'> | null;
  };

  return {
    kill_switch_triggered: out.kill_switch_triggered,
    narrative: out.narrative,
    drift_notes: out.drift_notes ?? null,
    proposals: out.proposals ?? [],
    scorecard: out.scorecard ?? null,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: response.usage.cache_creation_input_tokens ?? 0,
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
  const client = new Anthropic({ apiKey });

  try {
    return await callOnce(client, input);
  } catch (err) {
    console.warn('reasoner first attempt failed, retrying in 30s:', err);
    await new Promise((r) => setTimeout(r, 30_000));
    const retried = await callOnce(client, input);
    return { ...retried, status: 'retried_ok' };
  }
}
