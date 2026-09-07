import type { Fill, Side } from "../domain/types.js";

/**
 * Pull a confirmed fill out of whatever the tool handed back.
 *
 * A PreToolUse hook sees intent; only the result says what actually happened.
 * Without this, `recentOrders`, `closedTrades` and `positions` stay empty
 * forever, and the four rules that read them never fire — they would be
 * decoration on a page rather than working parts.
 *
 * The shape is not fully pinned down: an MCP tool result may arrive as the raw
 * exchange JSON, as a `content` array carrying that JSON as text, or nested
 * inside a wrapper. So this searches rather than assumes, and returns null
 * whenever it cannot find a genuine fill. Recording nothing is safe; recording
 * a guess would corrupt the very history the behavioural rules judge.
 */

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

interface RawOrder {
  symbol?: unknown;
  side?: unknown;
  executedQty?: unknown;
  cummulativeQuoteQty?: unknown;
  orderId?: unknown;
  transactTime?: unknown;
  fills?: unknown;
}

/** An order response is recognised by the two fields only a fill report carries. */
function looksLikeOrder(v: unknown): v is RawOrder {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return "executedQty" in o && "cummulativeQuoteQty" in o;
}

/** Walk the value, unwrapping JSON strings and content arrays, until an order turns up. */
function findOrder(value: unknown, depth = 0): RawOrder | null {
  if (depth > 6 || value === null || value === undefined) return null;

  if (typeof value === "string") {
    try {
      return findOrder(JSON.parse(value) as unknown, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOrder(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  if (typeof value !== "object") return null;
  if (looksLikeOrder(value)) return value;

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = findOrder(nested, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

interface RawFillRow {
  commission?: unknown;
  commissionAsset?: unknown;
}

export function extractFill(toolResponse: unknown, now: number): Fill | null {
  const order = findOrder(toolResponse);
  if (order === null) return null;

  const quantity = num(order.executedQty);
  const quoteQty = num(order.cummulativeQuoteQty);
  const symbol = typeof order.symbol === "string" ? order.symbol : null;
  const side = order.side === "BUY" || order.side === "SELL" ? (order.side as Side) : null;

  // Nothing traded: a rejected or expired order leaves the history untouched.
  if (quantity === null || quoteQty === null || quantity <= 0 || symbol === null || side === null) {
    return null;
  }

  const rows = Array.isArray(order.fills) ? (order.fills as RawFillRow[]) : [];
  const fee = rows.reduce((sum, r) => sum + (num(r.commission) ?? 0), 0);
  const feeAsset = rows.find((r) => typeof r.commissionAsset === "string")?.commissionAsset;

  return {
    symbol,
    side,
    quantity,
    // Average price paid, which is what a cost basis needs — individual fill
    // prices differ across a partially filled market order.
    price: quoteQty / quantity,
    quoteQty,
    feeAsset: typeof feeAsset === "string" ? feeAsset : "",
    fee,
    orderId: order.orderId === undefined ? "" : String(order.orderId),
    ts: num(order.transactTime) ?? now,
  };
}
