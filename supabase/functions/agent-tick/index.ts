// Supabase Edge Function: Agent tick
// Reads economic_data + SaaS series, runs computeSignals(), calls the Claude
// reasoner to produce a digest (narrative + proposals), persists to
// agent_snapshots + agent_digests. Falls back to a skeleton digest if the
// reasoner is unavailable so the dashboard never goes blank.
// Deploy: supabase functions deploy agent-tick
// Invoke: curl -X POST <function-url> -d '{"tick_type":"close"}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeSignals } from '../../../src/lib/signals.ts';
import type { DataPoint, SaaSDataPoint } from '../../../src/lib/types.ts';
import {
  runReasoner,
  type DriftSummary,
  type Proposal,
  type RecentDigest,
  type TickType,
  type WowSummary,
} from './reasoner.ts';
import { deliverDigest } from './delivery.ts';
import {
  orchestrateExecution,
  type AgentApprovalRow,
  type AgentOrderRow,
  type ExecutionSupabase,
} from './execute.ts';
import type { PriorOrderSummary } from './guardrails.ts';
import type { AlpacaPosition } from './alpaca.ts';

interface TickRequest {
  tick_type?: TickType;
}

const FRED = {
  jolts: 'JTSJOL',
  claims: 'ICSA',
  sp500: 'SP500',
  caseShiller: 'CSUSHPISA',
  vix: 'VIXCLS',
} as const;

const SAAS_SERIES: Array<{ id: string; field: keyof Omit<SaaSDataPoint, 'date'> }> = [
  { id: 'saas_NOW', field: 'servicenow' },
  { id: 'saas_CRM', field: 'salesforce' },
  { id: 'saas_HUBS', field: 'hubspot' },
  { id: 'saas_FRSH', field: 'freshworks' },
  { id: 'saas_WDAY', field: 'workday' },
  { id: 'saas_DDOG', field: 'datadog' },
];

const MEMORY_DEPTH: Record<TickType, number> = {
  premarket: 3,
  close: 3,
  weekly: 8,
};

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: config } = await supabase
      .from('agent_config')
      .select('enabled, mode, phase, paper_mode, halted, halt_reason')
      .eq('id', 1)
      .single();

    if (!config?.enabled) {
      return json({ skipped: true, reason: 'agent_config.enabled = false' });
    }

    const body: TickRequest = await req.json().catch(() => ({}));
    const tickType: TickType = body.tick_type ?? 'close';

    const [jolts, claims, sp500, caseShiller, vix, saasSeries] = await Promise.all([
      loadSeries(supabase, FRED.jolts),
      loadSeries(supabase, FRED.claims),
      loadSeries(supabase, FRED.sp500),
      loadSeries(supabase, FRED.caseShiller),
      loadSeries(supabase, FRED.vix),
      Promise.all(SAAS_SERIES.map(({ id }) => loadSeries(supabase, id))),
    ]);

    const saas = mergeSaasSeries(saasSeries);
    const result = computeSignals({ jolts, claims, sp500, caseShiller, saas });

    const drift: DriftSummary = {
      jolts: weekOverWeek(jolts),
      claims: weekOverWeek(claims),
      sp500: weekOverWeek(sp500),
      caseShiller: weekOverWeek(caseShiller),
      ...(vix.length > 0 ? { vix: weekOverWeek(vix) } : {}),
    };

    const recentDigests = await loadRecentDigests(supabase, MEMORY_DEPTH[tickType]);

    // Snapshot lands regardless of whether the reasoner succeeds.
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
        drift: { ...drift, generated_at: new Date().toISOString() },
      })
      .select('tick_id')
      .single();

    if (snapError) throw new Error(`agent_snapshots insert failed: ${snapError.message}`);

    // Call the reasoner. On any failure (after internal retry), fall through to
    // a skeleton digest so the UI never goes blank and the deadman fires cleanly.
    let digestRow: Record<string, unknown>;
    try {
      const reasoned = await runReasoner({
        tickType,
        signals: result,
        drift,
        recentDigests,
      });

      digestRow = {
        tick_id: snapshot.tick_id,
        tick_type: tickType,
        phase: result.phase,
        fired_count: result.firedCount,
        kill_switch_triggered: reasoned.kill_switch_triggered,
        narrative: reasoned.narrative,
        proposals: reasoned.proposals,
        drift_notes: reasoned.drift_notes,
        scorecard: tickType === 'weekly' ? reasoned.scorecard : null,
        cost_input_tokens: reasoned.usage.input_tokens,
        cost_output_tokens: reasoned.usage.output_tokens,
        cost_cache_read_tokens: reasoned.usage.cache_read_tokens,
        cost_cache_creation_tokens: reasoned.usage.cache_creation_tokens,
        cost_model: reasoned.model,
        reasoner_status: reasoned.status,
      };
    } catch (reasonerErr) {
      const errMsg = String(reasonerErr);
      console.error('reasoner failed after retry, using skeleton fallback:', errMsg);
      digestRow = {
        tick_id: snapshot.tick_id,
        tick_type: tickType,
        phase: result.phase,
        fired_count: result.firedCount,
        kill_switch_triggered: false,
        // Embed the actual error so it's visible to the dashboard + curl caller.
        // The error string is truncated in the deadman field already; full raw
        // text goes in the narrative for operator diagnosis.
        narrative: `[reasoner failed] ${errMsg.slice(0, 800)}`,
        proposals: [],
        drift_notes: null,
        scorecard: null,
        reasoner_status: 'fallback_unavailable',
      };
      // Bump deadman so 3 consecutive reasoner failures disable the agent.
      await incrementDeadman(supabase, errMsg);
    }

    const { data: insertedDigest, error: digestError } = await supabase
      .from('agent_digests')
      .insert(digestRow)
      .select('id')
      .single();
    if (digestError) throw new Error(`agent_digests insert failed: ${digestError.message}`);

    // Reset the deadman only when the reasoner succeeded (snapshots alone
    // aren't proof the pipeline is healthy).
    if (digestRow.reasoner_status !== 'fallback_unavailable') {
      await supabase
        .from('agent_config')
        .update({ consecutive_failures: 0, updated_at: new Date().toISOString() })
        .eq('id', 1);
    }

    // Deliver. Never throws — sparse failures just land as delivered_* = false
    // on the digest row + a warning log.
    const delivery = await deliverDigest({
      tick_type: tickType,
      phase: result.phase,
      fired_count: result.firedCount,
      kill_switch_triggered: Boolean(digestRow.kill_switch_triggered),
      narrative: String(digestRow.narrative),
      proposals: (digestRow.proposals as Proposal[] | undefined) ?? [],
      drift_notes: (digestRow.drift_notes as string | null) ?? null,
      reasoner_status: String(digestRow.reasoner_status),
    });
    await supabase
      .from('agent_digests')
      .update({
        delivered_email: delivery.delivered_email,
        delivered_slack: delivery.delivered_slack,
      })
      .eq('id', insertedDigest.id);

    // Execute when mode=auto_execute AND phase != shadow.
    const execPhase = (config.phase ?? 'shadow') as 'shadow' | 'paper' | 'small_live' | 'scale';
    const execConfig = {
      halted: Boolean(config.halted),
      halt_reason: (config.halt_reason as string | null) ?? null,
      phase: execPhase,
    };
    let execution = null;
    if (config.mode === 'auto_execute' && execPhase !== 'shadow') {
      const supa = buildExecutionSupa(supabase, insertedDigest.id);
      execution = await orchestrateExecution({
        digestId: insertedDigest.id,
        config: execConfig,
        proposals: (digestRow.proposals as Proposal[] | undefined) ?? [],
        firedCountThisTick: result.firedCount,
        killSwitchTriggered: Boolean(digestRow.kill_switch_triggered),
        supa,
      });
    }

    return json({
      ok: true,
      tick_id: snapshot.tick_id,
      tick_type: tickType,
      phase: result.phase,
      fired_count: result.firedCount,
      reasoner_status: digestRow.reasoner_status,
      execution,
      // Surface the narrative so fallback reason is visible in the response
      // without needing to query the DB. For the real narrative this just
      // returns the first ~400 chars of Claude's output.
      narrative_preview: String(digestRow.narrative).slice(0, 400),
      delivery: {
        email: delivery.delivered_email,
        slack: delivery.delivered_slack,
        errors: delivery.errors,
      },
    });
  } catch (err) {
    console.error('agent-tick failed:', err);
    await incrementDeadman(supabase, String(err));
    return new Response(JSON.stringify({ error: String(err) }), {
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

async function loadRecentDigests(
  supabase: ReturnType<typeof createClient>,
  limit: number,
): Promise<RecentDigest[]> {
  const { data, error } = await supabase
    .from('agent_digests')
    .select('created_at, tick_type, phase, fired_count, narrative, kill_switch_triggered')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`loadRecentDigests failed (non-fatal): ${error.message}`);
    return [];
  }
  return (data ?? []) as RecentDigest[];
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

function weekOverWeek(data: DataPoint[]): WowSummary {
  const nonNull = data.filter((d) => d.value != null);
  if (nonNull.length === 0) return { last: null, wow_delta: null, wow_pct: null };
  const last = nonNull[nonNull.length - 1].value!;
  const prior = nonNull[nonNull.length - 2]?.value ?? null;
  if (prior == null) return { last, wow_delta: null, wow_pct: null };
  return {
    last,
    wow_delta: last - prior,
    wow_pct: prior !== 0 ? ((last - prior) / prior) * 100 : null,
  };
}

async function incrementDeadman(
  supabase: ReturnType<typeof createClient>,
  reason: string,
): Promise<void> {
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
      ...(next >= 3 ? { enabled: false, killed_reason: `deadman: ${reason.slice(0, 200)}` } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ——— execution adapter ———
// Bridges the generic ExecutionSupabase interface in execute.ts to concrete
// supabase-js calls, scoped to a single digest's execution run.
function buildExecutionSupa(
  supabase: ReturnType<typeof createClient>,
  _digestId: string,
): ExecutionSupabase {
  return {
    async insertOrder(row: AgentOrderRow) {
      const { data, error } = await supabase
        .from('agent_orders')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        console.warn(`agent_orders insert failed: ${error.message}`);
        return null;
      }
      return { id: (data as { id: string }).id };
    },
    async insertApproval(row: AgentApprovalRow) {
      const { data, error } = await supabase
        .from('agent_approvals')
        .insert(row)
        .select('id')
        .single();
      if (error) {
        console.warn(`agent_approvals insert failed: ${error.message}`);
        return null;
      }
      return { id: (data as { id: string }).id };
    },
    async todayOrders(): Promise<PriorOrderSummary[]> {
      // "Today" in ET — agent-tick runs on US market hours.
      const etToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const { data, error } = await supabase
        .from('agent_orders')
        .select('notional_usd, instrument, status, created_at')
        .gte('created_at', `${etToday}T00:00:00-05:00`);
      if (error) {
        console.warn(`todayOrders query failed: ${error.message}`);
        return [];
      }
      return (data ?? []) as PriorOrderSummary[];
    },
    async replacePositionsCache(positions: AlpacaPosition[]) {
      // Wipe + reinsert so the cache reflects Alpaca truth at tick time.
      await supabase.from('agent_positions_cache').delete().neq('ticker', '');
      if (positions.length === 0) return;
      const rows = positions.map((p) => ({
        ticker: p.asset_class === 'us_option' ? inferUnderlying(p.symbol) : p.symbol,
        // Empty string for equities so the composite PK (ticker, option_symbol) is stable.
        option_symbol: p.asset_class === 'us_option' ? p.symbol : '',
        qty: p.qty,
        avg_entry: p.avg_entry_price,
        market_value: p.market_value,
        unrealized_pl: p.unrealized_pl,
        synced_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('agent_positions_cache').insert(rows);
      if (error) console.warn(`positions cache insert failed: ${error.message}`);
    },
    async priorDigests(limit: number) {
      const { data, error } = await supabase
        .from('agent_digests')
        .select('fired_count')
        .order('created_at', { ascending: false })
        .limit(limit + 1); // include current? excluding handled by caller
      if (error) return [];
      // First row is the current tick's digest; skip it.
      return (data ?? []).slice(1) as Array<{ fired_count: number }>;
    },
  };
}

/** OCC symbol underlyings — 1-6 uppercase letters prefix. Fallback: whole symbol. */
function inferUnderlying(occ: string): string {
  const m = occ.match(/^([A-Z]{1,6})[0-9]{6}/);
  return m ? m[1] : occ;
}
