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
  type ActiveSleeveSummary,
  type AccountSummary,
  type DriftSummary,
  type OptionChainSnapshot,
  type PositionSummary,
  type Proposal,
  type RecentDigest,
  type ShippingPulseSummary,
  type ShippingReading,
  type TapeReading,
  type TickType,
  type WowSummary,
} from './reasoner.ts';
import {
  alpacaFromEnv,
  getAccount,
  getDailyBars,
  getLatestTrades,
  getOptionsChain,
  getPositions,
  type AlpacaAccount,
  type AlpacaCredentials,
  type DailyBar,
} from './alpaca.ts';
import { WHITELIST } from './filter.ts';

// SaaS short underliers we pre-fetch a Jan 2027 put chain for on each tick so
// the reasoner picks strikes from real listings instead of guessing. Must be
// a subset of WHITELIST; keep small — one chain call per ticker per tick.
const LEAPS_UNIVERSE: ReadonlyArray<{ ticker: string; expiry: string; expiryIso: [string, string]; type: 'put' | 'call' }> = [
  { ticker: 'NOW',  expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
  { ticker: 'CRM',  expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
  { ticker: 'HUBS', expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
  { ticker: 'WDAY', expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
  { ticker: 'DDOG', expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
  { ticker: 'FRSH', expiry: 'Jan 2027', expiryIso: ['2027-01-01', '2027-01-31'], type: 'put' },
];

async function loadOptionChainSnapshots(
  creds: AlpacaCredentials,
  tapeByTicker: Map<string, number>,
): Promise<OptionChainSnapshot[]> {
  const snapshots = await Promise.all(
    LEAPS_UNIVERSE.map(async (cfg): Promise<OptionChainSnapshot | null> => {
      try {
        const spot = tapeByTicker.get(cfg.ticker);
        const chain = await getOptionsChain(creds, cfg.ticker, {
          type: cfg.type,
          expiration_date_gte: cfg.expiryIso[0],
          expiration_date_lte: cfg.expiryIso[1],
          // Filter to the reasonably-tradable strike window when we have spot,
          // otherwise return the default page.
          strike_price_gte: spot != null ? spot * 0.4 : undefined,
          strike_price_lte: spot != null ? spot * 1.1 : undefined,
          limit: 100,
        });
        if (chain.length === 0) {
          return { ticker: cfg.ticker, expiry: cfg.expiry, type: cfg.type, strikes: [] };
        }
        const strikes = [...new Set(chain.map((c) => c.strike_price))].sort((a, b) => a - b);
        return { ticker: cfg.ticker, expiry: cfg.expiry, type: cfg.type, strikes };
      } catch (e) {
        console.warn(`chain fetch ${cfg.ticker} failed (non-fatal):`, String(e).slice(0, 200));
        return null;
      }
    }),
  );
  return snapshots.filter((s): s is OptionChainSnapshot => s !== null);
}
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

const SAAS_TICKERS = ['NOW', 'CRM', 'HUBS', 'WDAY', 'DDOG', 'FRSH'] as const;
const AI_WINNER_TICKERS = ['QQQ', 'SMH', 'IGV', 'NVDA', 'AVGO', 'MSFT', 'GOOGL', 'META'] as const;
const CREDIT_STRESS_TICKERS = ['HYG', 'KRE', 'IYR'] as const;
const DEFENSIVE_TICKERS = new Set(['TLT', 'GLD', 'IAU', 'XLP', 'KO', 'PG', 'COST', 'WMT']);
const ACTIVE_BAR_UNIVERSE = [
  ...SAAS_TICKERS,
  ...AI_WINNER_TICKERS,
  ...CREDIT_STRESS_TICKERS,
] as const;

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
    const shippingPulse = await loadShippingPulse(supabase);

    // In auto_execute + non-shadow phase, load Alpaca account state so the
    // reasoner can reason about the actual book (not hallucinate from prior
    // narratives). Best-effort — if creds are missing or Alpaca 5xxs, we
    // fall through to signal-only reasoning without failing the tick.
    let accountSummary: AccountSummary | undefined;
    let positionSummaries: PositionSummary[] | undefined;
    let tapeQuotes: TapeReading[] | undefined;
    let optionChains: OptionChainSnapshot[] | undefined;
    let activeSleeve: ActiveSleeveSummary | undefined;
    if (config.mode === 'auto_execute' && config.phase !== 'shadow') {
      try {
        const paperMode = config.paper_mode !== false;
        const creds = alpacaFromEnv(paperMode);
        const [acct, pos, tape] = await Promise.all([
          getAccount(creds),
          getPositions(creds),
          // Latest-trade snapshot so the reasoner can anchor option strikes
          // to real spot. Fails soft: if the data feed 5xxs, quotes stay
          // undefined and the reasoner uses the fallback instruction.
          getLatestTrades(creds, WHITELIST).catch((e) => {
            console.warn('getLatestTrades failed (non-fatal):', String(e).slice(0, 200));
            return [] as TapeReading[];
          }),
        ]);
        accountSummary = {
          equity: acct.equity,
          cash: acct.cash,
          buying_power: acct.buying_power,
        };
        positionSummaries = pos.map((p) => ({
          ticker: p.asset_class === 'us_option' ? (p.symbol.match(/^([A-Z]{1,6})/)?.[1] ?? p.symbol) : p.symbol,
          instrument: p.asset_class === 'us_option' ? 'option' : 'equity',
          option_symbol: p.asset_class === 'us_option' ? p.symbol : undefined,
          qty: p.qty,
          avg_entry: p.avg_entry_price,
          market_value: p.market_value,
          unrealized_pl: p.unrealized_pl,
        }));
        tapeQuotes = tape;
        // Now that we have tape, fetch listed strikes for the SaaS LEAPS
        // universe so the reasoner picks strikes that actually exist.
        // Ordered after the parallel batch because the chain window uses spot.
        const tapeByTicker = new Map(tape.map((t) => [t.ticker, t.price] as const));
        const barsSince = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const [chains, bars] = await Promise.all([
          loadOptionChainSnapshots(creds, tapeByTicker),
          getDailyBars(creds, ACTIVE_BAR_UNIVERSE, barsSince).catch((e) => {
            console.warn('getDailyBars failed (non-fatal):', String(e).slice(0, 200));
            return new Map();
          }),
        ]);
        optionChains = chains;
        activeSleeve = buildActiveSleeveSummary({
          account: acct,
          saas,
          positions: pos,
          bars,
          drift,
        });
      } catch (e) {
        console.warn('Alpaca state load failed (non-fatal):', String(e).slice(0, 200));
      }
    }

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
        drift: {
          ...drift,
          generated_at: new Date().toISOString(),
          ...(activeSleeve ? { active_sleeve: activeSleeve } : {}),
        },
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
        account: accountSummary,
        positions: positionSummaries,
        shippingPulse,
        tapeQuotes,
        optionChains,
        activeSleeve,
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
      active_sleeve: activeSleeve ?? null,
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
      paper_mode: config.paper_mode !== false,
    };
    let execution = null;
    if (config.mode === 'auto_execute' && execPhase !== 'shadow') {
      const supa = buildExecutionSupa(supabase);
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

// Headline shipping metrics the reasoner should see. Kept compact (~6) to
// avoid prompt bloat. Add to this list only when a new source earns a seat;
// agents reason better with focused inputs than with an exhaustive dump.
const SHIPPING_HEADLINES: Array<{ source: string; metric: string; label: string }> = [
  { source: 'fbx',  metric: 'global',                        label: 'FBX global composite' },
  { source: 'fbx',  metric: 'china_ea_to_na_west',           label: 'FBX China → NA West'   },
  { source: 'fbx',  metric: 'china_ea_to_n_europe',          label: 'FBX China → N.Europe'  },
  { source: 'bdry', metric: 'close',                         label: 'BDRY (BDI proxy)'      },
  { source: 'fred', metric: 'retail_inventory_sales_ratio',  label: 'Retail I/S ratio'      },
  { source: 'fred', metric: 'real_imports_index',            label: 'Real imports index'    },
];

async function loadShippingPulse(
  supabase: ReturnType<typeof createClient>,
): Promise<ShippingPulseSummary | undefined> {
  try {
    const [wowRes, statusRes] = await Promise.all([
      supabase
        .from('shipping_signals_wow')
        .select('source, metric, observed_at, value, unit, prev_value, wow_pct')
        .order('observed_at', { ascending: false })
        .limit(2000),
      supabase
        .from('shipping_signal_source_status')
        .select('source, fresh'),
    ]);
    if (wowRes.error) throw new Error(wowRes.error.message);
    if (statusRes.error) throw new Error(statusRes.error.message);

    const staleBySource = new Map<string, boolean>();
    for (const r of statusRes.data ?? []) {
      staleBySource.set(String(r.source), !r.fresh);
    }

    // Pick the latest WoW row per (source, metric).
    const seen = new Set<string>();
    const latestByKey = new Map<string, {
      source: string;
      metric: string;
      observed_at: string;
      value: number;
      unit: string;
      wow_pct: number | null;
    }>();
    for (const r of wowRes.data ?? []) {
      const key = `${r.source}::${r.metric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latestByKey.set(key, {
        source: String(r.source),
        metric: String(r.metric),
        observed_at: String(r.observed_at),
        value: Number(r.value),
        unit: String(r.unit),
        wow_pct: r.wow_pct == null ? null : Number(r.wow_pct),
      });
    }

    const readings: ShippingReading[] = [];
    for (const h of SHIPPING_HEADLINES) {
      const row = latestByKey.get(`${h.source}::${h.metric}`);
      if (!row) continue;
      readings.push({
        label: h.label,
        value: row.value,
        unit: row.unit,
        wow_pct: row.wow_pct,
        observed_at: row.observed_at,
        stale: staleBySource.get(row.source) === true,
      });
    }

    if (readings.length === 0) {
      return { readings: [], healthy: false };
    }
    const staleCount = readings.filter((r) => r.stale).length;
    const healthy = staleCount / readings.length < 0.5;
    return { readings, healthy };
  } catch (err) {
    // Pipeline not deployed yet, or tables missing — fail open so the reasoner
    // falls back to the pre-Shipping Pulse prompt shape.
    console.warn('loadShippingPulse failed (non-fatal):', String(err).slice(0, 200));
    return undefined;
  }
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

const SAAS_FIELD_BY_TICKER: Record<(typeof SAAS_TICKERS)[number], keyof Omit<SaaSDataPoint, 'date'>> = {
  NOW: 'servicenow',
  CRM: 'salesforce',
  HUBS: 'hubspot',
  WDAY: 'workday',
  DDOG: 'datadog',
  FRSH: 'freshworks',
};

function returnOverBars(bars: DailyBar[] | undefined, lookback: number): number | null {
  if (!bars || bars.length < lookback + 1) return null;
  const last = bars[bars.length - 1]?.close;
  const prior = bars[bars.length - 1 - lookback]?.close;
  if (!last || !prior) return null;
  return ((last - prior) / prior) * 100;
}

function avgNonNull(vals: Array<number | null>): number | null {
  const clean = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function latestSaasRow(saas: SaaSDataPoint[]): SaaSDataPoint | null {
  for (let i = saas.length - 1; i >= 0; i--) {
    const row = saas[i];
    if (SAAS_TICKERS.some((t) => row[SAAS_FIELD_BY_TICKER[t]] != null)) return row;
  }
  return null;
}

function priorSaasRow(saas: SaaSDataPoint[], latestDate: string): SaaSDataPoint | null {
  for (let i = saas.length - 1; i >= 0; i--) {
    const row = saas[i];
    if (row.date >= latestDate) continue;
    if (SAAS_TICKERS.some((t) => row[SAAS_FIELD_BY_TICKER[t]] != null)) return row;
  }
  return null;
}

function buildActiveSleeveSummary(input: {
  account: AlpacaAccount;
  saas: SaaSDataPoint[];
  positions: AlpacaPosition[];
  bars: Map<string, DailyBar[]>;
  drift: DriftSummary;
}): ActiveSleeveSummary {
  const latest = latestSaasRow(input.saas);
  const prior = latest ? priorSaasRow(input.saas, latest.date) : null;
  const latestAvg = latest
    ? avgNonNull(SAAS_TICKERS.map((t) => latest[SAAS_FIELD_BY_TICKER[t]]))
    : null;
  const priorAvg = prior
    ? avgNonNull(SAAS_TICKERS.map((t) => prior[SAAS_FIELD_BY_TICKER[t]]))
    : null;
  const revenueDelta = latestAvg != null && priorAvg != null ? latestAvg - priorAvg : null;
  const deterioratingTickers = latest && prior
    ? SAAS_TICKERS.filter((t) => {
      const field = SAAS_FIELD_BY_TICKER[t];
      const now = latest[field];
      const before = prior[field];
      return now != null && before != null && now < before - 1;
    })
    : [];

  const saas20d = avgNonNull(SAAS_TICKERS.map((t) => returnOverBars(input.bars.get(t), 20)));
  const ai20d = avgNonNull(AI_WINNER_TICKERS.map((t) => returnOverBars(input.bars.get(t), 20)));
  const creditStress20d = avgNonNull(CREDIT_STRESS_TICKERS.map((t) => returnOverBars(input.bars.get(t), 20)));
  const saasVsAi20d = saas20d != null && ai20d != null ? saas20d - ai20d : null;

  const sleeveTotals = input.positions.reduce(
    (acc, p) => {
      const symbol = p.asset_class === 'us_option'
        ? (p.symbol.match(/^([A-Z]{1,6})/)?.[1] ?? p.symbol)
        : p.symbol;
      const mv = Math.abs(p.market_value);
      if (p.asset_class === 'us_option' && SAAS_TICKERS.includes(symbol as (typeof SAAS_TICKERS)[number])) {
        acc.saasPutValue += mv;
        acc.saasPutProfitLoss += p.unrealized_pl;
      } else if (AI_WINNER_TICKERS.includes(symbol as (typeof AI_WINNER_TICKERS)[number])) {
        acc.aiLongValue += mv;
      } else if (DEFENSIVE_TICKERS.has(symbol)) {
        acc.defensiveValue += mv;
      }
      return acc;
    },
    { saasPutValue: 0, saasPutProfitLoss: 0, aiLongValue: 0, defensiveValue: 0 },
  );
  const addCapacityValue =
    sleeveTotals.aiLongValue + sleeveTotals.defensiveValue - sleeveTotals.saasPutValue;
  const currentSleeve = {
    ...sleeveTotals,
    addAllowed: addCapacityValue > 0,
    addCapacityValue,
  };
  const grossExposureValue = input.positions.reduce((sum, p) => sum + Math.abs(p.market_value), 0);
  const activeSleeveUsedValue = sleeveTotals.saasPutValue;
  const activeSleeveBudgetPct = 20;
  const activeSleeveBudgetValue = input.account.equity * (activeSleeveBudgetPct / 100);
  const activeSleeveRoomValue = activeSleeveBudgetValue - activeSleeveUsedValue;
  const activeSleeveUsedPct = activeSleeveBudgetValue > 0
    ? (activeSleeveUsedValue / activeSleeveBudgetValue) * 100
    : 0;
  const grossExposurePct = input.account.equity > 0
    ? (grossExposureValue / input.account.equity) * 100
    : 0;
  const posture: NonNullable<ActiveSleeveSummary['riskBudget']>['posture'] =
    activeSleeveRoomValue < 0
      ? 'over_budget'
      : activeSleeveUsedPct >= 80
        ? 'near_limit'
        : 'room_to_press';
  const dayProfitLoss = input.account.equity - input.account.last_equity;
  const dayProfitLossPct = input.account.last_equity > 0
    ? (dayProfitLoss / input.account.last_equity) * 100
    : 0;

  let score = 0;
  const reasons: string[] = [];
  if (saasVsAi20d != null) {
    if (saasVsAi20d <= -5) {
      score += 40;
      reasons.push(`SaaS stocks are trailing AI/knowledge-work winners by ${Math.abs(saasVsAi20d).toFixed(1)} points over 20 trading days.`);
    } else if (saasVsAi20d <= -2) {
      score += 15;
      reasons.push(`SaaS is starting to lag AI winners by ${Math.abs(saasVsAi20d).toFixed(1)} points over 20 trading days.`);
    }
  }
  if (saas20d != null && saas20d <= -5) {
    score += 20;
    reasons.push(`The SaaS basket itself is down ${Math.abs(saas20d).toFixed(1)}% over 20 trading days.`);
  }
  if (revenueDelta != null && revenueDelta <= -1) {
    score += deterioratingTickers.length >= 3 ? 20 : 10;
    reasons.push(`Average SaaS revenue growth slowed by ${Math.abs(revenueDelta).toFixed(1)} points quarter over quarter.`);
  }
  if (creditStress20d != null && creditStress20d <= -3) {
    score += 15;
    reasons.push(`Credit and bank/real-estate proxies are down ${Math.abs(creditStress20d).toFixed(1)}% over 20 trading days.`);
  }
  if (input.drift.vix?.wow_pct != null && input.drift.vix.wow_pct >= 10) {
    score += 10;
    reasons.push(`VIX rose ${input.drift.vix.wow_pct.toFixed(1)}% week over week, so market stress is picking up.`);
  }
  if (ai20d != null && ai20d > 0 && saasVsAi20d != null && saasVsAi20d < -2) {
    score += 10;
    reasons.push('AI/knowledge-work winners are still positive while SaaS lags, matching the modified prediction.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const stance: ActiveSleeveSummary['stance'] =
    score >= 70 ? 'press' : score >= 50 ? 'probe' : score >= 25 ? 'watch' : 'inactive';

  return {
    score,
    stance,
    reasons,
    performance: {
      equity: input.account.equity,
      cash: input.account.cash,
      dayProfitLoss,
      dayProfitLossPct,
    },
    riskBudget: {
      activeSleeveBudgetPct,
      activeSleeveBudgetValue,
      activeSleeveUsedValue,
      activeSleeveRoomValue,
      activeSleeveUsedPct,
      grossExposureValue,
      grossExposurePct,
      posture,
    },
    saasRevenueTrend: {
      latestAvg,
      priorAvg,
      delta: revenueDelta,
      deterioratingTickers,
    },
    momentum: {
      saas20d,
      ai20d,
      saasVsAi20d,
      creditStress20d,
    },
    currentSleeve,
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
