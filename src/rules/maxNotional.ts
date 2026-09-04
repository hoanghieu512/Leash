import type { Rule } from "./types.js";
import { num } from "./types.js";

export const maxNotional: Rule = {
  name: "max_notional_per_order",
  check(intent, _state, policy) {
    const limit = policy.limits.maxNotionalPerOrder;

    // An unknown size is not a small size. If the adapter could not work out what
    // this order is worth, nobody downstream can judge it either.
    if (intent.notionalUsdt === null) {
      return {
        rule: this.name,
        detail:
          `Order size could not be determined, so it cannot be checked against the ` +
          `${num(limit)} USDT per-order limit. State quoteOrderQty, or both quantity and price.`,
      };
    }

    if (intent.notionalUsdt > limit) {
      return {
        rule: this.name,
        detail: `${num(intent.notionalUsdt)} USDT exceeds the ${num(limit)} USDT per-order limit.`,
      };
    }
    return null;
  },
};
