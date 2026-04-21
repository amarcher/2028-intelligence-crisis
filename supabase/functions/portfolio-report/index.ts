// Supabase Edge Function: Daily portfolio report.
// Fires once per trading day ~15 minutes after the close via pg_cron. Fetches
// the Alpaca account + positions, computes day P&L vs the prior trading day
// (Alpaca's `last_equity` field), and posts a formatted snapshot to Slack.
//
// Deploy: supabase functions deploy portfolio-report
// Invoke: curl -X POST <function-url>
//
// Required secrets (Edge Function Secrets):
//   ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALPACA_PAPER_MODE  — from agent-tick
//   SLACK_WEBHOOK_URL                                    — posting target
//   DASHBOARD_URL                                        — optional permalink

import {
  alpacaFromEnv,
  getAccount,
  getPositions,
  type AlpacaAccount,
  type AlpacaPosition,
} from '../agent-tick/alpaca.ts';

Deno.serve(async () => {
  try {
    const creds = alpacaFromEnv();
    const [account, positions] = await Promise.all([getAccount(creds), getPositions(creds)]);

    const body = buildMessage(account, positions);
    const subject = buildSubject(account);

    const slack = await postSlack(subject, body);

    return json({
      ok: true,
      equity: account.equity,
      last_equity: account.last_equity,
      day_pl: account.equity - account.last_equity,
      positions: positions.length,
      slack_delivered: slack.ok,
      slack_error: slack.ok ? null : slack.error,
    });
  } catch (err) {
    console.error('portfolio-report failed:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ————— formatting —————

function buildSubject(a: AlpacaAccount): string {
  const dayPl = a.equity - a.last_equity;
  const arrow = dayPl >= 0 ? '↑' : '↓';
  return `${arrow} [2028 Portfolio] ${fmtUsd(a.equity)} (${fmtSignedUsd(dayPl)} today)`;
}

function buildMessage(a: AlpacaAccount, positions: AlpacaPosition[]): string {
  const dayPl = a.equity - a.last_equity;
  const dayPlPct = a.last_equity > 0 ? (dayPl / a.last_equity) * 100 : 0;
  const arrow = dayPl >= 0 ? '↑' : '↓';

  // Top mover — position with largest absolute unrealized P&L today (rough
  // proxy; Alpaca doesn't surface per-position day P&L on /v2/positions, so
  // we use unrealized P&L which is entry-to-now rather than yesterday-to-now).
  const topMover = positions
    .slice()
    .sort((x, y) => Math.abs(y.unrealized_pl) - Math.abs(x.unrealized_pl))[0];

  const moverLine = topMover
    ? `\n  top position P&L: ${topMover.symbol} ${fmtSignedUsd(topMover.unrealized_pl)}`
    : '';

  const dashboardUrl = Deno.env.get('DASHBOARD_URL');
  const dashboardLine = dashboardUrl ? `\n\n<${dashboardUrl}|Open dashboard>` : '';

  return (
    `*📊 2028 Portfolio — ${fmtUsd(a.equity)}*\n` +
    `${arrow} ${fmtSignedUsd(dayPl)} (${fmtSignedPct(dayPlPct)}) today\n` +
    `  cash: ${fmtUsd(a.cash)} · buying power: ${fmtUsd(a.buying_power)} · positions: ${positions.length}` +
    moverLine +
    dashboardLine
  );
}

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function fmtSignedUsd(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ————— Slack delivery —————

async function postSlack(
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!webhook) return { ok: false, error: 'SLACK_WEBHOOK_URL not configured' };
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: subject,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: body } }],
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

function json(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
