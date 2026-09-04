import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { decide, type HookDeps } from "../../src/hook/preToolUse.js";
import { saveState } from "../../src/state/store.js";
import { loadState } from "../../src/state/store.js";
import { T0 } from "../helpers.js";

let dir: string;
let deps: HookDeps;

const POLICY = `
profile: conservative
capital_usdt: 100
limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT]
  markets: [spot]
behavior:
  daily_loss_kill_switch_pct: 5
  revenge_cooldown_minutes: 15
  no_size_up_after_losses: 2
  require_reason: true
`;

const order = (input: Record<string, unknown>) => ({
  tool_name: "mcp__binance-mcp-server__spot_newOrder",
  tool_input: input,
});

function declare(notional: number) {
  const s = emptyState("2026-09-05", 100);
  saveState(deps.statePath, {
    ...s,
    tickets: [{ symbol: "BTCUSDT", side: "BUY", notionalUsdt: notional, reason: "declared", ts: T0, consumed: false }],
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-hook-"));
  writeFileSync(join(dir, "leash.policy.yaml"), POLICY, "utf8");
  deps = {
    policyPath: join(dir, "leash.policy.yaml"),
    statePath: join(dir, "state.json"),
    now: T0,
    fetchMarks: async () => ({ BTCUSDT: 81000 }),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("denials", () => {
  it("emits the exact shape Claude Code needs to block a call", async () => {
    declare(180);
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 180 }), deps);

    expect(out.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("max_notional_per_order");
  });

  it("blocks a futures order smuggled through tool_execute", async () => {
    const out = await decide(
      {
        tool_name: "mcp__binance-mcp-server__tool_execute",
        tool_input: { toolName: "futures_usds.newOrder", arguments: { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 10 } },
      },
      deps,
    );

    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("spot_only");
  });

  it("blocks a credential mint", async () => {
    const out = await decide(
      {
        tool_name: "mcp__binance-mcp-server__tool_execute",
        tool_input: { toolName: "margin.createSpecialKey", arguments: {} },
      },
      deps,
    );

    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("never_mint_credentials");
  });

  it("blocks when the policy file is missing rather than running unguarded", async () => {
    rmSync(deps.policyPath);
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 5 }), deps);

    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/leash\.policy\.yaml|luật/i);
  });

  it("blocks when the state file is corrupt", async () => {
    writeFileSync(deps.statePath, "{ broken", "utf8");
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 5 }), deps);

    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks garbage input instead of crashing", async () => {
    const out = await decide({ tool_name: 42, tool_input: "nonsense" } as never, deps);
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks when it runs out of time", async () => {
    declare(12);
    const slow: HookDeps = {
      ...deps,
      budgetMs: 10,
      fetchMarks: () => new Promise((r) => setTimeout(() => r({}), 80)),
    };
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), slow);

    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/thời gian|hết giờ/i);
  });
});

describe("allowances", () => {
  it("stays silent for a read — silence is how a hook says yes", async () => {
    const out = await decide(
      { tool_name: "mcp__binance-mcp-server__spot_ticker24hr", tool_input: { symbol: "BTCUSDT" } },
      deps,
    );

    expect(out).toEqual({});
  });

  it("stays silent for another server's tools", async () => {
    const out = await decide({ tool_name: "Bash", tool_input: { command: "ls" } }, deps);
    expect(out).toEqual({});
  });

  it("lets a declared, in-policy order through and burns its declaration", async () => {
    declare(12);
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), deps);

    expect(out).toEqual({});
    expect(loadState(deps.statePath, T0, 100).tickets[0]?.consumed).toBe(true);
  });

  it("refuses the same order a second time — one declaration, one order", async () => {
    declare(12);
    await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), deps);
    const second = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), deps);

    expect(second.hookSpecificOutput?.permissionDecisionReason).toContain("require_reason");
  });

  it("survives a dead price feed", async () => {
    declare(12);
    const offline: HookDeps = { ...deps, fetchMarks: async () => { throw new Error("no network"); } };
    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), offline);

    expect(out).toEqual({});
  });
});
