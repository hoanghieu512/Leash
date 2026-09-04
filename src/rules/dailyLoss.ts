import type { LeashState } from "../domain/types.js";
import type { Rule, RuleContext } from "./types.js";
import { num } from "./types.js";

/** Realised P&L plus, where a mark price exists, the open positions' unrealised P&L. */
function pnlToday(state: LeashState, ctx: RuleContext): { pnl: number; marksMissing: boolean } {
  let unrealized = 0;
  let marksMissing = false;

  for (const pos of Object.values(state.positions)) {
    const mark = ctx.marks?.[pos.symbol];
    if (mark === undefined) marksMissing = true;
    else unrealized += (mark - pos.avgCost) * pos.quantity;
  }

  return { pnl: state.realizedPnlToday + unrealized, marksMissing };
}

/**
 * The circuit breaker for a bad day.
 *
 * Measured against the equity the day opened with, not against a static figure
 * in the config, so the threshold tracks the account rather than the file.
 *
 * Once tripped it blocks opening and adding, never closing. Locking an agent out
 * of its own exits would trap the user's capital in whatever position the bad
 * day left behind.
 */
export const dailyLoss: Rule = {
  name: "daily_loss_kill_switch",
  check(intent, state, policy, ctx) {
    if (intent.reduceOnly) return null;

    const { pnl, marksMissing } = pnlToday(state, ctx);
    if (pnl >= 0) return null;

    const lossPct = (-pnl / state.dayStartEquity) * 100;
    const limit = policy.behavior.dailyLossKillSwitchPct;
    if (lossPct <= limit) return null;

    const caveat = marksMissing
      ? " (unrealised P&L could not be priced, so the real figure may be worse)"
      : "";

    return {
      rule: this.name,
      detail:
        `Down ${num(lossPct)}% today against opening equity of ${num(state.dayStartEquity)} USDT, ` +
        `past the ${num(limit)}% threshold${caveat}. Opening is locked until 00:00 UTC — ` +
        `orders that close a position are still allowed.`,
    };
  },
};
