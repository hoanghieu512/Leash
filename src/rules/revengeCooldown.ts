import type { Rule } from "./types.js";
import { num } from "./types.js";

/**
 * Stops the agent walking straight back into the symbol that just took money
 * off it — the trade people make out of irritation rather than analysis.
 *
 * Scoped to that one symbol. A losing BTC trade says nothing about ETH, and
 * freezing the whole account would punish the portfolio for one position.
 */
export const revengeCooldown: Rule = {
  name: "revenge_cooldown",
  check(intent, state, policy, ctx) {
    if (intent.reduceOnly || intent.symbol === null) return null;

    const cooldownMs = policy.behavior.revengeCooldownMinutes * 60_000;
    if (cooldownMs === 0) return null;

    const symbol = intent.symbol.toUpperCase();
    const lastLoss = state.closedTrades.find((t) => t.symbol.toUpperCase() === symbol && t.pnlUsdt < 0);
    if (lastLoss === undefined) return null;

    const elapsed = ctx.now - lastLoss.ts;
    if (elapsed >= cooldownMs) return null;

    const waitMinutes = Math.ceil((cooldownMs - elapsed) / 60_000);
    return {
      rule: this.name,
      detail:
        `${symbol} was closed at a loss ${Math.floor(elapsed / 60_000)} minutes ago. ` +
        `Wait another ${num(waitMinutes)} minutes before re-entering this symbol. ` +
        `Other symbols are unaffected.`,
    };
  },
};
