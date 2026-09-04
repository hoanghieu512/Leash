import type { CheckTicket, Fill, LeashState, OrderIntent, Position, RecentOrder } from "../domain/types.js";

/** How long a fill stays interesting for rate limiting. */
const ORDER_HISTORY_MS = 2 * 60 * 60 * 1000;
/** Cap on closed-trade history so state.json cannot grow without bound. */
const CLOSED_TRADE_HISTORY = 50;
/** Below this, a position is dust and counts as closed. */
const DUST = 1e-12;

/** "YYYY-MM-DD" in UTC. The day boundary for the loss threshold. */
export function dayKeyUtc(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** BTCUSDT -> { base: "BTC", quote: "USDT" }. */
export function splitSymbol(symbol: string): { base: string; quote: string } | null {
  for (const quote of ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"]) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) {
      return { base: symbol.slice(0, -quote.length), quote };
    }
  }
  return null;
}

/**
 * Fold one confirmed fill into state. Pure: no clock, no disk — `fill.ts` is the
 * only notion of "now".
 *
 * Cost basis is computed here rather than read back from Binance, because the
 * sub-account can also be traded by hand; only fills Leash witnessed are ours to
 * reason about.
 */
export function applyFill(state: LeashState, fill: Fill): LeashState {
  const parts = splitSymbol(fill.symbol);
  const feeInBase = parts !== null && fill.feeAsset === parts.base;
  const feeInQuote = parts !== null && fill.feeAsset === parts.quote;

  const positions: Record<string, Position> = { ...state.positions };
  const existing = positions[fill.symbol];

  let realizedPnlToday = state.realizedPnlToday;
  let lossStreak = state.lossStreak;
  let closedTrades = state.closedTrades;

  if (fill.side === "BUY") {
    // A base-asset fee never lands in the account, so it never enters the position.
    const received = feeInBase ? fill.quantity - fill.fee : fill.quantity;
    const spent = fill.quoteQty;
    const oldQty = existing?.quantity ?? 0;
    const oldCost = (existing?.avgCost ?? 0) * oldQty;
    const newQty = oldQty + received;

    positions[fill.symbol] = {
      symbol: fill.symbol,
      quantity: newQty,
      avgCost: newQty > DUST ? (oldCost + spent) / newQty : 0,
    };
  } else if (existing !== undefined && existing.quantity > DUST) {
    const sold = Math.min(fill.quantity, existing.quantity);
    const proceeds = fill.quoteQty * (sold / fill.quantity) - (feeInQuote ? fill.fee : 0);
    const pnl = proceeds - existing.avgCost * sold;

    realizedPnlToday += pnl;
    // A flat close leaves the streak where it was: it is neither a loss to count
    // nor a win to forgive.
    if (pnl < 0) lossStreak += 1;
    else if (pnl > 0) lossStreak = 0;

    closedTrades = [
      { symbol: fill.symbol, pnlUsdt: pnl, notionalUsdt: proceeds, ts: fill.ts },
      ...state.closedTrades,
    ].slice(0, CLOSED_TRADE_HISTORY);

    const left = existing.quantity - sold;
    if (left > DUST) positions[fill.symbol] = { ...existing, quantity: left };
    else delete positions[fill.symbol];
  }
  // A sell with no recorded position is ignored on purpose: inventing a cost
  // basis would fabricate a P&L number that later rules would act on.

  const order: RecentOrder = { ts: fill.ts, symbol: fill.symbol, notionalUsdt: fill.quoteQty };
  const recentOrders = [...state.recentOrders, order].filter(
    (o) => fill.ts - o.ts < ORDER_HISTORY_MS,
  );

  return { ...state, positions, realizedPnlToday, lossStreak, closedTrades, recentOrders };
}

/**
 * Start a new UTC day when `now` has crossed midnight.
 *
 * Reset: the daily P&L, the equity baseline, and a kill switch that tripped on
 * losses. Kept: positions, cost basis, and the losing streak — a streak is a
 * behavioural fact about the agent, not a calendar entry. A manually flipped
 * kill switch also stays: only the person who set it should clear it.
 */
export function rollDayIfNeeded(state: LeashState, now: number, equityNow: number): LeashState {
  const today = dayKeyUtc(now);
  if (today === state.dayStartUtc) return state;

  return {
    ...state,
    dayStartUtc: today,
    dayStartEquity: equityNow,
    realizedPnlToday: 0,
    killSwitch: { manual: state.killSwitch.manual },
  };
}

/**
 * How long a declared intent stays valid. Long enough for the agent to think
 * between declaring and placing, short enough that it cannot declare a batch of
 * intentions in the morning and trade off them all afternoon.
 */
export const TICKET_TTL_MS = 120_000;

/** Agents round differently when they declare than when they place. */
const NOTIONAL_TOLERANCE = 0.05;

function ticketMatches(t: CheckTicket, intent: OrderIntent, now: number): boolean {
  if (t.consumed) return false;
  if (now - t.ts > TICKET_TTL_MS) return false;
  if (intent.symbol === null || t.symbol.toUpperCase() !== intent.symbol.toUpperCase()) return false;
  if (t.side !== intent.side) return false;
  if (t.reason.trim().length === 0) return false;
  if (intent.notionalUsdt === null) return false;

  const drift = Math.abs(intent.notionalUsdt - t.notionalUsdt) / Math.max(t.notionalUsdt, 1e-9);
  return drift <= NOTIONAL_TOLERANCE;
}

/** The declaration that authorises this order, if the agent made one. */
export function findMatchingTicket(
  state: LeashState,
  intent: OrderIntent,
  now: number,
): CheckTicket | undefined {
  return state.tickets.find((t) => ticketMatches(t, intent, now));
}

/** Record an intent declared through leash.check_order, dropping expired ones. */
export function addTicket(state: LeashState, ticket: CheckTicket, now: number): LeashState {
  const live = state.tickets.filter((t) => now - t.ts <= TICKET_TTL_MS && !t.consumed);
  return { ...state, tickets: [ticket, ...live].slice(0, 20) };
}

/** Burn the declaration this order used, so it cannot authorise a second one. */
export function consumeTicket(state: LeashState, intent: OrderIntent, now: number): LeashState {
  const match = findMatchingTicket(state, intent, now);
  if (match === undefined) return state;

  return {
    ...state,
    tickets: state.tickets.map((t) => (t === match ? { ...t, consumed: true } : t)),
  };
}
