import { SAAS_SERIES, ARTICLE_END_QUARTER } from '../lib/constants';
import { SAAS_DATA } from '../lib/mockData';
import { useSupabase } from './useSupabase';
import type { SaaSDataPoint } from '../lib/types';

const USE_REAL_DATA = import.meta.env.VITE_USE_REAL_DATA === 'true';

interface UseSaaSDataResult {
  data: SaaSDataPoint[];
  isLoading: boolean;
  error: string | null;
}

function dbDateToQuarterLabel(date: string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const quarter = Math.floor(d.getMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

function padSaaSToEnd(data: SaaSDataPoint[]): SaaSDataPoint[] {
  if (!data.length) return data;
  const last = data[data.length - 1].date;
  if (last >= ARTICLE_END_QUARTER) return data;
  const padding: SaaSDataPoint[] = [];
  let y = parseInt(last.slice(0, 4));
  let q = parseInt(last.slice(-1));
  const ey = parseInt(ARTICLE_END_QUARTER.slice(0, 4));
  const eq = parseInt(ARTICLE_END_QUARTER.slice(-1));
  q++;
  if (q > 4) { q = 1; y++; }
  while (y < ey || (y === ey && q <= eq)) {
    padding.push({ date: `${y}-Q${q}`, servicenow: null, salesforce: null, hubspot: null, freshworks: null, workday: null, datadog: null });
    q++;
    if (q > 4) { q = 1; y++; }
  }
  return [...data, ...padding];
}

export function useSaaSData(): UseSaaSDataResult {
  // 6 explicit hook calls — required by React rules of hooks
  const nowResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.servicenow : '');
  const crmResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.salesforce : '');
  const hubsResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.hubspot : '');
  const frshResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.freshworks : '');
  const wdayResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.workday : '');
  const ddogResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.datadog : '');

  if (!USE_REAL_DATA) {
    return { data: padSaaSToEnd(SAAS_DATA), isLoading: false, error: null };
  }

  const isLoading =
    nowResult.isLoading || crmResult.isLoading ||
    hubsResult.isLoading || frshResult.isLoading ||
    wdayResult.isLoading || ddogResult.isLoading;
  const error =
    nowResult.error || crmResult.error ||
    hubsResult.error || frshResult.error ||
    wdayResult.error || ddogResult.error;

  if (!nowResult.data || !crmResult.data ||
      !hubsResult.data || !frshResult.data ||
      !wdayResult.data || !ddogResult.data) {
    return { data: SAAS_DATA, isLoading, error };
  }

  // Build lookup maps by date
  const toMap = (data: { date: string; value: number }[]) =>
    new Map(data.map((d) => [d.date, d.value]));

  const nowMap = toMap(nowResult.data);
  const crmMap = toMap(crmResult.data);
  const hubsMap = toMap(hubsResult.data);
  const frshMap = toMap(frshResult.data);
  const wdayMap = toMap(wdayResult.data);
  const ddogMap = toMap(ddogResult.data);

  // Collect all unique dates
  const allDates = new Set<string>();
  [nowResult.data, crmResult.data, hubsResult.data, frshResult.data, wdayResult.data, ddogResult.data]
    .forEach((series) => series.forEach((d) => allDates.add(d.date)));

  const sortedDates = [...allDates].sort();

  const merged: SaaSDataPoint[] = sortedDates.map((date) => ({
    date: dbDateToQuarterLabel(date),
    servicenow: nowMap.get(date) ?? null,
    salesforce: crmMap.get(date) ?? null,
    hubspot: hubsMap.get(date) ?? null,
    freshworks: frshMap.get(date) ?? null,
    workday: wdayMap.get(date) ?? null,
    datadog: ddogMap.get(date) ?? null,
  }));

  if (merged.length === 0) {
    return { data: padSaaSToEnd(SAAS_DATA), isLoading, error };
  }

  return { data: padSaaSToEnd(merged), isLoading, error };
}
