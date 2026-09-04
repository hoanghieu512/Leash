/**
 * Core vocabulary shared by every Leash module.
 *
 * Everything here is data plus a few pure constructors. No I/O, no clock reads —
 * timestamps are always passed in, so rules stay testable.
 */

export type Side = "BUY" | "SELL";

/**
 * Which Binance product an intent targets.
 *
 * "unknown" is not a gap to be filled in later — it is the value every
 * unrecognised tool gets, and rules must deny on it (fail-closed). The tool
 * surface has 316 entries; recognising a safe subset is achievable, recognising
 * every dangerous one is not.
 */
export type Market = "spot" | "margin" | "futures" | "convert" | "wallet" | "unknown";

/** A single order the agent wants to place, normalised away from Binance's shapes. */
/**
 * Not every write is an order. A wallet transfer and a key mint must face the
 * hard rules, but asking symbol_allowlist to judge them would be nonsense — they
 * have no symbol. Anything unrecognised is classed as an order so the order
 * rules, which fail closed, get to refuse it.
 */
export type IntentKind = "order" | "non_order";

export interface OrderIntent {
  kind: IntentKind;
  /** Tool name exactly as the hook saw it, e.g. "mcp__binance-mcp-server__tool_execute". */
  rawToolName: string;
  /**
   * The tool that actually runs, unwrapped from tool_execute and normalised to
   * underscores: both "spot_newOrder" and "spot.newOrder" land here as
   * "spot_newOrder". This — not rawToolName — is what rules match on.
   */
  canonicalTool: string;
  market: Market;
  symbol: string | null;
  side: Side | null;
  /** Order size in USDT. null means "could not be determined" → rules must deny. */
  notionalUsdt: number | null;
  /** Size in base asset, when the agent expressed it that way. */
  quantity: number | null;
  /** True when this shrinks or closes an existing position. Such orders survive the kill switch. */
  reduceOnly: boolean;
  /**
   * The tool's own arguments, already unwrapped from tool_execute. Rules that
   * police non-order tools — a wallet transfer, a credential mint — read their
   * specifics from here rather than from fields invented on OrderIntent for
   * one caller's benefit.
   */
  args: Readonly<Record<string, unknown>>;
  ts: number;
}

/** A confirmed fill, used to move state forward. */
export interface Fill {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  quoteQty: number;
  feeAsset: string;
  fee: number;
  orderId: string;
  ts: number;
}

/** What the agent holds in one symbol, with a cost basis Leash computes itself. */
export interface Position {
  symbol: string;
  quantity: number;
  /** Average cost in USDT per unit, derived from recorded fills — never from Binance. */
  avgCost: number;
}

/** A position that was closed at a profit or a loss. */
export interface ClosedTrade {
  symbol: string;
  pnlUsdt: number;
  notionalUsdt: number;
  ts: number;
}

/** One order that went through, kept for rate limiting. */
export interface RecentOrder {
  ts: number;
  symbol: string;
  notionalUsdt: number;
}

/**
 * An intent the agent declared through leash.check_order before placing it.
 * Without a matching ticket, an order is denied — this is what makes
 * require_reason enforceable at all.
 */
export interface CheckTicket {
  symbol: string;
  side: Side;
  notionalUsdt: number;
  reason: string;
  ts: number;
  consumed: boolean;
}

export interface KillSwitch {
  /** Flipped by hand, through the dashboard or the MCP tool. */
  manual: boolean;
  /** Set when the daily loss threshold tripped; cleared at the next UTC day. */
  trippedAt?: number;
}

export interface LeashState {
  /** UTC calendar day this state describes, "YYYY-MM-DD". */
  dayStartUtc: string;
  /** Sub-account equity in USDT at the start of that day — the base for the loss threshold. */
  dayStartEquity: number;
  realizedPnlToday: number;
  positions: Record<string, Position>;
  recentOrders: RecentOrder[];
  /** Most recent first. */
  closedTrades: ClosedTrade[];
  /** Consecutive losing closes. Reset by a winning close. */
  lossStreak: number;
  tickets: CheckTicket[];
  killSwitch: KillSwitch;
}

export type Decision =
  | { verdict: "ALLOW"; rulesEvaluated: string[] }
  | { verdict: "DENY"; rule: string; detail: string; rulesEvaluated: string[] };

export function emptyState(dayStartUtc: string, dayStartEquity: number): LeashState {
  return {
    dayStartUtc,
    dayStartEquity,
    realizedPnlToday: 0,
    positions: {},
    recentOrders: [],
    closedTrades: [],
    lossStreak: 0,
    tickets: [],
    killSwitch: { manual: false },
  };
}

export function allow(rulesEvaluated: string[]): Decision {
  return { verdict: "ALLOW", rulesEvaluated };
}

/**
 * @param detail written for a person to read — it is what the agent sees and
 * what ends up on screen in the demo, so it names numbers, not error codes.
 */
export function deny(rule: string, detail: string, rulesEvaluated: string[]): Decision {
  return { verdict: "DENY", rule, detail, rulesEvaluated };
}

export function isDenied(
  d: Decision,
): d is { verdict: "DENY"; rule: string; detail: string; rulesEvaluated: string[] } {
  return d.verdict === "DENY";
}
