import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../src/adapters/toolRegistry.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(ROOT, "agent", "WORKFLOW.md"), "utf8");

/** The four tools the Leash MCP server exposes. */
const LEASH_TOOLS = ["check_order", "budget_status", "why_blocked", "kill_switch"];

describe("agent/WORKFLOW.md", () => {
  it("names only Binance tools that actually exist", () => {
    // Every `spot_x` / `wallet_x` style name mentioned in the prose.
    const mentioned = [...workflow.matchAll(/`(spot|wallet|margin|futures_usds|futures_coin|convert)_[A-Za-z0-9_]+`/g)]
      .map((m) => m[0].replaceAll("`", ""));

    expect(mentioned.length).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(Object.keys(TOOL_REGISTRY), `${tool} is not a known Binance tool`).toContain(tool);
    }
  });

  it("names only Leash tools that actually exist", () => {
    const mentioned = [...workflow.matchAll(/`leash\.([a-z_]+)`/g)].map((m) => m[1] as string);

    expect(mentioned.length).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(LEASH_TOOLS, `leash.${tool} is not a Leash tool`).toContain(tool);
    }
  });

  it("tells the agent not to work around a refusal", () => {
    // The workflow is the agent's own account of how it behaves; if this
    // sentence goes missing, the submission quietly stops making its point.
    expect(workflow).toMatch(/never/i);
    expect(workflow).toContain("tool_execute");
  });

  it("makes no performance claim it cannot support", () => {
    expect(workflow).toMatch(/no proven edge|not presented as one/i);
    expect(workflow).toMatch(/no backtest is\s+claimed/i);
  });
});
