// Alpaca API adapter. Raw fetch against /v2 endpoints — no SDK, same
// pattern as the Anthropic reasoner for Deno/esm.sh compatibility. Paper
// vs live selected at construction time; same API shape on both hosts.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   ALPACA_KEY_ID          — API key ID
//   ALPACA_SECRET_KEY      — API secret
//   ALPACA_PAPER_MODE      — 'true' (default) or 'false' — gates paper vs live
//
// When ALPACA_PAPER_MODE is anything other than the literal string 'false',
// the adapter points at the paper API. This is deliberately conservative —
// accidentally leaving the secret empty defaults you to paper, not live.

const PAPER_TRADING_BASE = 'https://paper-api.alpaca.markets';
const LIVE_TRADING_BASE = 'https://api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
  paperMode: boolean;
}

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  cash: number;
  portfolio_value: number;
  equity: number;
  last_equity: number;
  buying_power: number;
  options_buying_power: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  account_blocked: boolean;
  daytrade_count: number;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: number;
  avg_entry_price: number;
  side: 'long' | 'short';
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  current_price: number;
  asset_class: 'us_equity' | 'us_option' | string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: number;
  filled_qty: number;
  filled_avg_price: number | null;
  order_type: string;
  side: 'buy' | 'sell';
  time_in_force: string;
  limit_price: number | null;
  status: string;
}

export interface PlaceOrderParams {
  symbol: string;             // AAPL for equity, OCC symbol for option
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force?: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
  client_order_id?: string;   // for idempotency
  /** Equity vs option — Alpaca infers from the symbol format, but declaring
   *  intent lets us validate up-front. */
  assetClass?: 'equity' | 'option';
}

/** Load creds from Edge Function env and construct an adapter. Throws if
 *  keys are missing — paper_mode defaults to TRUE (safe). */
export function alpacaFromEnv(paperModeOverride?: boolean): AlpacaCredentials {
  const keyId = Deno.env.get('ALPACA_KEY_ID');
  const secretKey = Deno.env.get('ALPACA_SECRET_KEY');
  if (!keyId || !secretKey) {
    throw new Error('Alpaca not configured (ALPACA_KEY_ID / ALPACA_SECRET_KEY missing)');
  }
  // Default to paper. Only literal string 'false' activates live mode unless
  // the caller passes the database-backed rollout gate explicitly.
  const paperMode = paperModeOverride ?? Deno.env.get('ALPACA_PAPER_MODE') !== 'false';
  return { keyId, secretKey, paperMode };
}

export function tradingBase(c: AlpacaCredentials): string {
  return c.paperMode ? PAPER_TRADING_BASE : LIVE_TRADING_BASE;
}

function headers(c: AlpacaCredentials) {
  return {
    'APCA-API-KEY-ID': c.keyId,
    'APCA-API-SECRET-KEY': c.secretKey,
    'Content-Type': 'application/json',
  };
}

async function req<T>(
  c: AlpacaCredentials,
  method: 'GET' | 'POST' | 'DELETE',
  baseUrl: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // Single retry on 429 with exponential backoff. Anything else throws so the
  // caller can distinguish validation errors from rate limits.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: headers(c),
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Alpaca ${method} ${path} → ${res.status}: ${txt.slice(0, 400)}`);
    }
    // DELETE /v2/orders returns an array of {id, status}; other 204 responses
    // have no body. Handle both.
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
  throw new Error('Alpaca retry loop exhausted (should be unreachable)');
}

// ————— account / positions / orders —————

export async function getAccount(c: AlpacaCredentials): Promise<AlpacaAccount> {
  const raw = await req<Record<string, string | number | boolean>>(
    c, 'GET', tradingBase(c), '/v2/account',
  );
  // Alpaca returns numeric fields as strings — coerce the ones we consume.
  return {
    id: String(raw.id),
    status: String(raw.status),
    currency: String(raw.currency),
    cash: Number(raw.cash),
    portfolio_value: Number(raw.portfolio_value),
    equity: Number(raw.equity),
    last_equity: Number(raw.last_equity),
    buying_power: Number(raw.buying_power),
    options_buying_power: Number(raw.options_buying_power ?? 0),
    pattern_day_trader: Boolean(raw.pattern_day_trader),
    trading_blocked: Boolean(raw.trading_blocked),
    account_blocked: Boolean(raw.account_blocked),
    daytrade_count: Number(raw.daytrade_count ?? 0),
  };
}

export async function getPositions(c: AlpacaCredentials): Promise<AlpacaPosition[]> {
  const raw = await req<Array<Record<string, string | number>>>(
    c, 'GET', tradingBase(c), '/v2/positions',
  );
  return raw.map((p) => ({
    asset_id: String(p.asset_id),
    symbol: String(p.symbol),
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price),
    side: p.side as 'long' | 'short',
    market_value: Number(p.market_value),
    cost_basis: Number(p.cost_basis),
    unrealized_pl: Number(p.unrealized_pl),
    unrealized_plpc: Number(p.unrealized_plpc),
    current_price: Number(p.current_price),
    asset_class: String(p.asset_class),
  }));
}

export async function getOpenOrders(c: AlpacaCredentials): Promise<AlpacaOrder[]> {
  return req<AlpacaOrder[]>(
    c, 'GET', tradingBase(c),
    '/v2/orders?status=open&direction=desc&limit=500',
  );
}

/** Fetch a single order by Alpaca order id — used by the fill-reconciliation
 *  pass to move agent_orders rows from 'submitted' to their terminal state
 *  (filled / canceled / expired) with the actual fill price. */
export async function getOrderById(
  c: AlpacaCredentials,
  alpacaOrderId: string,
): Promise<AlpacaOrder> {
  return req<AlpacaOrder>(c, 'GET', tradingBase(c), `/v2/orders/${alpacaOrderId}`);
}

export async function placeOrder(
  c: AlpacaCredentials,
  p: PlaceOrderParams,
): Promise<AlpacaOrder> {
  const body: Record<string, unknown> = {
    symbol: p.symbol,
    qty: p.qty,
    side: p.side,
    type: p.type,
    time_in_force: p.time_in_force ?? 'day',
  };
  if (p.type === 'limit') {
    if (p.limit_price == null) {
      throw new Error('placeOrder: limit_price required for type=limit');
    }
    body.limit_price = p.limit_price;
  }
  if (p.client_order_id) body.client_order_id = p.client_order_id;

  return req<AlpacaOrder>(c, 'POST', tradingBase(c), '/v2/orders', body);
}

/** Cancel every open order. Returns one status entry per order Alpaca tried to
 *  cancel. Safe to call when there are no open orders (returns []). */
export async function cancelAllOrders(
  c: AlpacaCredentials,
): Promise<Array<{ id: string; status: number }>> {
  return (
    (await req<Array<{ id: string; status: number }>>(
      c, 'DELETE', tradingBase(c), '/v2/orders',
    )) ?? []
  );
}

// ————— equity quotes (latest-trade snapshot used for strike anchoring) —————

export interface LatestTrade {
  ticker: string;
  price: number;
  asOf: string;   // ISO timestamp from the exchange tape
}

/** Batch-fetch latest trade prices for equity symbols. Uses Alpaca's data API
 *  (data.alpaca.markets) which is separate from trading. Safe across paper/live.
 *  Returns a map keyed by ticker; missing symbols (e.g. illiquid, bad feed) are
 *  simply absent rather than thrown — the caller degrades gracefully. */
export async function getLatestTrades(
  c: AlpacaCredentials,
  symbols: readonly string[],
): Promise<LatestTrade[]> {
  if (symbols.length === 0) return [];
  const qs = new URLSearchParams({ symbols: symbols.join(',') });
  const raw = await req<{ trades: Record<string, { p: number; t: string }> }>(
    c, 'GET', DATA_BASE, `/v2/stocks/trades/latest?${qs.toString()}`,
  );
  const out: LatestTrade[] = [];
  for (const [ticker, t] of Object.entries(raw.trades ?? {})) {
    if (t && typeof t.p === 'number' && t.p > 0) {
      out.push({ ticker, price: t.p, asOf: String(t.t) });
    }
  }
  return out;
}

export interface DailyBar {
  ticker: string;
  close: number;
  asOf: string;
}

export async function getDailyBars(
  c: AlpacaCredentials,
  symbols: readonly string[],
  startIso: string,
): Promise<Map<string, DailyBar[]>> {
  if (symbols.length === 0) return new Map();
  const qs = new URLSearchParams({
    symbols: symbols.join(','),
    timeframe: '1Day',
    start: startIso,
    adjustment: 'split',
    limit: '10000',
  });
  const raw = await req<{ bars: Record<string, Array<{ c: number; t: string }>> }>(
    c, 'GET', DATA_BASE, `/v2/stocks/bars?${qs.toString()}`,
  );
  const out = new Map<string, DailyBar[]>();
  for (const [ticker, bars] of Object.entries(raw.bars ?? {})) {
    out.set(
      ticker,
      bars
        .filter((b) => typeof b.c === 'number' && b.c > 0)
        .map((b) => ({ ticker, close: b.c, asOf: String(b.t) })),
    );
  }
  return out;
}

export interface OptionQuote {
  symbol: string;   // OCC
  bid: number;
  ask: number;
  asOf: string;
}

/** Latest NBBO quotes for option contracts — used to price marketable limit
 *  orders instead of firing market orders into wide LEAPS spreads. Missing
 *  symbols are absent from the result; callers fall back to market orders. */
export async function getLatestOptionQuotes(
  c: AlpacaCredentials,
  occSymbols: readonly string[],
): Promise<Map<string, OptionQuote>> {
  const out = new Map<string, OptionQuote>();
  if (occSymbols.length === 0) return out;
  const qs = new URLSearchParams({ symbols: occSymbols.join(',') });
  const raw = await req<{ quotes: Record<string, { bp: number; ap: number; t: string }> }>(
    c, 'GET', DATA_BASE, `/v1beta1/options/quotes/latest?${qs.toString()}`,
  );
  for (const [symbol, q] of Object.entries(raw.quotes ?? {})) {
    if (q && typeof q.ap === 'number' && q.ap > 0) {
      out.set(symbol, { symbol, bid: Number(q.bp) || 0, ask: q.ap, asOf: String(q.t) });
    }
  }
  return out;
}

// ————— options data (minimal — used by reasoner for chain awareness) —————

export interface OptionContract {
  symbol: string;               // OCC
  underlying_symbol: string;
  expiration_date: string;      // YYYY-MM-DD
  strike_price: number;
  type: 'call' | 'put';
  style: 'american' | 'european';
  status: 'active' | string;
  close_price?: number;
  open_interest?: number;
}

/** Fetch active option contracts for a symbol, filtered by type + expiry
 *  window. Handy for sizing — given a strike + expiry the agent proposed,
 *  look up the actual OCC symbol before placing. */
export async function getOptionsChain(
  c: AlpacaCredentials,
  underlying: string,
  opts: {
    type?: 'call' | 'put';
    expiration_date_gte?: string;
    expiration_date_lte?: string;
    strike_price_gte?: number;
    strike_price_lte?: number;
    limit?: number;
  } = {},
): Promise<OptionContract[]> {
  const qs = new URLSearchParams({ underlying_symbols: underlying, status: 'active' });
  if (opts.type) qs.set('type', opts.type);
  if (opts.expiration_date_gte) qs.set('expiration_date_gte', opts.expiration_date_gte);
  if (opts.expiration_date_lte) qs.set('expiration_date_lte', opts.expiration_date_lte);
  if (opts.strike_price_gte != null) qs.set('strike_price_gte', String(opts.strike_price_gte));
  if (opts.strike_price_lte != null) qs.set('strike_price_lte', String(opts.strike_price_lte));
  qs.set('limit', String(opts.limit ?? 100));

  const raw = await req<{ option_contracts: OptionContract[] }>(
    c, 'GET', tradingBase(c), `/v2/options/contracts?${qs.toString()}`,
  );
  return raw.option_contracts ?? [];
}
