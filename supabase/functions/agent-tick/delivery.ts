import { reportText, type OperationalReport } from '../../../src/lib/operationalReport.ts';
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

import type { ActiveSleeveSummary, Proposal } from './reasoner.ts';

export interface DigestPayload {
  operational_report: OperationalReport;
  tick_type: 'premarket' | 'midday' | 'close' | 'weekly';
  phase: 'counterfactual_grind' | 'inflection';
  fired_count: number;
  kill_switch_triggered: boolean;
  narrative: string;
  proposals: Proposal[];
  drift_notes: string | null;
  active_sleeve: ActiveSleeveSummary | null;
  reasoner_status: string;
}

export interface DeliveryResult { delivered_email: boolean; delivered_slack: boolean; errors: string[] }

export function subject(d: DigestPayload): string {
  const r = d.operational_report;
  const status = r.halted == null ? 'status unknown' : r.halted ? 'trading halted' : 'halt flag clear';
  return `[2028 Tracker · ${d.tick_type}] ${status} · ${d.fired_count}/6 thresholds crossed`;
}

export function buildBody(d: DigestPayload, dashboardUrl: string | null): string {
  return reportText(d.operational_report) + (dashboardUrl ? `\n\nDashboard: ${dashboardUrl}` : '');
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
        from: `2028 Tracker <${from}>`,
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
        blocks: body.match(/[\s\S]{1,2800}/g)?.map(text => ({ type: 'section', text: { type: 'mrkdwn', text } })),
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

export async function deliverDigest(d: DigestPayload, channels = { email: true, slack: true }): Promise<DeliveryResult> {
  const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? null;

  const [email, slack] = await Promise.all([
    channels.email ? sendEmail(d, dashboardUrl) : Promise.resolve<{ ok: boolean; err?: string }>({ ok: false }),
    channels.slack ? sendSlack(d, dashboardUrl) : Promise.resolve<{ ok: boolean; err?: string }>({ ok: false }),
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
