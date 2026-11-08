// Alert emails + Slack for kills + approvals. Piggybacks on Resend +
// SLACK_WEBHOOK_URL (same secrets as delivery.ts). Distinct subject prefixes
// so these don't get buried in the daily digest inbox thread.
//
// Functions never throw — if a channel is unconfigured or the request fails,
// they return {ok: false, error} and the caller logs it. Kill detection /
// approval creation is NEVER blocked by alert failures. "ok" means at least
// one channel delivered (matches delivery.ts semantics loosely; caller only
// cares that *someone* got the alert).

async function postResend(
  subject: string,
  textBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('DIGEST_EMAIL_TO');
  const from = Deno.env.get('DIGEST_EMAIL_FROM') ?? 'onboarding@resend.dev';
  if (!apiKey || !to) {
    return { ok: false, error: 'email not configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `2028 Tracker <${from}>`,
        to: [to],
        subject,
        text: textBody,
        html: mdToHtml(textBody),
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

async function postSlack(
  subject: string,
  textBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!webhook) return { ok: false, error: 'slack not configured' };
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: subject,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: textBody } }],
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Slack ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

async function fanout(
  subject: string,
  textBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const [email, slack] = await Promise.all([
    postResend(subject, textBody),
    postSlack(subject, textBody),
  ]);
  if (email.ok || slack.ok) return { ok: true };
  const errs = [email.error, slack.error].filter(Boolean).join(' | ');
  return { ok: false, error: errs || 'no channels configured' };
}

function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function dashboardLink(): string {
  const url = Deno.env.get('DASHBOARD_URL');
  return url ? `\n\nDashboard: ${url}` : '';
}

// ————— kill alert —————

export interface KillAlertInput {
  reason: string;            // "Daily loss stop: equity $X from $Y (-4.00%)"
  canceledOrders: number | null;
  dayPlPct?: number;
  equity?: number;
  lastEquity?: number;
}

export async function sendKillAlert(
  k: KillAlertInput,
): Promise<{ ok: boolean; error?: string }> {
  const subject = `🛑 [2028 Tracker] Stopped trading — ${k.reason.split(':')[0] || 'safety check tripped'}`;
  const body =
    `*The agent stopped placing new trades at ${new Date().toISOString()}*\n\n` +
    `Reason: ${k.reason}\n` +
    `Confirmed order cancellations: ${k.canceledOrders ?? 'unknown — inspect broker orders'}.\n\n` +
    `You need to approve before the agent will place new trades again. Existing positions are untouched — the agent only stopped opening *new* ones.` +
    dashboardLink();
  return fanout(subject, body);
}

// ————— approval alert —————

export interface ApprovalAlertInput {
  kind: 'phase_flip' | 'oversize_ticket' | 'new_ticker' | 'unwind_all' | 'resume_after_halt';
  rationale: string;
  proposals: Array<{
    action: string;
    ticker: string;
    instrument: string;
    expiry?: string | null;
    strike?: number | null;
    size_hint: string;
    rationale: string;
  }>;
  expiresIn: string; // e.g. "24 hours"
}

const KIND_URGENCY: Record<ApprovalAlertInput['kind'], string> = {
  phase_flip: '[Phase change]',
  oversize_ticket: '[Large trade]',
  new_ticker: '[New ticker]',
  unwind_all: '[Close everything]',
  resume_after_halt: '[Restart trading]',
};

function kindHumanLabel(kind: ApprovalAlertInput['kind']): string {
  switch (kind) {
    case 'phase_flip':
      return 'switching from the waiting phase to the action phase';
    case 'oversize_ticket':
      return 'placing a larger-than-usual trade';
    case 'new_ticker':
      return 'trading a ticker we have not used before';
    case 'unwind_all':
      return 'closing every position because the prediction looks wrong';
    case 'resume_after_halt':
      return 'restarting trading after the safety stop fired';
    default:
      return String(kind).replace(/_/g, ' ');
  }
}

// ————— trade-placed alert —————

export interface TradeAlertInput {
  action: string;          // 'open', 'add', 'trim', 'close', 'roll'
  side: 'buy' | 'sell';
  ticker: string;
  instrument: string;      // 'equity' | 'put' | 'call' | 'put_spread' | 'call_spread'
  option_symbol?: string | null;  // OCC symbol when instrument is an option
  expiry?: string | null;
  strike?: number | null;
  qty: number;
  /** Estimated dollar notional — guardrail-decided amount, not the fill. Market
   *  orders fill after submission; exact fill shows up in the next digest /
   *  daily report. */
  notional_usd: number | null;
  rationale: string;
  exit_condition: string;
  alpaca_order_id?: string;
  broker_status?: string;
  filled_qty?: string | number | null;
}

export function formatTradeAlert(t: TradeAlertInput): { subject: string; body: string } {
  const status = t.alpaca_order_id ? (t.broker_status ?? 'submitted') : 'advisory';
  const filled = status === 'filled' && Number(t.filled_qty) > 0;
  const label = status === 'advisory' ? 'Advisory — no order placed'
    : filled ? `${t.side === 'buy' ? 'Buy' : 'Sell'} filled`
    : status === 'filled' ? 'Fill reported — quantity unverified'
    : status === 'partially_filled' ? 'Partially filled'
    : ['rejected', 'canceled', 'expired'].includes(status) ? `Order ${status}`
    : 'Order submitted — fill unconfirmed';
  const contract = `${t.ticker} ${t.instrument.replaceAll('_', ' ')}${t.expiry ? ` ${t.expiry}` : ''}${t.strike != null ? ` @${t.strike}` : ''}`;
  const subject = `[2028 Tracker] ${label}: ${contract}`;
  const body = `*${label}: ${contract}*\n` +
    (t.alpaca_order_id ? `Order ID: ${t.alpaca_order_id}\nBroker status: ${status}\nRequested quantity: ${t.qty}\nConfirmed filled quantity: ${t.filled_qty ?? 'unknown'}\n` : '') +
    `Estimated notional (not a fill): ${t.notional_usd == null ? 'unknown' : `$${t.notional_usd.toFixed(2)}`}\n\n` +
    `Reason for proposal or rule: ${t.rationale}\nExit rule: ${t.exit_condition}`;
  return { subject, body };
}

export async function sendTradeAlert(t: TradeAlertInput): Promise<{ ok: boolean; error?: string }> {
  const { subject, body } = formatTradeAlert(t);
  return fanout(subject, body + dashboardLink());
}

export async function sendExecutionSummary(steps: string[]): Promise<{ ok: boolean; error?: string }> {
  return fanout('[2028 Tracker] Approved orders submitted — fills unconfirmed',
    `${steps.length} order submissions: ${steps.join(', ')}. Check order records for fills.` + dashboardLink());
}

function approvalActionLabel(action: string): string {
  switch (action) {
    case 'open': return 'BUY';
    case 'add': return 'BUY MORE';
    case 'trim': return 'SELL SOME';
    case 'close': return 'SELL';
    case 'roll': return 'REPLACE';
    case 'hold': return 'HOLD';
    case 'unwind_all': return 'CLOSE EVERYTHING';
    default: return action.toUpperCase();
  }
}

function approvalSizeLabel(size: string): string {
  switch (size) {
    case 'starter': return 'small starter position';
    case 'half': return 'half position';
    case 'full': return 'full position';
    case 'trim_third': return 'sell 1/3';
    case 'trim_half': return 'sell 1/2';
    default: return size.replace(/_/g, ' ');
  }
}

export async function sendApprovalAlert(
  a: ApprovalAlertInput,
): Promise<{ ok: boolean; error?: string }> {
  const kindLabel = KIND_URGENCY[a.kind] ?? `[${a.kind}]`;
  const subject = `${kindLabel} [2028 Tracker] Need your okay on ${a.proposals.length} suggested move${a.proposals.length === 1 ? '' : 's'}`;
  const proposalLines = a.proposals
    .map((p, i) => {
      const instr = p.instrument === 'equity' ? '' : ` ${p.instrument.replace('_', ' ')}`;
      const ex = p.expiry ? ` ${p.expiry}` : '';
      const str = p.strike != null ? ` @${p.strike}` : '';
      return `${i + 1}. *${approvalActionLabel(p.action)}* ${p.ticker}${instr}${ex}${str} (${approvalSizeLabel(p.size_hint)})\n   ${p.rationale}`;
    })
    .join('\n\n');
  const body =
    `*The agent wants your okay before ${kindHumanLabel(a.kind)}.*\n\n` +
    `${a.rationale}\n\n` +
    (proposalLines ? `${a.proposals.length} suggested move${a.proposals.length === 1 ? '' : 's'}:\n${proposalLines}\n\n` : '') +
    `This request expires in ${a.expiresIn}.` +
    dashboardLink();
  return fanout(subject, body);
}
