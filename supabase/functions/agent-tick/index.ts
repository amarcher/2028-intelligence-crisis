// Supabase Edge Function: Agent tick (skeleton)
// Reads economic_data + SaaS series, runs computeSignals(), writes one
// agent_snapshots row + one stub agent_digests row per invocation.
// Deploy: supabase functions deploy agent-tick
// Invoke: supabase functions invoke agent-tick --body '{"tick_type":"close"}'
//
// The Claude reasoner (Task 5) will fill the digest's narrative + proposals;
// for now the digest is a placeholder so the schema + cron + UI wiring can land first.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeSignals } from '../../../src/lib/signals.ts';
import type { DataPoint, SaaSDataPoint } from '../../../src/lib/types.ts';

type TickType = 'premarket' | 'close' | 'weekly';

interface TickRequest {
  tick_type?: TickType;
}

// Series needed by the 5 Phase-Flip signals
const FRED = {
  jolts: 'JTSJOL',
  claims: 'ICSA',
  sp500: 'SP500',
  caseShiller: 'CSUSHPISA',
} as const;

const SAAS_SERIES: Array<{ id: string; field: keyof Omit<SaaSDataPoint, 'date'> }> = [
  { id: 'saas_NOW', field: 'servicenow' },
  { id: 'saas_CRM', field: 'salesforce' },
  { id: 'saas_HUBS', field: 'hubspot' },
  { id: 'saas_FRSH', field: 'freshworks' },
  { id: 'saas_WDAY', field: 'workday' },
  { id: 'saas_DDOG', field: 'datadog' },
];

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Honor the killed flag — if the deadman switch tripped, do nothing.
    const { data: config } = await supabase
      .from('agent_config')
      .select('enabled, mode')
      .eq('id', 1)
      .single();

    if (!config?.enabled) {
      return json({ skipped: true, reason: 'agent_config.enabled = false' });
    }

    const body: TickRequest = await req.json().catch(() => ({}));
    const tickType: TickType = body.tick_type ?? 'close';

    // Load all required series in parallel
    const [jolts, claims, sp500, caseShiller, saasSeries] = await Promise.all([
      loadSeries(supabase, FRED.jolts),
      loadSeries(supabase, FRED.claims),
      loadSeries(supabase, FRED.sp500),
      loadSeries(supabase, FRED.caseShiller),
      Promise.all(SAAS_SERIES.map(({ id }) => loadSeries(supabase, id))),
    ]);

    const saas = mergeSaasSeries(saasSeries);

    const result = computeSignals({ jolts, claims, sp500, caseShiller, saas });

    // Week-over-week drift summary — a one-liner per series. Claude will
    // consume this in Task 5 to color the digest narrative.
    const drift = {
      jolts: weekOverWeek(jolts),
      claims: weekOverWeek(claims),
      sp500: weekOverWeek(sp500),
      caseShiller: weekOverWeek(caseShiller),
      generated_at: new Date().toISOString(),
    };

    const { data: snapshot, error: snapError } = await supabase
      .from('agent_snapshots')
      .insert({
        tick_type: tickType,
        signals: {
          firedCount: result.firedCount,
          phase: result.phase,
          phaseLabel: result.phaseLabel,
          verdict: result.verdict,
          signals: result.signals,
        },
        drift,
      })
      .select('tick_id')
      .single();

    if (snapError) throw new Error(`agent_snapshots insert failed: ${snapError.message}`);

    // Skeleton digest — narrative + proposals are placeholders.
    // Task 5 replaces this branch with a Claude call that populates both.
    const { error: digestError } = await supabase.from('agent_digests').insert({
      tick_id: snapshot.tick_id,
      tick_type: tickType,
      phase: result.phase,
      fired_count: result.firedCount,
      kill_switch_triggered: false,
      narrative: `[skeleton] ${result.phaseLabel} · ${result.firedCount}/5 signals firing. ${result.playbook}`,
      proposals: [],
      drift_notes: null,
      scorecard: tickType === 'weekly' ? scorecardFromSignals(result.signals) : null,
    });

    if (digestError) throw new Error(`agent_digests insert failed: ${digestError.message}`);

    // Success — reset the deadman counter.
    await supabase.from('agent_config').update({ consecutive_failures: 0, updated_at: new Date().toISOString() }).eq('id', 1);

    return json({
      ok: true,
      tick_id: snapshot.tick_id,
      tick_type: tickType,
      phase: result.phase,
      fired_count: result.firedCount,
    });
  } catch (err) {
    console.error('agent-tick failed:', err);

    // Increment the deadman counter; at 3, disable the agent.
    const { data: config } = await supabase
      .from('agent_config')
      .select('consecutive_failures')
      .eq('id', 1)
      .single();
    const next = (config?.consecutive_failures ?? 0) + 1;
    await supabase
      .from('agent_config')
      .update({
        consecutive_failures: next,
        ...(next >= 3 ? { enabled: false, killed_reason: `deadman: ${String(err).slice(0, 200)}` } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    return new Response(JSON.stringify({ error: String(err), consecutive_failures: next }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ——— helpers ———

async function loadSeries(supabase: ReturnType<typeof createClient>, seriesId: string): Promise<DataPoint[]> {
  const { data, error } = await supabase
    .from('economic_data')
    .select('date, value')
    .eq('series_id', seriesId)
    .order('date', { ascending: true });
  if (error) throw new Error(`loadSeries(${seriesId}) failed: ${error.message}`);
  return (data ?? []).map((d) => ({ date: d.date as string, value: d.value as number | null }));
}

function mergeSaasSeries(seriesArrays: DataPoint[][]): SaaSDataPoint[] {
  const byDate = new Map<string, SaaSDataPoint>();
  seriesArrays.forEach((data, i) => {
    const field = SAAS_SERIES[i].field;
    for (const point of data) {
      let row = byDate.get(point.date);
      if (!row) {
        row = {
          date: point.date,
          servicenow: null,
          salesforce: null,
          hubspot: null,
          freshworks: null,
          workday: null,
          datadog: null,
        };
        byDate.set(point.date, row);
      }
      (row[field] as number | null) = point.value;
    }
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function weekOverWeek(data: DataPoint[]): { last: number | null; wow_delta: number | null; wow_pct: number | null } {
  const nonNull = data.filter((d) => d.value != null);
  if (nonNull.length === 0) return { last: null, wow_delta: null, wow_pct: null };
  const last = nonNull[nonNull.length - 1].value!;
  // Step back ~1 week; for monthly series this effectively becomes "prior print"
  const prior = nonNull[nonNull.length - 2]?.value ?? null;
  if (prior == null) return { last, wow_delta: null, wow_pct: null };
  return {
    last,
    wow_delta: last - prior,
    wow_pct: prior !== 0 ? ((last - prior) / prior) * 100 : null,
  };
}

function scorecardFromSignals(signals: ReturnType<typeof computeSignals>['signals']) {
  return Object.fromEntries(
    signals.map((s) => [s.key, s.state === 'fired' ? 'fired' : 'pending']),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
