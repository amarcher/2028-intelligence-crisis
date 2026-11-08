import { allocationPct, EVIDENCE_VERSION, ORDER_SIZE_PCT } from './evidence.ts';

export interface OperationalReport {
  version: string;
  observedAt: string;
  mode: string;
  halted: boolean | null;
  haltedAt: string | null;
  haltReason: string | null;
  dataIssues: string[];
  equity: number | null;
  allocations: Array<{ ticker: string; value: number; equityPct: number | null }>;
  signals: Array<{ key: string; state: string; reading: string; asOf?: string | null }>;
  orders: Array<{ ticker: string; status: string; alpaca_order_id: string | null; rejection_reason?: string | null }> | null;
  approvals: number | null;
  executionError: string | null;
  relativeReturn: number | null;
}

export function makeReport(input: Omit<OperationalReport, 'version' | 'allocations'> & { positions?: Array<{ ticker: string; market_value: number }> }): OperationalReport {
  const { positions, ...rest } = input;
  const byTicker = new Map<string, number>();
  for (const p of positions ?? []) byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + p.market_value);
  return { ...rest, version: EVIDENCE_VERSION,
    allocations: [...byTicker].map(([ticker, value]) => ({ ticker, value, equityPct: allocationPct(value, input.equity ?? NaN) })) };
}

export function reportText(r: OperationalReport): string {
  const status = r.halted == null ? 'Trading status unavailable; no execution authorized.' : r.halted
    ? `Trading HALTED since ${r.haltedAt ?? 'unknown date'}. Reason: ${r.haltReason ?? 'not recorded'}. No automatic restart.`
    : `Halt flag clear at ${r.observedAt}; this alone does not authorize an order.`;
  const orders = r.orders == null ? 'Order evidence unavailable; execution outcome unknown.' : r.orders.length === 0
    ? 'No order records for this check. No claim of a trade or retry.'
    : r.orders.map(o => `${o.ticker}: ${o.status}${o.alpaca_order_id ? ` (broker ID ${o.alpaca_order_id})` : ' (no broker order ID)'}${o.rejection_reason ? ` — ${o.rejection_reason}` : ''}`).join('\n');
  const holdings = r.equity == null ? 'Account holdings unavailable.' : `Account equity: $${r.equity.toFixed(2)}.\n` + r.allocations.map(p => `${p.ticker}: $${p.value.toFixed(2)} = ${p.equityPct?.toFixed(2) ?? 'unknown'}% of account equity.`).join('\n');
  const unknown = r.signals.filter(s => s.state === 'unknown').length;
  const signals = `${r.signals.filter(s => s.state === 'fired').length}/${r.signals.length} thresholds crossed; ${unknown} unavailable.\n` + r.signals.map(s => `${s.key}: ${s.state} · ${s.reading} · observation ${s.asOf ?? 'unknown'}`).join('\n');
  const relative = r.relativeReturn == null ? 'Relative SaaS/AI performance unavailable.' : `SaaS minus AI basket return over 20 sessions: ${r.relativeReturn.toFixed(2)} percentage points. ${r.relativeReturn >= 0 ? 'SaaS is outperforming this basket; this does not support the relative-underperformance thesis in this window.' : 'SaaS is underperforming this basket; this is a market observation, not proof of AI causation.'}`;
  return [`As of ${r.observedAt} · mode ${r.mode}`, status,
    r.dataIssues.length ? `DATA QUALITY: ${r.dataIssues.join('; ')}` : 'Required research observations passed age and completeness checks.',
    signals, relative, holdings,
    `No per-ticker allocation targets are configured. Starter/half/full specify incremental order sizes of ${ORDER_SIZE_PCT.starter}%/${ORDER_SIZE_PCT.half}%/${ORDER_SIZE_PCT.full}% of equity; they are not holding targets.`,
    `Order records for this check:\n${orders}`, `Approval requests for this check: ${r.approvals ?? 'unknown'}. Approval is not a fill.`,
    r.executionError ? `Execution issue: ${r.executionError}` : '',
  ].filter(Boolean).join('\n\n');
}

export function reportFingerprint(r: OperationalReport): string {
  return JSON.stringify({ version: r.version, halted: r.halted, haltReason: r.haltReason,
    issues: r.dataIssues, signals: r.signals.map(s => [s.key, s.state]),
    relativeBand: r.relativeReturn == null ? null : Math.floor(r.relativeReturn / 2),
    orders: r.orders, approvals: r.approvals, error: r.executionError });
}

export function shouldDeliver(r: OperationalReport, tickType: string, previous?: { fingerprint: string; observedAt: string } | null): boolean {
  if (!previous || previous.fingerprint !== reportFingerprint(r)) return true;
  const day = (date: string) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return (tickType === 'close' || tickType === 'weekly') && day(previous.observedAt) !== day(r.observedAt);
}

export function deliveryChannels(due: boolean, enabled: { email: boolean; slack: boolean }, receipts: Array<{ delivered_email: boolean; delivered_slack: boolean }>) {
  return { email: enabled.email && (due || !receipts.some(r => r.delivered_email)),
    slack: enabled.slack && (due || !receipts.some(r => r.delivered_slack)) };
}
