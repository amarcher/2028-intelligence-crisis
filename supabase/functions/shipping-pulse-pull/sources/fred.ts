// FRED — macro series that behave as physical-economy corroborators for the
// shipping signals. We duplicate ingestion (also lands in economic_data via
// fetch-fred) to keep shipping_signals self-contained for the agent API —
// "give me everything for this window" shouldn't need a table join.

import type { ShippingSignalRow, SourceHandler, SourceStatus } from '../types.ts';
import { SkipSourceError } from '../types.ts';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// series_id → (metric, unit). RETAILIRSA is the anchor: retail inventories /
// sales ratio. Rising = stockpiling = demand softening — a classic
// corroborator for falling container rates.
const FRED_SERIES: Array<{ id: string; metric: string; unit: string }> = [
  { id: 'RETAILIRSA', metric: 'retail_inventory_sales_ratio', unit: 'ratio' },
  { id: 'IR',         metric: 'real_imports_index',           unit: 'index' },
  { id: 'IMPGS',      metric: 'imports_goods_services_bn',    unit: 'usd_bn' },
];

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

export const fred: SourceHandler = {
  name: 'fred',
  cadence: 'weekly',
  async fetch(): Promise<ShippingSignalRow[]> {
    const apiKey = Deno.env.get('FRED_API_KEY');
    if (!apiKey) {
      throw new SkipSourceError('FRED_API_KEY not configured');
    }

    const rows: ShippingSignalRow[] = [];
    const failures: string[] = [];

    for (const { id, metric, unit } of FRED_SERIES) {
      try {
        const url = new URL(FRED_BASE);
        url.searchParams.set('series_id', id);
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('file_type', 'json');
        url.searchParams.set('sort_order', 'desc');
        url.searchParams.set('limit', '120'); // ~10y monthly

        const res = await fetch(url.toString());
        if (!res.ok) {
          failures.push(`${id}:${res.status}`);
          continue;
        }
        const body = (await res.json()) as FredResponse;
        for (const obs of body.observations) {
          if (obs.value === '.' || obs.value === '') continue;
          const v = parseFloat(obs.value);
          if (!Number.isFinite(v)) continue;
          rows.push({
            source: 'fred',
            metric,
            observed_at: new Date(`${obs.date}T00:00:00Z`).toISOString(),
            value: v,
            unit,
            meta: { series_id: id },
          });
        }
      } catch (err) {
        failures.push(`${id}:${(err as Error).message}`);
      }
    }

    // Partial success is still success — log which series missed for audit.
    if (rows.length === 0) {
      throw new Error(`fred: all series failed (${failures.join(', ') || 'unknown'})`);
    }
    return rows;
  },
};

// Re-export for orchestrator type surface
export type { SourceStatus };
