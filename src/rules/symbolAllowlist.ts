import type { Rule } from "./types.js";

export const symbolAllowlist: Rule = {
  name: "symbol_allowlist",
  check(intent, _state, policy) {
    const list = policy.limits.symbolAllowlist;

    if (intent.symbol === null) {
      return { rule: this.name, detail: `Order names no symbol. Allowed: ${list.join(", ")}.` };
    }

    const symbol = intent.symbol.toUpperCase();
    if (!list.includes(symbol)) {
      return {
        rule: this.name,
        detail: `${symbol} is not on the allowlist (${list.join(", ")}).`,
      };
    }
    return null;
  },
};
