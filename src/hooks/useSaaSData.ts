import { SAAS_SERIES } from '../lib/constants';
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

export function useSaaSData(): UseSaaSDataResult {
  // 5 explicit hook calls — required by React rules of hooks
  const nowResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.servicenow : '');
  const crmResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.salesforce : '');
  const mndyResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.monday : '');
  const hubsResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.hubspot : '');
  const frshResult = useSupabase(USE_REAL_DATA ? SAAS_SERIES.freshworks : '');

  if (!USE_REAL_DATA) {
    return { data: SAAS_DATA, isLoading: false, error: null };
  }

  const isLoading =
    nowResult.isLoading || crmResult.isLoading || mndyResult.isLoading ||
    hubsResult.isLoading || frshResult.isLoading;
  const error =
    nowResult.error || crmResult.error || mndyResult.error ||
    hubsResult.error || frshResult.error;

  if (!nowResult.data || !crmResult.data || !mndyResult.data ||
      !hubsResult.data || !frshResult.data) {
    return { data: SAAS_DATA, isLoading, error };
  }

  // Build lookup maps by date
  const toMap = (data: { date: string; value: number }[]) =>
    new Map(data.map((d) => [d.date, d.value]));

  const nowMap = toMap(nowResult.data);
  const crmMap = toMap(crmResult.data);
  const mndyMap = toMap(mndyResult.data);
  const hubsMap = toMap(hubsResult.data);
  const frshMap = toMap(frshResult.data);

  // Collect all unique dates
  const allDates = new Set<string>();
  [nowResult.data, crmResult.data, mndyResult.data, hubsResult.data, frshResult.data]
    .forEach((series) => series.forEach((d) => allDates.add(d.date)));

  const sortedDates = [...allDates].sort();

  const merged: SaaSDataPoint[] = sortedDates.map((date) => ({
    date: dbDateToQuarterLabel(date),
    servicenow: nowMap.get(date) || 0,
    salesforce: crmMap.get(date) || 0,
    monday: mndyMap.get(date) || 0,
    hubspot: hubsMap.get(date) || 0,
    freshworks: frshMap.get(date) || 0,
  }));

  if (merged.length === 0) {
    return { data: SAAS_DATA, isLoading, error };
  }

  return { data: merged, isLoading, error };
}
