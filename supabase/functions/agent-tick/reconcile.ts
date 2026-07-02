// Fill reconciliation — closes the loop the executor never closed.
//
// agent_orders rows were written once at submission ('submitted') and never
// updated, so the system had no fill prices and no realized-P&L ground truth
// anywhere. This pass runs at the top of each tick (and from the queue-flush
// function): every non-terminal row with an alpaca_order_id gets polled and
// moved to its terminal state, and filled orders land one row in agent_fills.
//
// Deliberately best-effort: any single order failing to sync logs and moves
// on. The tick must never die because reconciliation hiccuped.

import { getOrderById, type AlpacaCredentials, type AlpacaOrder } from './alpaca.ts';

/** Minimal supabase-js surface used here (matches createClient's chainables). */
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const NON_TERMINAL = ['submitted', 'partially_filled'];

/** Alpaca order status → agent_orders.status (constrained by the 008 check). */
function mapStatus(alpaca: string): string | null {
  switch (alpaca) {
    case 'filled':
      return 'filled';
    case 'partially_filled':
      return 'partially_filled';
    case 'canceled':
    case 'done_for_day':
      return 'canceled';
    case 'expired':
      return 'expired';
    case 'rejected':
      return 'rejected';
    // new / accepted / pending_new / held etc. — still working, leave as-is
    default:
      return null;
  }
}

export interface ReconcileResult {
  checked: number;
  updated: number;
  filled: number;
  errors: string[];
}

export async function reconcileOrders(
  supabase: SupabaseClient,
  creds: AlpacaCredentials,
  limit = 50,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, updated: 0, filled: 0, errors: [] };

  const { data: rows, error } = await supabase
    .from('agent_orders')
    .select('id, alpaca_order_id, ticker, option_symbol, side, status')
    .in('status', NON_TERMINAL)
    .not('alpaca_order_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    result.errors.push(`load non-terminal orders: ${error.message}`);
    return result;
  }

  for (const row of rows ?? []) {
    result.checked++;
    let order: AlpacaOrder;
    try {
      order = await getOrderById(creds, String(row.alpaca_order_id));
    } catch (e) {
      result.errors.push(`getOrder ${row.alpaca_order_id}: ${String(e).slice(0, 150)}`);
      continue;
    }

    const newStatus = mapStatus(order.status);
    const gainedFills = Number(order.filled_qty) > 0;
    if (!newStatus && !gainedFills) continue; // still working, nothing to record

    const update: Record<string, unknown> = { raw_alpaca: order };
    if (newStatus) update.status = newStatus;
    if (gainedFills) {
      update.filled_qty = Number(order.filled_qty);
      update.filled_avg_price = order.filled_avg_price == null ? null : Number(order.filled_avg_price);
      update.filled_at = order.filled_at;
    }

    const { error: upErr } = await supabase.from('agent_orders').update(update).eq('id', row.id);
    if (upErr) {
      result.errors.push(`update ${row.id}: ${upErr.message}`);
      continue;
    }
    result.updated++;

    // One agent_fills row per fully-filled order (avg-price granularity —
    // per-execution fills would need the activities API; not worth it yet).
    // alpaca_trade_id is UNIQUE, so re-running is a no-op upsert conflict.
    if (newStatus === 'filled' && order.filled_at) {
      result.filled++;
      const { error: fillErr } = await supabase.from('agent_fills').upsert(
        {
          order_id: row.id,
          filled_at: order.filled_at,
          qty: Number(order.filled_qty),
          price: order.filled_avg_price == null ? 0 : Number(order.filled_avg_price),
          side: row.side,
          ticker: row.ticker,
          option_symbol: row.option_symbol ?? null,
          alpaca_trade_id: `order-${order.id}`,
        },
        { onConflict: 'alpaca_trade_id' },
      );
      if (fillErr) result.errors.push(`fill insert ${row.id}: ${fillErr.message}`);
    }
  }

  return result;
}
