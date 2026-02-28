import { MOCK_DATA } from '../lib/mockData';
import { useSupabase } from './useSupabase';
import type { DataPoint } from '../lib/types';

const USE_REAL_DATA = import.meta.env.VITE_USE_REAL_DATA === 'true';

interface UseEconomicDataOptions {
  startDate?: string;
}

interface UseEconomicDataResult {
  data: DataPoint[];
  isLoading: boolean;
  error: string | null;
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
      data: MOCK_DATA[mockKey] || [],
      isLoading: false,
      error: null,
    };
  }

  return {
    data: supabaseResult.data || MOCK_DATA[mockKey] || [],
    isLoading: supabaseResult.isLoading,
    error: supabaseResult.error,
  };
}
