export interface DataPoint {
  date: string;
  value: number;
}

export interface SaaSDataPoint {
  date: string;
  servicenow: number;
  salesforce: number;
  monday: number;
  hubspot: number;
  freshworks: number;
}

export interface InferenceCostPoint {
  date: string;
  gpt4: number | null;
  claude: number | null;
  label: string;
}

export interface LayoffDataPoint {
  date: string;
  count: number;
  workers: number;
}

export interface Prediction {
  section: string;
  claim: string;
  metric?: string;
  threshold?: number;
  targetDate?: string;
  verdict: VerdictType;
}

export type VerdictType = 'confirmed' | 'trending' | 'early' | 'wrong';

export interface DelinquencyDataPoint {
  date: string;
  cc: number;
  mortgage: number | undefined;
}
