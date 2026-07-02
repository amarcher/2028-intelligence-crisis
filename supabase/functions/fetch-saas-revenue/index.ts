// Supabase Edge Function: Fetch SaaS quarterly revenue from SEC EDGAR and compute YoY growth
// Deploy: supabase functions deploy fetch-saas-revenue
// No API key needed — SEC EDGAR XBRL API is free

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EDGAR_BASE = 'https://data.sec.gov/api/xbrl/companyconcept';
const USER_AGENT = 'CrisisTracker admin@example.com';

// Revenue XBRL tags to try (in order of preference)
const REVENUE_TAGS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'Revenue',
];

const COMPANIES: { ticker: string; cik: string }[] = [
  { ticker: 'NOW', cik: '0001373715' },  // ServiceNow
  { ticker: 'CRM', cik: '0001108524' },  // Salesforce
  { ticker: 'HUBS', cik: '0001404655' }, // HubSpot
  { ticker: 'FRSH', cik: '0001544522' }, // Freshworks
  { ticker: 'WDAY', cik: '0001327811' }, // Workday
  { ticker: 'DDOG', cik: '0001561550' }, // Datadog
];

interface EdgarUnit {
  start?: string;
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
}

interface EdgarConceptResponse {
  units?: {
    USD?: EdgarUnit[];
  };
}

/** Calendar-true date for a quarter: first day of the month the quarter
 *  ENDED in, from the XBRL `end` field. The previous approach mapped fiscal
 *  (fy, fp) straight to a calendar date, which mislabeled every company with
 *  an offset fiscal year — Salesforce's FY2027 Q1 (calendar Feb–Apr 2026)
 *  landed as a future-dated "2027-01-01" row. */
function quarterEndDate(u: EdgarUnit): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u.end)) return null;
  return `${u.end.slice(0, 7)}-01`;
}

/** True quarterly durations only — EDGAR also returns YTD (6/9-month) and
 *  annual durations under the same tags. */
function isQuarterDuration(u: EdgarUnit): boolean {
  if (!u.start) return false;
  const days = (Date.parse(u.end) - Date.parse(u.start)) / 86_400_000;
  return days >= 80 && days <= 100;
}

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results: Record<string, number> = {};
    const errors: Record<string, string> = {};
    const now = new Date().toISOString();

    for (const { ticker, cik } of COMPANIES) {
      let units: EdgarUnit[] | undefined;

      // Try each revenue tag until one works
      for (const tag of REVENUE_TAGS) {
        const url = `${EDGAR_BASE}/CIK${cik}/us-gaap/${tag}.json`;
        const response = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });

        if (response.ok) {
          const data: EdgarConceptResponse = await response.json();
          units = data.units?.USD;
          if (units && units.length > 0) break;
        }
      }

      if (!units || units.length === 0) {
        errors[ticker] = 'No revenue data found in EDGAR';
        continue;
      }

      // Keep true ~3-month durations only, deduplicated by the calendar month
      // the quarter ended in (most recently filed wins). Keying by calendar
      // end month — not (fy, fp) — makes YoY comparison correct for offset
      // fiscal years, and fixes a bug where the YoY lookup referenced an
      // out-of-scope variable and threw on every run (which is why WDAY/DDOG
      // had no data at all and NOW was months stale).
      const byEndMonth = new Map<string, EdgarUnit>();
      for (const u of units) {
        if (!isQuarterDuration(u)) continue;
        const endMonth = u.end.slice(0, 7); // 'YYYY-MM'
        const existing = byEndMonth.get(endMonth);
        if (!existing || u.filed > existing.filed) {
          byEndMonth.set(endMonth, u);
        }
      }

      // Calculate YoY growth: same end month, one year earlier.
      const rows: { series_id: string; date: string; value: number; source: string; fetched_at: string }[] = [];

      for (const [endMonth, u] of byEndMonth) {
        const [y, m] = endMonth.split('-');
        const priorMonth = `${Number(y) - 1}-${m}`;
        const prior = byEndMonth.get(priorMonth);

        if (prior && prior.val > 0) {
          const yoyGrowth = ((u.val - prior.val) / prior.val) * 100;
          const date = quarterEndDate(u);
          if (!date) continue;

          rows.push({
            series_id: `saas_${ticker}`,
            date,
            value: Math.round(yoyGrowth * 100) / 100,
            source: 'sec_edgar',
            fetched_at: now,
          });
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('economic_data')
          .upsert(rows, { onConflict: 'series_id,date' });

        if (error) {
          errors[ticker] = `Upsert failed: ${error.message}`;
        } else {
          results[ticker] = rows.length;
        }
      } else {
        errors[ticker] = `Parsed ${byEndMonth.size} quarters but no YoY pairs found`;
      }

      // Estimated next earnings date: quarterly filers land ~91 days after
      // the previous filing. Feeds earnings_calendar so the reasoner knows a
      // print is coming; a confirmed/manual row is never overwritten.
      const latestFiled = [...byEndMonth.values()]
        .map((u) => u.filed)
        .sort()
        .pop();
      if (latestFiled) {
        const estimate = new Date(Date.parse(latestFiled) + 91 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (estimate > now.slice(0, 10)) {
          const { data: existing } = await supabase
            .from('earnings_calendar')
            .select('confirmed, source')
            .eq('ticker', ticker)
            .maybeSingle();
          if (!existing || (!existing.confirmed && existing.source === 'edgar_estimate')) {
            const { error: calErr } = await supabase.from('earnings_calendar').upsert(
              {
                ticker,
                report_date: estimate,
                source: 'edgar_estimate',
                confirmed: false,
                updated_at: now,
              },
              { onConflict: 'ticker' },
            );
            if (calErr) errors[`${ticker}_earnings`] = calErr.message;
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results, errors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
