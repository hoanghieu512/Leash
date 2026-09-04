import type { Rule } from "./types.js";
import { num } from "./types.js";

/**
 * The martingale brake: after a run of losses, the next order may not be larger
 * than the one that just lost.
 *
 * "Double after a loss" is the most reliable way an automated system turns a bad
 * afternoon into a closed account, and it is exactly what an agent asked to
 * "make it back" will reach for.
 */
export const noSizeUpAfterLosses: Rule = {
  name: "no_size_up_after_losses",
  check(intent, state, policy, ctx) {
    if (intent.reduceOnly) return null;
    if (state.lossStreak < policy.behavior.noSizeUpAfterLosses) return null;

    const lastLoss = state.closedTrades.find((t) => t.pnlUsdt < 0);
    if (lastLoss === undefined) return null;

    const ceiling = lastLoss.notionalUsdt;

    if (intent.notionalUsdt === null) {
      return {
        rule: this.name,
        detail:
          `${num(state.lossStreak)} losing trades in a row, and this order's size could not be ` +
          `determined — so it cannot be shown to be no larger than ${num(ceiling)} USDT.`,
      };
    }

    if (intent.notionalUsdt <= ceiling) return null;

    return {
      rule: this.name,
      detail:
        `${num(state.lossStreak)} losing trades in a row. This ${num(intent.notionalUsdt)} USDT order ` +
        `is larger than the one that just lost (${num(ceiling)} USDT) — sizing up after a loss is the ` +
        `fastest way to turn a bad afternoon into an empty account.`,
    };
  },
};
