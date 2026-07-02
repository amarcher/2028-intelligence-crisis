// Supabase Edge Function: Fetch FRED series data and upsert into economic_data table
// Deploy: supabase functions deploy fetch-fred
// Invoke: supabase functions invoke fetch-fred --body '{"series": ["UNRATE", "JTSJOL"]}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

const FRED_SERIES = [
  'UNRATE', 'JTSJOL', 'ICSA', 'PSAVERT', 'M2V', 'UMCSENT',
  'DGS10', 'SP500', 'DRCCLACBS', 'DRSFRMACBS', 'CES5000000001',
  'USINFO', 'PRS85006173', 'PCE',
  'LES1252881600Q', 'W006RC1Q027SBEA',
  'OPHNFB', 'A191RL1Q225SBEA', 'CSUSHPISA',
  'VIXCLS', // CBOE Volatility Index — regime context for the reasoner
];

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

Deno.serve(async (req: Request) => {
  try {
    const fredApiKey = Deno.env.get('FRED_API_KEY');
    if (!fredApiKey) {
      return new Response(JSON.stringify({ error: 'FRED_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Allow specifying specific series via request body, otherwise fetch all
    let seriesToFetch = FRED_SERIES;
    try {
      const body = await req.json();
      if (body?.series?.length) {
        seriesToFetch = body.series;
      }
    } catch {
      // No body or invalid JSON — fetch all series
    }

    // Daily series stay DAILY. They used to be aggregated to weekly Fridays
    // ('wef'), which broke the S&P peak-stall trigger: with sparse weekly
    // prints the print-counting logic fired "no new high for 2 months" three
    // weeks after an all-time high. Daily closes also give the reasoner a
    // real day-over-day drift read instead of a stale Friday snapshot.
    const DAILY_SERIES = new Set(['DGS10', 'SP500', 'VIXCLS']);

    const results: Record<string, number> = {};

    for (const seriesId of seriesToFetch) {
      const url = new URL(FRED_BASE);
      url.searchParams.set('series_id', seriesId);
      url.searchParams.set('api_key', fredApiKey);
      url.searchParams.set('file_type', 'json');
      url.searchParams.set('sort_order', 'desc');

      if (DAILY_SERIES.has(seriesId)) {
        // ~2.5 years of daily prints; desc + limit keeps the payload bounded
        // and upsert makes re-runs idempotent.
        url.searchParams.set('observation_start', '2024-01-01');
        url.searchParams.set('limit', '700');
      } else {
        url.searchParams.set('limit', '120'); // ~10 years of monthly data
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        console.error(`Failed to fetch ${seriesId}: ${response.status}`);
        continue;
      }

      const data: FredResponse = await response.json();
      const rows = data.observations
        .filter((obs) => obs.value !== '.')
        .map((obs) => ({
          series_id: seriesId,
          date: obs.date,
          value: parseFloat(obs.value),
          source: 'fred',
          fetched_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('economic_data')
          .upsert(rows, { onConflict: 'series_id,date' });

        if (error) {
          console.error(`Error upserting ${seriesId}:`, error.message);
        } else {
          results[seriesId] = rows.length;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
