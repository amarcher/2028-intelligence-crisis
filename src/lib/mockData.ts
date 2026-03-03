import type {
  DataPoint,
  SaaSDataPoint,
  InferenceCostPoint,
  LayoffDataPoint,
} from './types';

function generateMockSeries(
  _name: string,
  startDate: string,
  months: number,
  baseValue: number,
  trend: number,
  noise: number
): DataPoint[] {
  const data: DataPoint[] = [];
  let val = baseValue;
  const start = new Date(startDate);
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    val += trend + (Math.random() - 0.5) * noise;
    data.push({
      date: d.toISOString().slice(0, 7),
      value: Math.round(val * 100) / 100,
    });
  }
  return data;
}

export const MOCK_DATA: Record<string, DataPoint[]> = {
  unemployment: generateMockSeries('unemployment', '2023-01', 26, 3.7, 0.02, 0.15),
  jolts: generateMockSeries('jolts', '2023-01', 26, 8900, -90, 200).map((d) => ({
    ...d,
    value: Math.round(d.value),
  })),
  initial_claims: generateMockSeries('claims', '2024-01', 60, 215, 0.6, 12)
    .map((d, i) => {
      const dt = new Date('2024-01-01');
      dt.setDate(dt.getDate() + i * 7);
      return { date: dt.toISOString().slice(0, 10), value: Math.round(d.value) };
    })
    .filter((_, i) => i % 4 === 0),
  savings_rate: generateMockSeries('savings', '2023-01', 26, 4.1, 0.04, 0.3),
  velocity_m2: generateMockSeries('velocity', '2020-01', 24, 1.15, 0.01, 0.02),
  consumer_confidence: generateMockSeries('confidence', '2023-01', 26, 67, -0.3, 3),
  labor_share: generateMockSeries('labor_share', '2020-01', 24, 58.5, -0.15, 0.4),
  treasury_10y: generateMockSeries('10y', '2023-01', 26, 4.1, -0.02, 0.12),
  tech_employment: generateMockSeries('tech_emp', '2023-01', 26, 3200, -8, 15).map(
    (d) => ({ ...d, value: Math.round(d.value) })
  ),
  cc_delinquency: generateMockSeries('cc_delinq', '2020-01', 20, 2.1, 0.08, 0.1),
  mortgage_delinquency: generateMockSeries('mtg_delinq', '2020-01', 20, 1.7, 0.03, 0.08),
  sp500: generateMockSeries('sp500', '2023-01', 26, 4750, 55, 80).map((d) => ({
    ...d,
    value: Math.round(d.value),
  })),
};

export const LAYOFFS_DATA: LayoffDataPoint[] = [
  // Sources: layoffs.fyi, TrueUp, TechCrunch, DemandSage. Curated Mar 2026.
  { date: '2023-Q1', count: 371, workers: 158314 },
  { date: '2023-Q2', count: 330, workers: 46433 },
  { date: '2023-Q3', count: 265, workers: 25535 },
  { date: '2023-Q4', count: 220, workers: 33718 },
  { date: '2024-Q1', count: 188, workers: 57149 },
  { date: '2024-Q2', count: 155, workers: 41000 },
  { date: '2024-Q3', count: 117, workers: 38000 },
  { date: '2024-Q4', count: 89, workers: 15851 },
  { date: '2025-Q1', count: 195, workers: 70892 },
  { date: '2025-Q2', count: 225, workers: 81911 },
  { date: '2025-Q3', count: 195, workers: 53299 },
  { date: '2025-Q4', count: 168, workers: 39851 },
  { date: '2026-Q1', count: 134, workers: 51446 },
];

export const SAAS_DATA: SaaSDataPoint[] = [
  { date: '2023-Q1', servicenow: 25, salesforce: 11, monday: 42, hubspot: 27, freshworks: 20 },
  { date: '2023-Q2', servicenow: 23, salesforce: 11, monday: 38, hubspot: 25, freshworks: 19 },
  { date: '2023-Q3', servicenow: 25, salesforce: 11, monday: 36, hubspot: 23, freshworks: 18 },
  { date: '2023-Q4', servicenow: 26, salesforce: 11, monday: 33, hubspot: 22, freshworks: 17 },
  { date: '2024-Q1', servicenow: 24, salesforce: 11, monday: 30, hubspot: 21, freshworks: 16 },
  { date: '2024-Q2', servicenow: 23, salesforce: 9, monday: 26, hubspot: 20, freshworks: 18 },
  { date: '2024-Q3', servicenow: 22, salesforce: 8, monday: 24, hubspot: 20, freshworks: 16 },
  { date: '2024-Q4', servicenow: 21, salesforce: 8, monday: 22, hubspot: 18, freshworks: 15 },
  { date: '2025-Q1', servicenow: 19, salesforce: 7, monday: 18, hubspot: 15, freshworks: 13 },
  { date: '2025-Q2', servicenow: 18, salesforce: 8, monday: 15, hubspot: 14, freshworks: 11 },
  { date: '2025-Q3', servicenow: 17, salesforce: 7, monday: 14, hubspot: 13, freshworks: 10 },
  { date: '2025-Q4', servicenow: 16, salesforce: 6, monday: 12, hubspot: 12, freshworks: 9 },
];

export const INFERENCE_COST: InferenceCostPoint[] = [
  // $/1M output tokens for cheapest model at GPT-4 capability level. Curated Mar 2026.
  // Sources: OpenAI & Anthropic published pricing pages.
  { date: '2023-03', gpt4: 60, claude: null, label: 'GPT-4 launch' },
  { date: '2023-07', gpt4: 60, claude: 24, label: 'Claude 2' },
  { date: '2023-11', gpt4: 30, claude: 24, label: 'GPT-4 Turbo' },
  { date: '2024-03', gpt4: 30, claude: 15, label: 'Claude 3 Sonnet' },
  { date: '2024-06', gpt4: 15, claude: 15, label: 'GPT-4o / Sonnet 3.5' },
  { date: '2024-10', gpt4: 0.6, claude: 0.8, label: '4o mini / Haiku 3.5' },
  { date: '2025-06', gpt4: 0.6, claude: 0.8, label: '' },
  { date: '2026-02', gpt4: 0.6, claude: 0.8, label: 'Now' },
];
