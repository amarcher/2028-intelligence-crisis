// Neocloud Policy Watch — daily ingestion.
// Pulls daily closes for IREN, the neocloud peer basket and QQQ from Yahoo
// Finance into market_prices, and snapshots Kalshi data center moratorium
// markets into prediction_odds. Every source writes a neocloud_scrape_log row.
//
// Deploy: supabase functions deploy neocloud-pull
// Backfill: POST {"range":"1y"} (default "1mo" for the daily cron).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Keep in sync with TICKERS in src/lib/eventStudy.ts.
const TICKERS = ['IREN', 'CRWV', 'NBIS', 'WULF', 'CIFR', 'QQQ'];
const KALSHI_SERIES = ['KXDCMORATORIUMLAW'];
const ALLOWED_RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y']);

interface PriceRow { ticker: string; trade_date: string; close: number; source: string }
interface OddsRow {
  venue: string;
  market_ticker: string;
  observed_at: string;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  close_time: string | null;
  meta: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  let range = '1mo';
  try {
    const body = await req.json();
    if (typeof body?.range === 'string' && ALLOWED_RANGES.has(body.range)) range = body.range;
  } catch {
    // no body — default range
  }

  const results = [
    await runSource(supabase, 'yahoo', async () => {
      const rows = (await Promise.all(TICKERS.map((t) => fetchYahoo(t, range)))).flat();
      return upsert(supabase, 'market_prices', rows, 'ticker,trade_date');
    }),
    await runSource(supabase, 'kalshi', async () => {
      const rows = (await Promise.all(KALSHI_SERIES.map(fetchKalshi))).flat();
      return upsert(supabase, 'prediction_odds', rows, 'venue,market_ticker,observed_at');
    }),
  ];

  return json({ ran_at: new Date().toISOString(), range, results });
});

async function runSource(
  supabase: SupabaseClient,
  source: string,
  fn: () => Promise<number>,
): Promise<{ source: string; status: string; rows: number; error?: string }> {
  const t0 = Date.now();
  try {
    const rows = await fn();
    await log(supabase, { source, status: 'ok', rows, duration_ms: Date.now() - t0 });
    return { source, status: 'ok', rows };
  } catch (err) {
    const error = (err as Error).message ?? String(err);
    await log(supabase, { source, status: 'fail', rows: 0, duration_ms: Date.now() - t0, error });
    return { source, status: 'fail', rows: 0, error };
  }
}

async function fetchYahoo(ticker: string, range: string): Promise<PriceRow[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`yahoo ${ticker}: no data`);
  const ts: number[] = r.timestamp;
  const closes: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? r.indicators?.quote?.[0]?.close ?? [];
  return ts.flatMap((t, i) => {
    const c = closes[i];
    return c == null
      ? []
      : [{ ticker, trade_date: new Date(t * 1000).toISOString().slice(0, 10), close: c, source: 'yahoo' }];
  });
}

// Kalshi moved prices from integer cents (last_price) to dollar strings
// (last_price_dollars). Read both; store as 0–1 probability.
function prob(m: Record<string, unknown>, key: string): number | null {
  const cents = m[key];
  if (typeof cents === 'number') return cents / 100;
  const dollars = m[`${key}_dollars`];
  if (dollars != null && !Number.isNaN(Number(dollars))) return Number(dollars);
  return null;
}

async function fetchKalshi(series: string): Promise<OddsRow[]> {
  const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}`);
  if (!res.ok) throw new Error(`kalshi ${series}: HTTP ${res.status}`);
  const json = await res.json();
  const observed_at = new Date().toISOString();
  return ((json.markets ?? []) as Record<string, unknown>[]).map((m) => {
    const vol = m.volume ?? m.volume_fp;
    return {
      venue: 'kalshi',
      market_ticker: String(m.ticker),
      observed_at,
      yes_price: prob(m, 'last_price'),
      yes_bid: prob(m, 'yes_bid'),
      yes_ask: prob(m, 'yes_ask'),
      volume: vol == null || Number.isNaN(Number(vol)) ? null : Number(vol),
      close_time: typeof m.close_time === 'string' ? m.close_time : null,
      meta: { series, title: m.title ?? null, status: m.status ?? null },
    };
  });
}

async function upsert(
  supabase: SupabaseClient,
  table: string,
  rows: unknown[],
  onConflict: string,
): Promise<number> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
  return rows.length;
}

async function log(
  supabase: SupabaseClient,
  row: { source: string; status: string; rows: number; duration_ms: number; error?: string },
): Promise<void> {
  const { error } = await supabase
    .from('neocloud_scrape_log')
    .insert({ ...row, error: row.error?.slice(0, 2000) ?? null });
  if (error) console.error('scrape log insert failed:', error.message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
