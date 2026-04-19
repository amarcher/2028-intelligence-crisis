// Shipping Pulse — weekly ingestion orchestrator.
// Runs each source handler in isolation, upserts rows into shipping_signals
// on (source, metric, observed_at), and always writes a row to
// shipping_signal_scrape_log so /status and the dashboard footer can report
// freshness even for broken sources.
//
// Deploy: supabase functions deploy shipping-pulse-pull
// Manual invoke (from Supabase SQL editor or curl with service-role token):
//   curl -X POST https://<project>.supabase.co/functions/v1/shipping-pulse-pull \
//        -H "Authorization: Bearer <service-role-key>" -d '{}'

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SkipSourceError, type ShippingSignalRow, type SourceHandler, type SourceStatus } from './types.ts';
import { bdry } from './sources/bdry.ts';
import { freightos } from './sources/freightos.ts';
import { fred } from './sources/fred.ts';

const SOURCES: SourceHandler[] = [freightos, bdry, fred];

interface SourceResult {
  name: string;
  status: SourceStatus;
  rows: number;
  duration_ms: number;
  error?: string;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Supabase env not configured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // Optional filter: POST { "only": ["fbx","fred"] } to run a subset. Useful
  // for Phase 3 backfills without re-hitting every source.
  let only: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.only) && body.only.every((s: unknown) => typeof s === 'string')) {
      only = body.only as string[];
    }
  } catch {
    // no body — run all sources
  }

  const toRun = only ? SOURCES.filter((s) => only!.includes(s.name)) : SOURCES;
  const results: SourceResult[] = [];

  for (const source of toRun) {
    const t0 = Date.now();
    try {
      const rows = await source.fetch();
      const upserted = await upsertSignals(supabase, rows);
      const duration_ms = Date.now() - t0;
      await logScrape(supabase, {
        source: source.name,
        status: 'ok',
        rows: upserted,
        duration_ms,
      });
      results.push({ name: source.name, status: 'ok', rows: upserted, duration_ms });
    } catch (err) {
      const duration_ms = Date.now() - t0;
      const status: SourceStatus = err instanceof SkipSourceError ? 'skipped' : 'fail';
      const error = (err as Error).message ?? String(err);
      await logScrape(supabase, {
        source: source.name,
        status,
        rows: 0,
        duration_ms,
        error,
      });
      results.push({ name: source.name, status, rows: 0, duration_ms, error });
    }
  }

  const summary = {
    ran_at: new Date().toISOString(),
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total_rows: results.reduce((sum, r) => sum + r.rows, 0),
    results,
  };
  return json(summary);
});

async function upsertSignals(
  supabase: SupabaseClient,
  rows: ShippingSignalRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  // Supabase caps payloads; chunk defensively for large FRED backfills.
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('shipping_signals')
      .upsert(slice, { onConflict: 'source,metric,observed_at' });
    if (error) throw new Error(`upsert failed: ${error.message}`);
    total += slice.length;
  }
  return total;
}

async function logScrape(
  supabase: SupabaseClient,
  row: {
    source: string;
    status: SourceStatus;
    rows: number;
    duration_ms: number;
    error?: string;
  },
): Promise<void> {
  const { error } = await supabase.from('shipping_signal_scrape_log').insert({
    source: row.source,
    status: row.status,
    rows: row.rows,
    duration_ms: row.duration_ms,
    error: row.error?.slice(0, 2000) ?? null,
  });
  if (error) console.error('scrape log insert failed:', error.message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
