import { findMatchingTicket } from "../state/reduce.js";
import type { Rule } from "./types.js";
import { num } from "./types.js";

/**
 * Every order must be preceded by a declaration of intent.
 *
 * This cannot be enforced on the order payload itself: Binance's order schema
 * has no field for a reason, and inventing one would be ignored by the exchange.
 * So the rule looks for a matching leash.check_order made in the last two
 * minutes — which is what turns the Leash MCP server from a courtesy the agent
 * may consult into a gate it must pass through.
 *
 * The refusal is written as directions rather than a scolding: the agent reads
 * it mid-session and can correct itself on the next attempt.
 */
export const requireReason: Rule = {
  name: "require_reason",
  check(intent, state, policy, ctx) {
    if (!policy.behavior.requireReason) return null;
    if (findMatchingTicket(state, intent, ctx.now) !== undefined) return null;

    const size = intent.notionalUsdt === null ? "<usdt amount>" : num(intent.notionalUsdt);
    const symbol = intent.symbol ?? "<symbol>";
    const side = intent.side ?? "<BUY|SELL>";

    return {
      rule: this.name,
      detail:
        `This order was not declared. Call leash.check_order(symbol="${symbol}", side="${side}", ` +
        `notional=${size}, reason="...") with your reasoning, then place the order within 2 minutes. ` +
        `Each declaration covers exactly one order.`,
    };
  },
};
