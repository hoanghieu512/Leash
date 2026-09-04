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
          `Không xác định được giá trị lệnh nên không thể đối chiếu hạn mức ${num(limit)} USDT. ` +
          `Hãy nêu rõ quoteOrderQty (số USDT) hoặc cả quantity lẫn price.`,
      };
    }

    if (intent.notionalUsdt > limit) {
      return {
        rule: this.name,
        detail: `${num(intent.notionalUsdt)} USDT vượt hạn mức ${num(limit)} USDT mỗi lệnh.`,
      };
    }
    return null;
  },
};
