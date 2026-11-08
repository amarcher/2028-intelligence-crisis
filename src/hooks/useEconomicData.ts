import { MOCK_DATA } from '../lib/mockData';
import { useSupabase } from './useSupabase';
import { padToArticleEnd } from '../lib/constants';
import type { DataPoint } from '../lib/types';

const USE_REAL_DATA = import.meta.env.VITE_USE_REAL_DATA === 'true';

interface UseEconomicDataOptions {
  startDate?: string;
}

interface UseEconomicDataResult {
  data: DataPoint[];
  isLoading: boolean;
  error: string | null;
  isMock: boolean;
}

export function useEconomicData(
  seriesId: string,
  mockKey: string,
  options?: UseEconomicDataOptions
): UseEconomicDataResult {
  const supabaseResult = useSupabase(
    USE_REAL_DATA ? seriesId : '',
    options
  );

  if (!USE_REAL_DATA) {
    return {
      data: padToArticleEnd(MOCK_DATA[mockKey] || []),
      isLoading: false,
      error: null,
      isMock: true,
    };
  }

  // Still waiting for Supabase — show nothing yet, don't flash mock data
  if (supabaseResult.isLoading) {
    return {
      data: [],
      isLoading: true,
      error: null,
      isMock: false,
    };
  }


  return {
    data: padToArticleEnd(supabaseResult.data ?? []),
    isLoading: false,
    error: supabaseResult.error,
    isMock: false,
  };
}
