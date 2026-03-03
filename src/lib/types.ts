export interface DataPoint {
  date: string;
  value: number | null;
}

export interface SaaSDataPoint {
  date: string;
  servicenow: number | null;
  salesforce: number | null;
  hubspot: number | null;
  freshworks: number | null;
  workday: number | null;
  datadog: number | null;
}

export interface InferenceCostPoint {
  date: string;
  gpt4: number | null;
  claude: number | null;
  label: string;
}

export interface LayoffDataPoint {
  date: string;
  count: number | null;
  workers: number | null;
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
  cc: number | null;
  mortgage: number | null | undefined;
}

export interface ArticleClaim {
  id: string;
  section: 'ai' | 'saas' | 'labor' | 'consumer' | 'financial';
  claim: string;
  metric?: string;
  direction?: 'above' | 'below';
  threshold?: number;
  thresholdLabel?: string;
  targetDate?: string;
  verdict: VerdictType;
  notes?: string;
}
