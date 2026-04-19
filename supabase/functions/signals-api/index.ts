// Shipping Pulse — agent + UI facing API.
// Single function, path-routed, versioned under /v1 so the Alpaca agent
// pins to a stable contract. The DB is implementation; the API is the
// contract.
//
// Routes (suffix after /signals-api/):
//   GET v1/snapshot                 — latest per (source, metric) + WoW
//   GET v1/history?source=&metric=&from=&to=&limit=
//   GET v1/status                   — per-source freshness
//
// Auth: agent must send `x-signals-token: $SIGNALS_API_TOKEN`. The UI reads
// the same tables via anon key + RLS and doesn't hit this function, so we
// can be strict about the header without breaking the dashboard.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expectedToken = Deno.env.get('SIGNALS_API_TOKEN');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Supabase env not configured' }, 500);
  }
  if (!expectedToken) {
    return json({ error: 'SIGNALS_API_TOKEN not configured' }, 500);
  }
  const token = req.headers.get('x-signals-token');
  if (token !== expectedToken) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  // Supabase routes /functions/v1/signals-api/<path> → req.url pathname
  // ends with .../signals-api/<path>. Strip everything up to signals-api/.
  const match = url.pathname.match(/signals-api\/?(.*)$/);
  const subpath = (match?.[1] ?? '').replace(/^\/+|\/+$/g, '');

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    if (subpath === 'v1/snapshot') return await snapshot(supabase);
    if (subpath === 'v1/history') return await history(supabase, url.searchParams);
    if (subpath === 'v1/status') return await status(supabase);
    return json(
      { error: 'unknown route', known: ['v1/snapshot', 'v1/history', 'v1/status'] },
      404,
    );
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
  }
});

async function snapshot(supabase: SupabaseClient): Promise<Response> {
  // WoW view carries current + prev; pick last row per (source, metric).
  const { data, error } = await supabase
    .from('shipping_signals_wow')
    .select('source, metric, observed_at, value, unit, prev_value, wow_pct')
    .order('observed_at', { ascending: false });
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const signals: Array<Record<string, unknown>> = [];
  for (const row of data ?? []) {
    const key = `${row.source}::${row.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(row);
  }
  return json({ generated_at: new Date().toISOString(), signals });
}

async function history(
  supabase: SupabaseClient,
  params: URLSearchParams,
): Promise<Response> {
  const source = params.get('source');
  const metric = params.get('metric');
  if (!source || !metric) {
    return json({ error: 'source and metric are required' }, 400);
  }
  const from = params.get('from');
  const to = params.get('to');
  const limit = Math.min(Number(params.get('limit') ?? 500), 5000);

  let q = supabase
    .from('shipping_signals')
    .select('observed_at, value, unit, meta')
    .eq('source', source)
    .eq('metric', metric)
    .order('observed_at', { ascending: true })
    .limit(limit);
  if (from) q = q.gte('observed_at', from);
  if (to) q = q.lte('observed_at', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return json({ source, metric, count: data?.length ?? 0, rows: data ?? [] });
}

async function status(supabase: SupabaseClient): Promise<Response> {
  const { data, error } = await supabase
    .from('shipping_signal_source_status')
    .select('source, last_ok_at, last_run_at, consecutive_failures, fresh')
    .order('source', { ascending: true });
  if (error) throw new Error(error.message);
  return json({
    generated_at: new Date().toISOString(),
    sources: data ?? [],
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
