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
          `Tool "${intent.canonicalTool}" belongs to no market Leash recognises. ` +
          `Only ${allowed.join(", ")} is permitted, and anything unrecognised is refused.`,
      };
    }

    if (!allowed.includes(intent.market)) {
      return {
        rule: this.name,
        detail:
          `This order targets the ${intent.market} market (tool "${intent.canonicalTool}"). ` +
          `Only ${allowed.join(", ")} is permitted.`,
      };
    }
    return null;
  },
};
