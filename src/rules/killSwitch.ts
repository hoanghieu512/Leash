import type { Rule } from "./types.js";

/**
 * The switch a person flips by hand, from the dashboard or the MCP tool.
 *
 * Like the daily loss breaker it stops opening, not closing: an emergency stop
 * that also blocks the exit is not a safety feature.
 */
export const killSwitch: Rule = {
  name: "kill_switch",
  check(intent, state) {
    if (intent.reduceOnly) return null;
    if (!state.killSwitch.manual) return null;

    return {
      rule: this.name,
      detail:
        `The kill switch is on. No new or larger position may be opened until someone turns ` +
        `it off. Orders that close a position still go through.`,
    };
  },
};
