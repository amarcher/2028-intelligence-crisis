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
  { ticker: 'MNDY', cik: '0001845338' }, // Monday.com
  { ticker: 'HUBS', cik: '0001404655' }, // HubSpot
  { ticker: 'FRSH', cik: '0001544522' }, // Freshworks
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

function fpToQuarterDate(fy: number, fp: string): string | null {
  const quarterMap: Record<string, string> = {
    Q1: '01',
    Q2: '04',
    Q3: '07',
    Q4: '10',
  };
  const month = quarterMap[fp];
  if (!month) return null;
  return `${fy}-${month}-01`;
}

Deno.serve(async (_req: Request) => {
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

      // Filter to quarterly filings only (10-Q and 10-K for Q4)
      // and deduplicate by (fy, fp) keeping the most recently filed
      const quarterMap = new Map<string, EdgarUnit>();
      for (const u of units) {
        if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(u.fp)) continue;
        // Only include entries with a start date (duration concepts = revenue)
        if (!u.start) continue;
        const key = `${u.fy}-${u.fp}`;
        const existing = quarterMap.get(key);
        if (!existing || u.filed > existing.filed) {
          quarterMap.set(key, u);
        }
      }

      // Build revenue lookup by (fy, fp) for YoY calculation
      const revenueByKey = new Map<string, number>();
      for (const [key, u] of quarterMap) {
        revenueByKey.set(key, u.val);
      }

      // Calculate YoY growth
      const rows: { series_id: string; date: string; value: number; source: string; fetched_at: string }[] = [];

      for (const [key, u] of quarterMap) {
        const priorKey = `${u.fy - 1}-${u.fp}`;
        const priorRevenue = revenueByKey.get(priorKey);

        if (priorRevenue && priorRevenue > 0) {
          const yoyGrowth = ((u.val - priorRevenue) / priorRevenue) * 100;
          const date = fpToQuarterDate(u.fy, u.fp);
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
        errors[ticker] = `Parsed ${quarterMap.size} quarters but no YoY pairs found`;
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
