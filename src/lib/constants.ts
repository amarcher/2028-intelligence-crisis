import type { VerdictType } from './types';

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
  confirmed: { label: 'CONFIRMED', color: COLORS.accent, icon: '▲' },
  trending: { label: 'TRENDING', color: COLORS.warning, icon: '◆' },
  early: { label: 'TOO EARLY', color: COLORS.textDim, icon: '○' },
  wrong: { label: 'NOT YET', color: COLORS.positive, icon: '▽' },
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
} as const;

export const SECTIONS = [
  { id: 'ai', label: 'AI Capability', color: COLORS.purple },
  { id: 'saas', label: 'SaaS Disruption', color: COLORS.blue },
  { id: 'labor', label: 'Labor Market', color: COLORS.accent },
  { id: 'consumer', label: 'Consumer Impact', color: COLORS.warning },
  { id: 'financial', label: 'Financial Contagion', color: COLORS.teal },
] as const;
