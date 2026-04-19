// BDRY ETF via Yahoo Finance — public daily proxy for the Baltic Dry Index.
// The real BDI requires a paid Baltic Exchange feed; BDRY tracks near-dated
// BDI futures and is close enough for a weekly pulse read.
//
// Endpoint: https://query1.finance.yahoo.com/v8/finance/chart/BDRY
// Returns OHLCV in a { chart: { result: [{ timestamp[], indicators.quote[0].close[] }] } } shape.

import type { ShippingSignalRow, SourceHandler } from '../types.ts';

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{ close: (number | null)[] }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/BDRY?interval=1d&range=2y';

export const bdry: SourceHandler = {
  name: 'bdry',
  cadence: 'weekly',
  async fetch(): Promise<ShippingSignalRow[]> {
    const res = await fetch(URL, {
      headers: {
        // Yahoo returns 401 to the default fetch user-agent; any UA works.
        'User-Agent': 'Mozilla/5.0 (shipping-pulse/1.0)',
      },
    });
    if (!res.ok) {
      throw new Error(`yahoo chart ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json()) as YahooChartResponse;
    if (body.chart.error) {
      throw new Error(`yahoo error: ${body.chart.error.description}`);
    }
    const result = body.chart.result?.[0];
    if (!result || !result.timestamp?.length) {
      throw new Error('yahoo: empty result');
    }
    const ts = result.timestamp;
    const close = result.indicators.quote[0]?.close ?? [];

    const rows: ShippingSignalRow[] = [];
    for (let i = 0; i < ts.length; i++) {
      const v = close[i];
      if (v == null || !Number.isFinite(v)) continue;
      rows.push({
        source: 'bdry',
        metric: 'close',
        observed_at: new Date(ts[i] * 1000).toISOString(),
        value: Number(v),
        unit: 'usd_per_share',
        meta: { symbol: 'BDRY', proxy_for: 'baltic_dry_index' },
      });
    }
    return rows;
  },
};
