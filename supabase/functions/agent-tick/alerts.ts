// Alert emails for kills + approvals. Piggybacks on Resend (same secrets
// as delivery.ts). Distinct subject prefixes so these don't get buried in
// the daily digest inbox thread.
//
// Both functions never throw — if Resend is unconfigured or the request
// fails, they return {ok: false, error} and the caller logs it. Kill
// detection / approval creation is NEVER blocked by alert failures.

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
        from: `2028 Crisis Agent <${from}>`,
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
  canceledOrders: number;
  dayPlPct?: number;
  equity?: number;
  lastEquity?: number;
}

export async function sendKillAlert(
  k: KillAlertInput,
): Promise<{ ok: boolean; error?: string }> {
  const subject = `🛑 [2028 AGENT] HALT — ${k.reason.split(':')[0] || 'kill switch'}`;
  const body =
    `*Agent halted at ${new Date().toISOString()}*\n\n` +
    `Reason: ${k.reason}\n` +
    `Canceled ${k.canceledOrders} open order${k.canceledOrders === 1 ? '' : 's'}.\n\n` +
    `Owner approval required to resume new entries.` +
    dashboardLink();
  return postResend(subject, body);
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
  phase_flip: '[PHASE FLIP]',
  oversize_ticket: '[OVERSIZE]',
  new_ticker: '[NEW TICKER]',
  unwind_all: '[UNWIND]',
  resume_after_halt: '[RESUME HALT]',
};

export async function sendApprovalAlert(
  a: ApprovalAlertInput,
): Promise<{ ok: boolean; error?: string }> {
  const kindLabel = KIND_URGENCY[a.kind] ?? `[${a.kind}]`;
  const subject = `${kindLabel} [2028 AGENT] approval needed (${a.proposals.length} proposal${a.proposals.length === 1 ? '' : 's'})`;
  const proposalLines = a.proposals
    .map((p, i) => {
      const instr = p.instrument === 'equity' ? '' : ` ${p.instrument.replace('_', ' ')}`;
      const ex = p.expiry ? ` ${p.expiry}` : '';
      const str = p.strike != null ? ` @${p.strike}` : '';
      return `${i + 1}. *${p.action.toUpperCase()}* ${p.ticker}${instr}${ex}${str} (${p.size_hint})\n   ${p.rationale}`;
    })
    .join('\n\n');
  const body =
    `*The agent needs your approval on a ${a.kind.replace(/_/g, ' ')}.*\n\n` +
    `${a.rationale}\n\n` +
    (proposalLines ? `${a.proposals.length} proposal${a.proposals.length === 1 ? '' : 's'}:\n${proposalLines}\n\n` : '') +
    `Expires in ${a.expiresIn}.` +
    dashboardLink();
  return postResend(subject, body);
}
