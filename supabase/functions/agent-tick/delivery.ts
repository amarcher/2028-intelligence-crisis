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

export interface DeliveryResult {
  delivered_email: boolean;
  delivered_slack: boolean;
  errors: string[];
}

// ——— subject / headline ———

function phaseLabel(phase: DigestPayload['phase']): string {
  return phase === 'inflection' ? 'Phase 2 · Action phase' : 'Phase 1 · Waiting phase';
}

function tickTypeLabel(t: DigestPayload['tick_type']): string {
  return t === 'premarket'
    ? 'morning check'
    : t === 'midday'
      ? 'midday check (something moved)'
      : t === 'close'
        ? 'end-of-day check'
        : 'weekly review';
}

function subject(d: DigestPayload): string {
  if (d.kill_switch_triggered) {
    return `[2028 Tracker] Abort signal — recommend closing all positions`;
  }
  if (d.reasoner_status.startsWith('fallback')) {
    return `[2028 Tracker · ${tickTypeLabel(d.tick_type)}] reasoner unavailable`;
  }
  const phaseShort = d.phase === 'inflection' ? 'Action phase' : 'Waiting phase';
  // Headline is the first sentence of the narrative, capped.
  const firstSentence = d.narrative.split(/(?<=[.!?])\s/)[0].slice(0, 90);
  return `[2028 Tracker · ${phaseShort} · ${d.fired_count}/6 readings crossed · ${tickTypeLabel(d.tick_type)}] ${firstSentence}`;
}

// ——— markdown body (shared between email + Slack mrkdwn) ———

function actionLabel(action: string): string {
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

function sizeLabel(size: string): string {
  switch (size) {
    case 'starter': return 'small starter position';
    case 'half': return 'half position';
    case 'full': return 'full position';
    case 'trim_third': return 'sell 1/3';
    case 'trim_half': return 'sell 1/2';
    default: return size.replace(/_/g, ' ');
  }
}

function urgencyLabel(u: string): string {
  switch (u) {
    case 'act_today': return '🔥 do this today';
    case 'this_week': return '↗ this week';
    case 'waiting_for_trigger': return '○ waiting for a signal to cross';
    default: return u.replace(/_/g, ' ');
  }
}

function formatProposal(p: Proposal, i: number): string {
  const instr = p.instrument === 'equity' ? '' : ` ${p.instrument.replace('_', ' ')}`;
  const expiry = p.expiry ? ` ${p.expiry}` : '';
  const strike = p.strike != null ? ` @${p.strike}` : '';
  return `${i + 1}. *${actionLabel(p.action)}* ${p.ticker}${instr}${expiry}${strike} — _${sizeLabel(p.size_hint)}_ · ${urgencyLabel(p.urgency)}\n   ${p.rationale}`;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function formatActiveSleeve(active: ActiveSleeveSummary | null): string {
  if (!active) return '';
  const risk = active.riskBudget;
  const perf = active.performance;
  const sleeve = active.currentSleeve;
  const lines = [
    `*Active trading read:* ${active.stance.toUpperCase()} · ${active.score}/100`,
    `SaaS vs AI: ${active.momentum.saasVsAi20d == null ? '—' : fmtPct(active.momentum.saasVsAi20d)} over 20 trading days ` +
      `(SaaS ${active.momentum.saas20d == null ? '—' : fmtPct(active.momentum.saas20d)} · AI ${active.momentum.ai20d == null ? '—' : fmtPct(active.momentum.ai20d)})`,
  ];
  if (risk) {
    lines.push(
      `Risk room: ${risk.posture.replace(/_/g, ' ')} · ${fmtUsd(risk.activeSleeveRoomValue)} active room ` +
        `(${risk.activeSleeveUsedPct.toFixed(0)}% of ${risk.activeSleeveBudgetPct}% sleeve used) · gross exposure ${fmtPct(risk.grossExposurePct)}` +
        (risk.netDeltaExposurePct != null
          ? ` · net market exposure ${fmtPct(risk.netDeltaExposurePct)} of the account (options counted by how much they actually move)`
          : ''),
    );
  }
  if (perf) {
    lines.push(
      `Portfolio: equity ${fmtUsd(perf.equity)} · cash ${fmtUsd(perf.cash)} · today ${fmtUsd(perf.dayProfitLoss)} (${fmtPct(perf.dayProfitLossPct)})`,
    );
  }
  if (sleeve) {
    lines.push(
      `Sleeve: SaaS puts ${fmtUsd(sleeve.saasPutValue)} (${fmtUsd(sleeve.saasPutProfitLoss)} profit/loss) · ` +
        `AI longs ${fmtUsd(sleeve.aiLongValue)} · safe-haven ${fmtUsd(sleeve.defensiveValue)} · ` +
        `SaaS add room ${fmtUsd(sleeve.addCapacityValue)}`,
    );
  }
  if (active.reasons.length > 0) {
    lines.push(`Why: ${active.reasons.join(' ')}`);
  }
  return `\n\n${lines.join('\n')}`;
}

function buildBody(d: DigestPayload, dashboardUrl: string | null): string {
  const header = d.kill_switch_triggered
    ? `🛑 *Abort signal* — the economy is moving the opposite way from what we expected. The agent recommends closing every position.`
    : `*${phaseLabel(d.phase)}* · ${d.fired_count} of 6 economic readings have crossed the danger line · _${tickTypeLabel(d.tick_type)}_`;

  const drift = d.drift_notes ? `\n\n*This week's economic update:* ${d.drift_notes}` : '';
  const activeSleeve = formatActiveSleeve(d.active_sleeve);

  const proposals =
    d.proposals.length > 0
      ? `\n\n*Suggested moves:*\n${d.proposals.map(formatProposal).join('\n\n')}`
      : '';

  const footer = dashboardUrl
    ? `\n\n—\n<${dashboardUrl}|Open the dashboard>`
    : '';

  return `${header}\n\n${d.narrative}${activeSleeve}${drift}${proposals}${footer}`;
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
