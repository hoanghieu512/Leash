import type { Rule } from "./types.js";
import { num } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Two limits with one purpose: a broken loop that fires orders as fast as the
 * API allows burns the account in fees long before any strategy is wrong.
 */
export const rateLimit: Rule = {
  name: "rate_limit",
  check(intent, state, policy, ctx) {
    const lastTs = state.recentOrders.reduce((max, o) => Math.max(max, o.ts), 0);
    const gapSeconds = (ctx.now - lastTs) / 1000;
    const minGap = policy.limits.minSecondsBetweenOrders;

    if (lastTs > 0 && gapSeconds < minGap) {
      return {
        rule: this.name,
        detail:
          `The previous order was ${Math.round(gapSeconds)}s ago; orders must be at least ` +
          `${num(minGap)}s apart.`,
      };
    }

    const inLastHour = state.recentOrders.filter((o) => ctx.now - o.ts < HOUR_MS).length;
    const max = policy.limits.maxOrdersPerHour;
    if (inLastHour >= max) {
      return {
        rule: this.name,
        detail: `${inLastHour} orders placed in the last hour; the limit is ${num(max)}.`,
      };
    }
    return null;
  },
};
