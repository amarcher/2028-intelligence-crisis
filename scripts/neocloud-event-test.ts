// One-off / local runner for the neocloud policy event study.
// Fetches daily prices straight from Yahoo Finance (no database needed),
// runs src/lib/eventStudy.ts, and writes scripts/out/report.md.
//
// Run with Node 22.6+ (native TypeScript):  node scripts/neocloud-event-test.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEX,
  PEERS,
  SEED_EVENTS,
  TICKERS,
  computeEventStudy,
  fmtPct,
  type PricePoint,
} from '../src/lib/eventStudy.ts';

const KALSHI_SERIES = 'KXDCMORATORIUMLAW';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

async function fetchYahoo(ticker: string, range = '1y'): Promise<PricePoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json.chart.result[0];
  const ts: number[] = r.timestamp;
  const closes: (number | null)[] = r.indicators.adjclose?.[0]?.adjclose ?? r.indicators.quote[0].close;
  return ts.flatMap((t, i) => {
    const c = closes[i];
    return c == null ? [] : [{ ticker, trade_date: new Date(t * 1000).toISOString().slice(0, 10), close: c }];
  });
}

// Kalshi moved prices to *_dollars string fields; read both shapes.
function cents(m: Record<string, unknown>, key: string): string {
  const legacy = m[key];
  if (typeof legacy === 'number') return `${legacy}¢`;
  const dollars = m[`${key}_dollars`];
  if (dollars != null && !Number.isNaN(Number(dollars))) return `${Math.round(Number(dollars) * 100)}¢`;
  return '?';
}

async function fetchKalshi(): Promise<string> {
  const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${KALSHI_SERIES}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const markets: Record<string, unknown>[] = json.markets ?? [];
  if (!markets.length) return 'No markets returned.';
  return markets
    .map((m) => {
      const volume = m.volume ?? m.volume_fp ?? '?';
      return `- ${m.ticker}: last ${cents(m, 'last_price')}, yes bid ${cents(m, 'yes_bid')}, yes ask ${cents(m, 'yes_ask')}, volume ${volume}, closes ${m.close_time ?? '?'}`;
    })
    .join('\n');
}

async function main() {
  const prices = (await Promise.all(TICKERS.map((t) => fetchYahoo(t)))).flat();
  const study = computeEventStudy(prices, SEED_EVENTS);
  const kalshi = await fetchKalshi().catch((e: Error) => `Kalshi fetch failed: ${e.message}`);

  const rows = study.results.map((r) =>
    r.status === 'pending'
      ? `| ${r.event.event_date} | ${r.event.kind} | ${r.event.label} | not yet | | | |`
      : `| ${r.event.event_date} | ${r.event.kind} | ${r.event.label} | ${fmtPct(r.target)} | ${fmtPct(r.basket)} | ${fmtPct(r.layer1)} | ${fmtPct(r.layer2)} |`,
  );

  const md = [
    `# IREN policy event test (run ${new Date().toISOString().slice(0, 10)})`,
    '',
    `Window: 1 trading day before to 2 after each event. Basket = equal-weight ${PEERS.join(', ')}. Index = ${INDEX}.`,
    '',
    '| Date | Kind | Event | IREN | Basket | Layer 1: basket minus index | Layer 2: IREN minus basket |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Average size of moves (absolute)',
    '',
    '| Kind | Events | Layer 1 | Layer 2 | IREN |',
    '| --- | --- | --- | --- | --- |',
    ...study.summary.map(
      (s) => `| ${s.kind} | ${s.events} | ${fmtPct(s.avgAbsLayer1)} | ${fmtPct(s.avgAbsLayer2)} | ${fmtPct(s.avgAbsTarget)} |`,
    ),
    '',
    `For scale, an ordinary single day's basket-minus-index move averages ${fmtPct(study.typicalDayLayer1)}.`,
    '',
    `## Kalshi: ${KALSHI_SERIES}`,
    '',
    kalshi,
  ].join('\n');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'report.md'), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
