// Neocloud policy event study — pure functions shared by the dashboard
// (NeocloudPolicyWatch) and the CLI script (scripts/neocloud-event-test.ts).
//
// Two layers, so the AI-trade mood stays in the picture:
//   Layer 1: neocloud basket return minus the index (how the whole group reacts)
//   Layer 2: target (IREN) return minus the basket (what's specific to the target)
// Events are tagged 'policy' or 'other' so the two kinds can be compared.

export const TARGET = 'IREN';
export const PEERS = ['CRWV', 'NBIS', 'WULF', 'CIFR'] as const;
export const INDEX = 'QQQ'; // Nasdaq-100 proxy
export const TICKERS = [TARGET, ...PEERS, INDEX];

export type EventKind = 'policy' | 'other';

export interface PolicyEvent {
  event_date: string; // YYYY-MM-DD
  kind: EventKind;
  label: string;
  source_url?: string | null;
}

export interface PricePoint {
  ticker: string;
  trade_date: string; // YYYY-MM-DD
  close: number;
}

export interface EventResult {
  event: PolicyEvent;
  status: 'ok' | 'pending';
  windowStart?: string;
  windowEnd?: string;
  target?: number;
  basket?: number;
  index?: number;
  layer1?: number; // basket minus index
  layer2?: number; // target minus basket
}

export interface KindSummary {
  kind: EventKind;
  events: number;
  avgAbsLayer1: number;
  avgAbsLayer2: number;
  avgAbsTarget: number;
}

export interface EventStudyResult {
  results: EventResult[];
  summary: KindSummary[];
  typicalDayLayer1: number; // avg |basket - index| on an ordinary single day
  tradingDays: number;
}

export interface EventStudyOptions {
  before?: number; // trading days before the event
  after?: number; // trading days after the event
}

// Seed list. The Supabase table policy_events is the live source; this list
// mirrors its seed rows so the CLI script works without a database.
export const SEED_EVENTS: PolicyEvent[] = [
  { event_date: '2026-08-03', kind: 'policy', label: 'Abbott orders Texas data center audit; ERCOT pauses 75 MW+ approvals' },
  { event_date: '2026-09-08', kind: 'policy', label: 'Sweetwater gets conditional ERCOT base load status' },
  { event_date: '2026-09-18', kind: 'policy', label: 'Virginia EO 22 ends by-right zoning for 25 MW+' },
  { event_date: '2026-11-04', kind: 'policy', label: 'Hinojosa wins Texas governor race (first trading day after)' },
  { event_date: '2026-12-10', kind: 'policy', label: 'ERCOT Batch Zero audit reports due' },
  { event_date: '2026-08-13', kind: 'other', label: 'Microsoft accepts IREN Horizon 1' },
  { event_date: '2026-08-27', kind: 'other', label: 'IREN FY26 results' },
  { event_date: '2026-11-05', kind: 'other', label: 'IREN Q1 FY27 results' },
  { event_date: '2026-11-23', kind: 'other', label: 'Nvidia reinstates Jensen Huang as CEO' },
];

function dailyReturns(points: PricePoint[]): Map<string, number> {
  const sorted = [...points].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close;
    if (prev > 0) out.set(sorted[i].trade_date, sorted[i].close / prev - 1);
  }
  return out;
}

const avgAbs = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length : NaN);

export function computeEventStudy(
  prices: PricePoint[],
  events: PolicyEvent[],
  { before = 1, after = 2 }: EventStudyOptions = {},
): EventStudyResult {
  const byTicker = new Map<string, PricePoint[]>();
  for (const p of prices) {
    const list = byTicker.get(p.ticker) ?? [];
    list.push(p);
    byTicker.set(p.ticker, list);
  }
  const rets = new Map(TICKERS.map((t) => [t, dailyReturns(byTicker.get(t) ?? [])]));

  // Trading days where every ticker has a return.
  const days = [...(rets.get(TARGET)?.keys() ?? [])]
    .filter((d) => TICKERS.every((t) => rets.get(t)!.has(d)))
    .sort();
  const basket = new Map(
    days.map((d) => [d, PEERS.reduce((a, p) => a + rets.get(p)!.get(d)!, 0) / PEERS.length]),
  );

  const results: EventResult[] = [...events]
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
    .map((event) => {
      const idx = days.findIndex((d) => d >= event.event_date);
      if (idx < 0) return { event, status: 'pending' as const };
      const win = days.slice(Math.max(0, idx - before), idx + after + 1);
      const compound = (f: (d: string) => number) => win.reduce((a, d) => a * (1 + f(d)), 1) - 1;
      const target = compound((d) => rets.get(TARGET)!.get(d)!);
      const bsk = compound((d) => basket.get(d)!);
      const index = compound((d) => rets.get(INDEX)!.get(d)!);
      return {
        event,
        status: 'ok' as const,
        windowStart: win[0],
        windowEnd: win[win.length - 1],
        target,
        basket: bsk,
        index,
        layer1: bsk - index,
        layer2: target - bsk,
      };
    });

  const summary: KindSummary[] = (['policy', 'other'] as EventKind[]).map((kind) => {
    const ok = results.filter((r) => r.status === 'ok' && r.event.kind === kind);
    return {
      kind,
      events: ok.length,
      avgAbsLayer1: avgAbs(ok.map((r) => r.layer1!)),
      avgAbsLayer2: avgAbs(ok.map((r) => r.layer2!)),
      avgAbsTarget: avgAbs(ok.map((r) => r.target!)),
    };
  });

  const typicalDayLayer1 = avgAbs(days.map((d) => basket.get(d)! - rets.get(INDEX)!.get(d)!));

  return { results, summary, typicalDayLayer1, tradingDays: days.length };
}

export const fmtPct = (x: number | undefined) =>
  x == null || Number.isNaN(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
