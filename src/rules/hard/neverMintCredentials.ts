import type { HardRule } from "../types.js";

/**
 * Four tools on the Binance MCP surface mint or reshape API keys. A key created
 * this way does not travel through the MCP server, so every guard that lives on
 * the MCP path — Leash included — stops applying to it. Permanently, and even
 * after the agent is switched off.
 *
 * That makes this the one thing an agent must never be able to do, above even
 * moving funds: moving funds is reversible, handing itself a key that outlives
 * its supervision is not.
 *
 * Note the missing policy parameter. It is missing on purpose.
 */
const CREDENTIAL_TOOLS: readonly string[] = [
  "margin_createSpecialKey",
  "margin_editIpForSpecialKey",
  "margin_deleteSpecialKey",
  "margin_exitSpecialKeyMode",
];

export const neverMintCredentials: HardRule = {
  name: "never_mint_credentials",
  check(intent, _ctx) {
    if (!CREDENTIAL_TOOLS.includes(intent.canonicalTool)) return null;

    return {
      rule: "never_mint_credentials",
      detail:
        `Tool "${intent.canonicalTool}" creates or alters an API key. A key minted this way no longer ` +
        `travels through the MCP server, so every Leash guard stops applying to it — permanently, and ` +
        `even after the agent is switched off. This is a hard rule: it is not in the config file and ` +
        `cannot be turned off.`,
    };
  },
};
