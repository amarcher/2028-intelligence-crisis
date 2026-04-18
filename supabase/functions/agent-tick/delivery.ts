// Digest delivery — Resend email + Slack webhook.
// Called after the digest row lands. Never throws: if a channel isn't
// configured it silently no-ops; if it fails it logs and reports a false
// delivered flag. Tick success is independent of delivery success.
//
// Required secrets (set each in Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY          — required to enable email
//   DIGEST_EMAIL_TO         — recipient email (required to enable email)
//   DIGEST_EMAIL_FROM       — sender; defaults to onboarding@resend.dev
//   SLACK_WEBHOOK_URL       — required to enable Slack
//   DASHBOARD_URL           — optional; included as a permalink in the digest

import type { Proposal } from './reasoner.ts';

export interface DigestPayload {
  tick_type: 'premarket' | 'close' | 'weekly';
  phase: 'counterfactual_grind' | 'inflection';
  fired_count: number;
  kill_switch_triggered: boolean;
  narrative: string;
  proposals: Proposal[];
  drift_notes: string | null;
  reasoner_status: string;
}

export interface DeliveryResult {
  delivered_email: boolean;
  delivered_slack: boolean;
  errors: string[];
}

// ——— subject / headline ———

function phaseLabel(phase: DigestPayload['phase']): string {
  return phase === 'inflection' ? 'Phase 2 · INFLECTION' : 'Phase 1';
}

function subject(d: DigestPayload): string {
  if (d.kill_switch_triggered) {
    return `[2028 Crisis · KILL-SWITCH] unwind proposal`;
  }
  if (d.reasoner_status.startsWith('fallback')) {
    return `[2028 Crisis · ${d.tick_type}] reasoner unavailable`;
  }
  const phaseLabel = d.phase === 'inflection' ? 'INFLECTION' : 'grind';
  // Headline is the first sentence of the narrative, capped.
  const firstSentence = d.narrative.split(/(?<=[.!?])\s/)[0].slice(0, 90);
  return `[2028 · ${phaseLabel} · ${d.fired_count}/5 · ${d.tick_type}] ${firstSentence}`;
}

// ——— markdown body (shared between email + Slack mrkdwn) ———

function formatProposal(p: Proposal, i: number): string {
  const urgencyLabel =
    p.urgency === 'act_today'
      ? '🔥 act today'
      : p.urgency === 'this_week'
        ? '↗ this week'
        : '○ waiting';
  const instr = p.instrument === 'equity' ? '' : ` ${p.instrument.replace('_', ' ')}`;
  const expiry = p.expiry ? ` ${p.expiry}` : '';
  const strike = p.strike != null ? ` @${p.strike}` : '';
  return `${i + 1}. *${p.action.toUpperCase()}* ${p.ticker}${instr}${expiry}${strike} — _${p.size_hint}_ · ${urgencyLabel}\n   ${p.rationale}`;
}

function buildBody(d: DigestPayload, dashboardUrl: string | null): string {
  const header = d.kill_switch_triggered
    ? `🛑 *KILL-SWITCH TRIGGERED* — anti-thesis signals firing. Consider unwinding.`
    : `*${phaseLabel(d.phase)}* · ${d.fired_count}/5 signals firing · _${d.tick_type}_`;

  const drift = d.drift_notes ? `\n\n*Drift:* ${d.drift_notes}` : '';

  const proposals =
    d.proposals.length > 0
      ? `\n\n*Proposals:*\n${d.proposals.map(formatProposal).join('\n\n')}`
      : '';

  const footer = dashboardUrl
    ? `\n\n—\n<${dashboardUrl}|Open dashboard>`
    : '';

  return `${header}\n\n${d.narrative}${drift}${proposals}${footer}`;
}

// Light HTML conversion for email — keeps formatting legible in Gmail etc.
function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ——— channels ———

async function sendEmail(d: DigestPayload, dashboardUrl: string | null): Promise<{ ok: boolean; err?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('DIGEST_EMAIL_TO');
  const from = Deno.env.get('DIGEST_EMAIL_FROM') ?? 'onboarding@resend.dev';

  if (!apiKey || !to) {
    return { ok: false, err: 'email not configured (RESEND_API_KEY or DIGEST_EMAIL_TO missing)' };
  }

  const body = buildBody(d, dashboardUrl);

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
        subject: subject(d),
        html: mdToHtml(body),
        text: body,
      }),
    });
    if (!res.ok) {
      return { ok: false, err: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: `Resend fetch threw: ${String(e).slice(0, 300)}` };
  }
}

async function sendSlack(d: DigestPayload, dashboardUrl: string | null): Promise<{ ok: boolean; err?: string }> {
  const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!webhook) return { ok: false, err: 'slack not configured (SLACK_WEBHOOK_URL missing)' };

  const body = buildBody(d, dashboardUrl);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: subject(d), // fallback for notifications
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: body } },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, err: `Slack ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: `Slack fetch threw: ${String(e).slice(0, 300)}` };
  }
}

// ——— entry ———

export async function deliverDigest(d: DigestPayload): Promise<DeliveryResult> {
  const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? null;

  const [email, slack] = await Promise.all([
    sendEmail(d, dashboardUrl),
    sendSlack(d, dashboardUrl),
  ]);

  const errors: string[] = [];
  if (!email.ok && email.err) errors.push(`email: ${email.err}`);
  if (!slack.ok && slack.err) errors.push(`slack: ${slack.err}`);
  if (errors.length > 0) console.warn('delivery issues:', errors);

  return {
    delivered_email: email.ok,
    delivered_slack: slack.ok,
    errors,
  };
}
