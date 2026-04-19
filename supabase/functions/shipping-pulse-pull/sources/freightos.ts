// Freightos FBX — global container freight index + per-lane spot rates.
// Free, no auth. The public fbx.freightos.com page is WordPress-based and
// embeds two complementary data sets as inline JS array literals assigned to
// a rProductIntroChartData global that chart.js reads:
//
//   1. {"ticker":"FBX","indexDate":"YYYY-MM-DD","value":N}
//      — dated weekly time series for the FBX global composite.
//      Primary source of truth for the "global" metric.
//
//   2. {"label":"FBX01","value":"$2,653","change":"+6.64%","positive":true}
//      — current-week per-lane cards (no date on the blob itself).
//      We stamp these with the most recent indexDate from set #1 so the
//      lane series stays in sync with the global composite.
//
// If Freightos redesigns (they do every ~12 months), grep the returned HTML
// for "indexDate" and adjust the regexes here.

import type { ShippingSignalRow, SourceHandler } from '../types.ts';

const FBX_URL = 'https://fbx.freightos.com';

const LANE_METRIC: Record<string, string> = {
  FBX01: 'china_ea_to_na_west',
  FBX02: 'na_west_to_china_ea',
  FBX03: 'china_ea_to_na_east',
  FBX04: 'na_east_to_china_ea',
  FBX11: 'china_ea_to_n_europe',
  FBX12: 'n_europe_to_china_ea',
  FBX13: 'china_ea_to_mediterranean',
  FBX14: 'mediterranean_to_china_ea',
  FBX21: 'na_east_to_n_europe',
  FBX22: 'n_europe_to_na_east',
  FBX24: 'n_europe_to_sa_east',
  FBX26: 'n_europe_to_sa_west',
};

const SERIES_RE = /\{"ticker":"FBX","indexDate":"(\d{4}-\d{2}-\d{2})","value":([0-9.]+)\}/g;
const LANE_RE = /\{"label":"(FBX\d{0,2})","value":"\$([0-9,.]+)","change":"([+-]?[0-9.]+)%","positive":(true|false)\}/g;

export const freightos: SourceHandler = {
  name: 'fbx',
  cadence: 'weekly',
  async fetch(): Promise<ShippingSignalRow[]> {
    const res = await fetch(FBX_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (shipping-pulse/1.0)' },
    });
    if (!res.ok) throw new Error(`fbx page ${res.status}`);
    const html = await res.text();

    const rows: ShippingSignalRow[] = [];

    // 1. Weekly global composite series (dated).
    let latestSeriesDate: string | null = null;
    for (const m of html.matchAll(SERIES_RE)) {
      const [, dateStr, valStr] = m;
      const value = Number(valStr);
      if (!Number.isFinite(value)) continue;
      const observed_at = new Date(`${dateStr}T00:00:00Z`).toISOString();
      rows.push({
        source: 'fbx',
        metric: 'global',
        observed_at,
        value,
        unit: 'index',
        meta: { ticker: 'FBX', freq: 'weekly' },
      });
      if (!latestSeriesDate || dateStr > latestSeriesDate) {
        latestSeriesDate = dateStr;
      }
    }

    // 2. Current-week per-lane snapshot cards. Stamp with the most recent
    // series date so the lane reading aligns with the global composite.
    // If the series set was empty (site change), fall back to today.
    const laneObservedAt = latestSeriesDate
      ? new Date(`${latestSeriesDate}T00:00:00Z`).toISOString()
      : new Date().toISOString();

    const seenLane = new Set<string>();
    for (const m of html.matchAll(LANE_RE)) {
      const [, code, valStr, changeStr, positive] = m;
      // Skip the bare "FBX" summary card — we already have the dated series.
      if (code === 'FBX') continue;
      if (seenLane.has(code)) continue;
      seenLane.add(code);
      const metric = LANE_METRIC[code] ?? `lane_${code.toLowerCase()}`;
      const value = Number(valStr.replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      rows.push({
        source: 'fbx',
        metric,
        observed_at: laneObservedAt,
        value,
        unit: 'usd_per_40ft',
        meta: {
          code,
          change_pct: Number(changeStr),
          positive: positive === 'true',
        },
      });
    }

    if (rows.length === 0) {
      throw new Error('fbx: no FBX data found on page — site structure changed');
    }
    return rows;
  },
};
