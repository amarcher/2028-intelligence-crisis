import { computeProximity } from '../src/lib/proximity.ts';
import { strict as assert } from 'node:assert';
import { allocationPct, accountQuality, revenueTrend, alignedReturns } from '../src/lib/evidence.ts';
import { computeSignals, evalClaims, evalSp500 } from '../src/lib/signals.ts';
import { makeReport, reportText, shouldDeliver, reportFingerprint, deliveryChannels } from '../src/lib/operationalReport.ts';
import { easternDayStart, scheduledTick, inSession } from '../src/lib/marketSession.ts';
import { formatTradeAlert } from '../supabase/functions/agent-tick/alerts.ts';
import { buildBody, subject, type DigestPayload } from '../supabase/functions/agent-tick/delivery.ts';
import { orchestrateExecution, type ExecutionInput } from '../supabase/functions/agent-tick/execute.ts';
import type { SaaSDataPoint } from '../src/lib/types.ts';

const now = new Date('2026-11-08T16:00:00Z');
const empty = { jolts: [], claims: [], sp500: [], caseShiller: [], saas: [], hyOas: [], now };
const baseReport = () => makeReport({ observedAt: '2026-11-03T14:15:00Z', mode: 'auto_execute', halted: true,
  haltedAt: '2026-06-01T14:00:00Z', haltReason: 'Daily loss stop', dataIssues: [], equity: 100000,
  positions: [{ ticker: 'TLT', market_value: 4870 }], signals: [], orders: [], approvals: 0, executionError: null, relativeReturn: 5.84 });

Deno.test('Holding allocations use account equity, not an invented holding target', () => {
  assert.equal(allocationPct(4220, 100000)?.toFixed(2), '4.22');
  assert.equal(allocationPct(4870, 100000)?.toFixed(2), '4.87');
  assert.equal(allocationPct(100, 0), null);
  const text = reportText(baseReport());
  assert.match(text, /4.87% of account equity/);
  assert.match(text, /No per-ticker allocation targets/);
  assert.match(text, /HALTED since 2026-06-01/);
  assert.match(text, /No claim of a trade or retry/);
  assert.match(text, /does not support the relative-underperformance thesis/);
});
const advisory = { action: 'roll', side: 'sell' as const, ticker: 'CRM', instrument: 'put', expiry: '2027-01-15', strike: 210,
  qty: 1, notional_usd: 1500, rationale: 'Expires soon', exit_condition: 'Advisory only' };
Deno.test('Roll advisory never claims a replacement', () => {
  const a = formatTradeAlert(advisory);
  assert.match(a.subject, /Advisory — no order placed/);
  assert.doesNotMatch(a.subject, /Replaced|Bought|Closed|✅/);
});
Deno.test('broker acceptance is distinct from a fill; sell leg is not a completed roll', () => {
  const submitted = formatTradeAlert({ ...advisory, alpaca_order_id: 'test', broker_status: 'accepted', filled_qty: '0' });
  assert.match(submitted.subject, /submitted — fill unconfirmed/);
  const filled = formatTradeAlert({ ...advisory, alpaca_order_id: 'test', broker_status: 'filled', filled_qty: '1' });
  assert.match(filled.subject, /Sell filled/);
  assert.doesNotMatch(filled.subject, /Replaced/);
  assert.match(formatTradeAlert({ ...advisory, alpaca_order_id: 'test', broker_status: 'rejected' }).subject, /Order rejected/);
});
Deno.test('digest cannot broadcast model claims of cleared stops, re-sends or wrong allocation', () => {
  const d: DigestPayload = { tick_type: 'close', phase: 'counterfactual_grind', fired_count: 0, kill_switch_triggered: false,
    narrative: 'Loss stop cleared; resending TLT buys, below 1% target.', drift_notes: 'I bought more.', proposals: [],
    active_sleeve: null, reasoner_status: 'ok', operational_report: baseReport() };
  assert.doesNotMatch(buildBody(d, null), /Loss stop cleared|resending|below 1%|I bought/);
  assert.match(subject(d), /trading halted/);
});
Deno.test('unknown orders stay unknown, submitted never becomes filled', () => {
  const r = baseReport(); r.orders = null;
  assert.match(reportText(r), /execution outcome unknown/);
  r.orders = [{ ticker: 'GLD', status: 'submitted', alpaca_order_id: 'a' }];
  assert.match(reportText(r), /GLD: submitted \(broker ID a\)/);
  assert.doesNotMatch(reportText(r), /GLD: filled/);
});
Deno.test('unchanged intraday report stays quiet, daily close and material change deliver', () => {
  const r = baseReport(); const prior = { fingerprint: reportFingerprint(r), observedAt: r.observedAt };
  assert.equal(shouldDeliver(r, 'midday', prior), false);
  r.observedAt = '2026-11-04T21:15:00Z';
  assert.equal(shouldDeliver(r, 'close', prior), true);
  assert.equal(shouldDeliver(r, 'premarket', prior), false);
  r.dataIssues = ['Missing VIX'];
  assert.equal(shouldDeliver(r, 'midday', prior), true);
});
Deno.test('missing data is unknown, not six negative readings', () => {
  const result = computeSignals(empty);
  assert.equal(result.unknownCount, 6); assert.equal(result.firedCount, 0);
  assert.match(result.phaseLabel, /INCOMPLETE/);
});
Deno.test('claims require four consecutive weeks; stale high data cannot fire', () => {
  assert.equal(evalClaims([{ date: '2026-10-31', value: 400000 }]).fired, false);
  const claims = ['2026-10-10','2026-10-17','2026-10-24','2026-10-31'].map(date => ({ date, value: 400000 }));
  assert.equal(computeSignals({ ...empty, claims }).signals.find(s => s.key === 'claims')?.state, 'fired');
  assert.equal(computeSignals({ ...empty, claims, now: new Date('2027-01-01') }).signals.find(s => s.key === 'claims')?.state, 'unknown');
  claims[1].date = '2026-10-11';
  assert.equal(computeSignals({ ...empty, claims }).signals.find(s => s.key === 'claims')?.state, 'unknown');
});
Deno.test('future observations and missing housing comparison are unknown', () => {
  const result = computeSignals({ ...empty, sp500: [{ date: '2027-01-01', value: 7000 }], caseShiller: [{ date: '2026-08-01', value: 300 }] });
  assert.equal(result.signals.find(s => s.key === 'sp500')?.state, 'unknown');
  assert.equal(result.signals.find(s => s.key === 'housing')?.state, 'unknown');
});
Deno.test('new equal all-time high restarts the stall clock', () => {
  assert.equal(evalSp500([{ date: '2026-01-01', value: 8000 }, { date: '2026-10-01', value: 8000 }, { date: '2026-10-02', value: 7900 }]).fired, false);
});
const row = (date: string, values: Partial<SaaSDataPoint>): SaaSDataPoint => ({ date, servicenow: null, salesforce: null, workday: null, hubspot: null, freshworks: null, datadog: null, ...values });
Deno.test('asynchronous company releases compare the same paired cohort', () => {
  const result = revenueTrend([
    row('2026-04-30', { salesforce: 12, workday: 14 }), row('2026-06-30', { servicenow: 22 }),
    row('2026-07-31', { salesforce: 10.83, workday: 12.82 }), row('2026-09-30', { servicenow: 20.52 }),
  ], now);
  assert.equal(result.pairs.length, 3);
  assert.ok(result.delta! < -1);
  assert.notEqual(result.delta, 8.695);
  assert.deepEqual(result.deterioratingTickers.sort(), ['CRM','NOW','WDAY']);
});
Deno.test('Disappearing positions is a data incident, not verified liquidation', () => {
  const prior = { equity: 100000, cash: 60000, gross_exposure: 40000 };
  assert.match(accountQuality({ equity: 60000, cash: 60000 }, [], prior)!, /disappeared/);
  assert.equal(accountQuality({ equity: 95000, cash: 60000 }, [{ market_value: 35000 }], prior), null);
  assert.match(accountQuality({ equity: 10000, cash: 5000 }, [])!, /does not reconcile/);
});
Deno.test('schedule uses Eastern time through DST and actual early close', () => {
  for (const [date, time] of [['2026-07-06','13:15'], ['2026-11-09','14:15']]) {
    assert.equal(scheduledTick(new Date(`${date}T${time}:00Z`), { date, open: '09:30', close: '16:00' }), 'premarket');
  }
  assert.equal(scheduledTick(new Date('2026-11-27T18:15:00Z'), { date: '2026-11-27', open: '09:30', close: '13:00' }), 'close');
  assert.equal(scheduledTick(new Date('2026-11-26T14:15:00Z'), null), null);
  assert.equal(inSession(new Date('2026-11-27T18:01:00Z'), { date: '2026-11-27', open: '09:30', close: '13:00' }), false);
  assert.equal(easternDayStart(new Date('2026-07-06T16:00:00Z')), '2026-07-06T04:00:00.000Z');
  assert.equal(easternDayStart(new Date('2026-11-09T16:00:00Z')), '2026-11-09T05:00:00.000Z');
});
Deno.test('dry run and halt return before credentials, broker calls or persistence', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Side effect attempted'); } });
  const input = { digestId: 'test', config: { phase: 'paper', paper_mode: true, halted: false, halt_reason: null }, proposals: [], firedCountThisTick: 2,
    killSwitchTriggered: false, supa: forbidden, dryRun: true } as ExecutionInput;
  const dry = await orchestrateExecution(input); assert.equal(dry.placed, 0);
  const halted = await orchestrateExecution({ ...input, dryRun: false, config: { ...input.config, halted: true, halt_reason: 'test' } });
  assert.equal(halted.placed, 0); assert.match(halted.errors[0], /Halted/);
});

Deno.test('relative baskets reject missing constituents and mismatched end dates', () => {
  const make = (scale: number) => Array.from({length: 21}, (_,i) => ({ asOf: new Date(Date.UTC(2026,9,17+i)).toISOString(), close: (100+i)*scale }));
  const bars = new Map([['CRM',make(1)],['QQQ',make(2)]]);
  assert.ok(alignedReturns(bars, ['CRM','QQQ'], now));
  assert.equal(alignedReturns(bars, ['CRM','QQQ','NOW'], now), null);
  bars.get('QQQ')!.push({ asOf: '2026-11-07', close: 245 });
  assert.equal(alignedReturns(bars, ['CRM','QQQ'], now), null);
});

Deno.test('partial delivery retries only the failed configured channel', () => {
  const enabled = { email: true, slack: true };
  const receipts = [{ delivered_email: true, delivered_slack: false }];
  assert.deepEqual(deliveryChannels(false, enabled, receipts), { email: false, slack: true });
  receipts.push({ delivered_email: false, delivered_slack: true });
  assert.deepEqual(deliveryChannels(false, enabled, receipts), { email: false, slack: false });
  assert.deepEqual(deliveryChannels(true, enabled, receipts), enabled);
  assert.deepEqual(deliveryChannels(false, { email: true, slack: false }, receipts), { email: false, slack: false });
});

Deno.test('credit distance includes widening from the trailing low, not only the 3.5% floor', () => {
  const credit = computeProximity({ jolts: [], claims: [], caseShiller: [], saas: [], hyOas: [{date:'2026-10-01',value:2.6},{date:'2026-11-05',value:3.48}], sp500Fired:false }).find(p => p.key === 'credit')!;
  assert.equal(credit.threshold, 3.6);
  assert.ok(credit.progressPct! < 90);
  assert.match(credit.note, /five sessions/);
});
