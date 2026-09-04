import type { Rule } from "./types.js";

export const spotOnly: Rule = {
  name: "spot_only",
  check(intent, _state, policy) {
    const allowed = policy.limits.markets as readonly string[];

    // Fail closed. The server exposes 316 tools; recognising every safe one is
    // achievable, recognising every dangerous one is not — so anything the
    // adapter could not place is refused rather than waved through.
    if (intent.market === "unknown") {
      return {
        rule: this.name,
        detail:
          `Không nhận diện được tool "${intent.canonicalTool}" thuộc thị trường nào. ` +
          `Leash chỉ cho phép ${allowed.join(", ")}, và chặn mọi thứ chưa biết.`,
      };
    }

    if (!allowed.includes(intent.market)) {
      return {
        rule: this.name,
        detail:
          `Lệnh thuộc thị trường ${intent.market} (tool "${intent.canonicalTool}"), ` +
          `chỉ ${allowed.join(", ")} được phép.`,
      };
    }
    return null;
  },
};
