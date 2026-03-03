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
  const [startYear, startMonth] = startDate.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const m = startMonth - 1 + i;
    const year = startYear + Math.floor(m / 12);
    const month = (m % 12) + 1;
    val += trend + (Math.random() - 0.5) * noise;
    data.push({
      date: `${year}-${String(month).padStart(2, '0')}`,
      value: Math.round(val * 100) / 100,
    });
  }
  return data;
}

export const MOCK_DATA: Record<string, DataPoint[]> = {
  unemployment: generateMockSeries('unemployment', '2023-01', 38, 3.7, 0.02, 0.15),
  jolts: generateMockSeries('jolts', '2023-01', 38, 8900, -90, 200).map((d) => ({
    ...d,
    value: Math.round(d.value),
  })),
  initial_claims: generateMockSeries('claims', '2024-01', 100, 215000, 600, 12000)
    .map((d, i) => {
      const base = Date.UTC(2024, 0, 1) + i * 7 * 86400000;
      const dt = new Date(base);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dt.getUTCDate()).padStart(2, '0');
      return { date: `${y}-${m}-${day}`, value: Math.round(d.value) };
    })
    .filter((_, i) => i % 4 === 0),
  savings_rate: generateMockSeries('savings', '2023-01', 38, 4.1, 0.04, 0.3),
  velocity_m2: generateMockSeries('velocity', '2022-01', 48, 1.15, 0.01, 0.02),
  consumer_confidence: generateMockSeries('confidence', '2023-01', 38, 67, -0.3, 3),
  labor_share: generateMockSeries('labor_share', '2022-01', 48, 58.5, -0.15, 0.4),
  treasury_10y: generateMockSeries('10y', '2020-01', 74, 1.8, 0.04, 0.15),
  tech_employment: generateMockSeries('tech_emp', '2023-01', 38, 3200, -8, 15).map(
    (d) => ({ ...d, value: Math.round(d.value) })
  ),
  cc_delinquency: generateMockSeries('cc_delinq', '2022-01', 48, 2.1, 0.04, 0.1),
  mortgage_delinquency: generateMockSeries('mtg_delinq', '2022-01', 48, 1.7, 0.02, 0.08),
  sp500: generateMockSeries('sp500', '2020-01', 74, 3250, 40, 100).map((d) => ({
    ...d,
    value: Math.round(d.value),
  })),
  real_wage: generateMockSeries('real_wage', '2022-01', 48, 365, -1.2, 4),
  fed_receipts: generateMockSeries('fed_receipts', '2022-01', 48, 4800, -15, 80).map((d) => ({
    ...d,
    value: Math.round(d.value),
  })),
  output_per_hour: generateMockSeries('output_per_hour', '2022-01', 48, 108, 0.6, 1.2),
  real_gdp_growth: generateMockSeries('real_gdp_growth', '2022-01', 48, 2.5, 0.08, 1.5),
  case_shiller_national: generateMockSeries('case_shiller', '2022-01', 48, 260, 2.5, 5).map((d) => ({
    ...d,
    value: Math.round(d.value * 10) / 10,
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
  { date: '2026-Q2', count: null, workers: null },
  { date: '2026-Q3', count: null, workers: null },
  { date: '2026-Q4', count: null, workers: null },
  { date: '2027-Q1', count: null, workers: null },
  { date: '2027-Q2', count: null, workers: null },
  { date: '2027-Q3', count: null, workers: null },
  { date: '2027-Q4', count: null, workers: null },
  { date: '2028-Q1', count: null, workers: null },
  { date: '2028-Q2', count: null, workers: null },
];

export const SAAS_DATA: SaaSDataPoint[] = [
  { date: '2023-Q1', servicenow: 25, salesforce: 11, hubspot: 27, freshworks: 20, workday: 17, datadog: 33 },
  { date: '2023-Q2', servicenow: 23, salesforce: 11, hubspot: 25, freshworks: 19, workday: 16, datadog: 28 },
  { date: '2023-Q3', servicenow: 25, salesforce: 11, hubspot: 23, freshworks: 18, workday: 16, datadog: 25 },
  { date: '2023-Q4', servicenow: 26, salesforce: 11, hubspot: 22, freshworks: 17, workday: 17, datadog: 26 },
  { date: '2024-Q1', servicenow: 24, salesforce: 11, hubspot: 21, freshworks: 16, workday: 18, datadog: 27 },
  { date: '2024-Q2', servicenow: 23, salesforce: 9, hubspot: 20, freshworks: 18, workday: 17, datadog: 27 },
  { date: '2024-Q3', servicenow: 22, salesforce: 8, hubspot: 20, freshworks: 16, workday: 16, datadog: 26 },
  { date: '2024-Q4', servicenow: 21, salesforce: 8, hubspot: 18, freshworks: 15, workday: 15, datadog: 24 },
  { date: '2025-Q1', servicenow: 19, salesforce: 7, hubspot: 15, freshworks: 13, workday: 14, datadog: 22 },
  { date: '2025-Q2', servicenow: 18, salesforce: 8, hubspot: 14, freshworks: 11, workday: 13, datadog: 20 },
  { date: '2025-Q3', servicenow: 17, salesforce: 7, hubspot: 13, freshworks: 10, workday: 12, datadog: 19 },
  { date: '2025-Q4', servicenow: 16, salesforce: 6, hubspot: 12, freshworks: 9, workday: 11, datadog: 17 },
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
  { date: '2025-10', gpt4: 0.6, claude: 0.8, label: '' },
  { date: '2026-02', gpt4: 0.6, claude: 0.8, label: 'Now' },
  { date: '2026-06', gpt4: null, claude: null, label: '' },
  { date: '2027-01', gpt4: null, claude: null, label: '' },
  { date: '2027-06', gpt4: null, claude: null, label: '' },
  { date: '2028-01', gpt4: null, claude: null, label: '' },
  { date: '2028-06', gpt4: null, claude: null, label: '' },
];
