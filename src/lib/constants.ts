import type { VerdictType, DataPoint } from './types';

export const COLORS = {
  bg: '#0a0a0f',
  bgCard: '#111118',
  bgCardHover: '#16161f',
  border: '#1e1e2a',
  borderActive: '#2a2a3a',
  text: '#c8c8d4',
  textDim: '#6b6b80',
  textBright: '#eeeef4',
  accent: '#ff4d3a',
  accentGlow: 'rgba(255,77,58,0.15)',
  warning: '#f0a030',
  positive: '#30d490',
  blue: '#4d8eff',
  purple: '#9b6dff',
  teal: '#2dd4bf',
  chartGrid: '#1a1a28',
  tooltipBg: '#1a1a25',
} as const;

export const VERDICT: Record<VerdictType, { label: string; color: string; icon: string }> = {
  confirmed: { label: 'MATERIALIZING', color: COLORS.accent, icon: '▲' },
  trending:  { label: 'TRENDING',      color: COLORS.warning, icon: '↗' },
  early:     { label: 'TOO EARLY',     color: COLORS.textDim, icon: '○' },
  wrong:     { label: 'COUNTERED',     color: COLORS.positive, icon: '▼' },
};

export const FRED_SERIES = {
  unemployment: 'UNRATE',
  jolts_openings: 'JTSJOL',
  initial_claims: 'ICSA',
  real_wage: 'LES1252881600Q',
  savings_rate: 'PSAVERT',
  velocity_m2: 'M2V',
  consumer_confidence: 'UMCSENT',
  labor_share: 'PRS85006173',
  fed_receipts: 'W006RC1Q027SBEA',
  treasury_10y: 'DGS10',
  sp500: 'SP500',
  pce: 'PCE',
  cc_delinquency: 'DRCCLACBS',
  mortgage_delinquency: 'DRSFRMACBS',
  tech_employment: 'CES5000000001',
  information_employment: 'USINFO',
  output_per_hour: 'OPHNFB',
  real_gdp_growth: 'A191RL1Q225SBEA',
  case_shiller_national: 'CSUSHPISA',
} as const;

export const SAAS_SERIES = {
  servicenow: 'saas_NOW',
  salesforce: 'saas_CRM',
  hubspot: 'saas_HUBS',
  freshworks: 'saas_FRSH',
  workday: 'saas_WDAY',
  datadog: 'saas_DDOG',
} as const;

/**
 * Find the X-axis value closest to Q4 2025 in a dataset's date strings.
 * Returns the exact date string from the data, or null if not found.
 */
export function getMilestoneX(data: { date: string }[]): string | null {
  if (!data.length) return null;
  // Quarterly format (YYYY-QN)
  const q4 = data.find(d => d.date === '2025-Q4');
  if (q4) return q4.date;
  // Monthly format (YYYY-MM) — mock data
  const monthly = data.find(d => d.date === '2025-10');
  if (monthly) return monthly.date;
  // FRED date format (YYYY-MM-DD)
  const fred = data.find(d => d.date === '2025-10-01');
  if (fred) return fred.date;
  // Weekly/daily — first date in Oct 2025
  const weekly = data.find(d => d.date >= '2025-10-01' && d.date < '2025-11-01');
  if (weekly) return weekly.date;
  return null;
}

export const MILESTONE_LABEL = {
  value: "Q4 '25",
  fill: '#888898',
  fontSize: 9,
  position: 'insideTopLeft' as const,
};

export const MILESTONE_STROKE = '#555570';

export const ARTICLE_END_MONTH = '2028-06';
export const ARTICLE_END_QUARTER = '2028-Q2';

/** Generate monthly date strings from start (exclusive) through end (inclusive). */
function monthsAfter(start: string, end: string): string[] {
  const dates: string[] = [];
  // Normalize: strip day if YYYY-MM-DD
  const s = start.slice(0, 7);
  let [y, m] = s.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  m++;
  if (m > 12) { m = 1; y++; }
  while (y < ey || (y === ey && m <= em)) {
    dates.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return dates;
}

/** Generate quarterly date strings from start (exclusive) through end (inclusive). */
function quartersAfter(start: string, end: string): string[] {
  const dates: string[] = [];
  let y = parseInt(start.slice(0, 4));
  let q = parseInt(start.slice(-1));
  const ey = parseInt(end.slice(0, 4));
  const eq = parseInt(end.slice(-1));
  q++;
  if (q > 4) { q = 1; y++; }
  while (y < ey || (y === ey && q <= eq)) {
    dates.push(`${y}-Q${q}`);
    q++;
    if (q > 4) { q = 1; y++; }
  }
  return dates;
}

/** Pad a DataPoint array with null-value entries through June 2028. */
export function padToArticleEnd(data: DataPoint[]): DataPoint[] {
  if (!data.length) return data;
  const last = data[data.length - 1].date;
  if (last >= ARTICLE_END_MONTH) return data;
  const future = last.includes('-Q')
    ? quartersAfter(last, ARTICLE_END_QUARTER)
    : monthsAfter(last, ARTICLE_END_MONTH);
  return [...data, ...future.map(date => ({ date, value: null }))];
}

export const SECTIONS = [
  { id: 'ai', label: 'AI Capability', color: COLORS.purple },
  { id: 'saas', label: 'SaaS Disruption', color: COLORS.blue },
  { id: 'labor', label: 'Labor Market', color: COLORS.accent },
  { id: 'consumer', label: 'Consumer Impact', color: COLORS.warning },
  { id: 'financial', label: 'Financial Contagion', color: COLORS.teal },
] as const;
