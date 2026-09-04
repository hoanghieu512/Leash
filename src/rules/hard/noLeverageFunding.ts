import type { HardRule } from "../types.js";

/**
 * Exactly one tool in the 316 can move assets between wallets:
 * wallet_userUniversalTransfer. Blocking leveraged *orders* while leaving the
 * funding route open would be locking the door and opening the gate — the agent
 * could park capital in the futures wallet and act there.
 *
 * Direction matters. Money flowing back to spot or funding is a retreat and
 * stays open; closing it would trap the user's own capital.
 *
 * Allowed destinations are recognised by suffix rather than by parsing the type,
 * because Binance transfer types are not consistently two-part
 * ("MAIN_PORTFOLIO_MARGIN"). Anything not recognised is refused.
 */
const SAFE_DESTINATION_SUFFIXES: readonly string[] = ["_MAIN", "_FUNDING"];

export const noLeverageFunding: HardRule = {
  name: "no_leverage_funding",
  check(intent, _ctx) {
    if (intent.canonicalTool !== "wallet_userUniversalTransfer") return null;

    const type = intent.args["type"];
    if (typeof type !== "string" || type.length === 0) {
      return {
        rule: "no_leverage_funding",
        detail:
          `This wallet transfer states no "type", so its destination cannot be determined. ` +
          `Leash refuses any transfer whose destination it cannot read.`,
      };
    }

    const upper = type.toUpperCase();
    if (SAFE_DESTINATION_SUFFIXES.some((s) => upper.endsWith(s))) return null;

    return {
      rule: "no_leverage_funding",
      detail:
        `Transfer "${type}" moves funds out of the Spot wallet into a leveraged one. ` +
        `Only the reverse direction is allowed (back to Spot or Funding). ` +
        `This is a hard rule and cannot be turned off by configuration.`,
    };
  },
};
