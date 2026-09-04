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
          `Đang trong chuỗi ${num(state.lossStreak)} lệnh lỗ liên tiếp và không xác định được ` +
          `giá trị lệnh này, nên không thể khẳng định nó không lớn hơn ${num(ceiling)} USDT.`,
      };
    }

    if (intent.notionalUsdt <= ceiling) return null;

    return {
      rule: this.name,
      detail:
        `Đang trong chuỗi ${num(state.lossStreak)} lệnh lỗ liên tiếp. ` +
        `Lệnh ${num(intent.notionalUsdt)} USDT lớn hơn lệnh vừa lỗ (${num(ceiling)} USDT) — ` +
        `gấp size sau khi thua là cách nhanh nhất biến một ngày xấu thành tài khoản trống.`,
    };
  },
};
