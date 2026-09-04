import type { LeashState, Market, OrderIntent, Side } from "../domain/types.js";
import { MCP_PREFIX, TOOL_EXECUTE, TOOL_REGISTRY, type ToolFacts } from "./toolRegistry.js";

export interface HookPayload {
  tool_name?: unknown;
  tool_input?: unknown;
}

export interface AdapterContext {
  now: number;
  /** Mark prices in USDT, used only when the order does not carry its own price. */
  marks?: Record<string, number>;
}

/** Lower-cased registry, so a tool named in any casing still resolves. */
const REGISTRY_BY_LOWER = new Map(
  Object.entries(TOOL_REGISTRY).map(([name, facts]) => [name.toLowerCase(), { name, facts }]),
);

/**
 * "mcp__binance-mcp-server__spot_newOrder" -> "spot_newOrder"
 * "spot.newOrder"                          -> "spot_newOrder"
 *
 * Binance writes the same tool two ways depending on the route: underscores when
 * it is a first-class MCP tool, dots when it is named inside tool_execute.
 * Confirmed on 04/09 with a real filled order down each path.
 */
export function canonicalize(name: string): string {
  const bare = name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
  return bare.replaceAll(".", "_");
}

function lookup(canonical: string): { name: string; facts: ToolFacts } | undefined {
  // Exact, never substring: matching loosely would wave through any tool whose
  // name merely ends with a safe one.
  return REGISTRY_BY_LOWER.get(canonical.toLowerCase());
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // JSON and LLMs both like to send numbers as strings.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asSide(v: unknown): Side | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase();
  return s === "BUY" || s === "SELL" ? s : null;
}

/** USDT value of the order, or null when it genuinely cannot be worked out. */
function notionalOf(
  args: Record<string, unknown>,
  symbol: string | null,
  ctx: AdapterContext,
): number | null {
  const quote = asNumber(args["quoteOrderQty"]);
  if (quote !== null) return quote;

  const quantity = asNumber(args["quantity"]);
  if (quantity === null) return null;

  const price = asNumber(args["price"]);
  if (price !== null) return quantity * price;

  const mark = symbol === null ? undefined : ctx.marks?.[symbol.toUpperCase()];
  if (mark !== undefined) return quantity * mark;

  // No quote size, no limit price, no mark. Saying null here is what makes
  // max_notional refuse it; guessing would be worse than admitting ignorance.
  return null;
}

/**
 * Turn one hook payload into something the rules can judge.
 *
 * Returns null when the call is none of Leash's business — a read, or a tool
 * belonging to a different MCP server.
 */
export function toIntent(
  payload: HookPayload,
  state: LeashState,
  ctx: AdapterContext,
): OrderIntent | null {
  const rawToolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (!rawToolName.startsWith(MCP_PREFIX)) return null;

  const outer = canonicalize(rawToolName);
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;

  // Unwrap the back door: 237 of the server's 316 tools are reachable only this
  // way, and 56 of the 76 write tools are among them. A guard reading tool_name
  // alone sees nothing but "tool_execute".
  let canonicalTool = outer;
  let args = input;
  if (outer === TOOL_EXECUTE) {
    const inner = input["toolName"];
    canonicalTool = typeof inner === "string" ? canonicalize(inner) : "";
    args = (input["arguments"] ?? {}) as Record<string, unknown>;
  }

  const hit = lookup(canonicalTool);
  if (hit !== undefined && !hit.facts.writes) return null;

  const symbol = typeof args["symbol"] === "string" ? (args["symbol"] as string) : null;
  const side = asSide(args["side"]);
  const quantity = asNumber(args["quantity"]);
  const notionalUsdt = notionalOf(args, symbol, ctx);

  // Unrecognised tools are treated as orders on purpose: the order rules fail
  // closed, so an unknown write ends up refused rather than exempt.
  const facts: ToolFacts = hit?.facts ?? { market: "unknown", kind: "order", writes: true };

  return {
    kind: facts.kind,
    rawToolName,
    canonicalTool: hit?.name ?? canonicalTool,
    market: facts.market as Market,
    symbol,
    side,
    notionalUsdt,
    quantity,
    reduceOnly: isReduction(state, symbol, side, quantity),
    args,
    ts: ctx.now,
  };
}

/**
 * On spot, "reducing" means selling no more of a symbol than is currently held.
 * These orders survive the kill switch, so the test is deliberately strict: a
 * sell larger than the position is not a retreat.
 */
function isReduction(
  state: LeashState,
  symbol: string | null,
  side: Side | null,
  quantity: number | null,
): boolean {
  if (side !== "SELL" || symbol === null) return false;

  const pos = state.positions[symbol.toUpperCase()];
  if (pos === undefined || pos.quantity <= 0) return false;
  if (quantity === null) return true; // selling by quote value out of a held position

  return quantity <= pos.quantity * 1.0001; // tolerate rounding at the edge
}
