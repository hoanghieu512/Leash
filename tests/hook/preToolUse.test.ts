import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { decide, type HookDeps } from "../../src/hook/preToolUse.js";
import { saveState } from "../../src/state/store.js";
import { loadState } from "../../src/state/store.js";
import { readAudit } from "../../src/audit/report.js";
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

function declare(notional: number, opts: { withPosition?: boolean; lossStreak?: number } = {}) {
  const s = emptyState("2026-09-05", 100);
  saveState(deps.statePath, {
    ...s,
    ...(opts.lossStreak !== undefined ? { lossStreak: opts.lossStreak } : {}),
    ...(opts.withPosition === true
      ? { positions: { BTCUSDT: { symbol: "BTCUSDT", quantity: 0.001, avgCost: 90000 } } }
      : {}),
    tickets: [{ symbol: "BTCUSDT", side: "BUY", notionalUsdt: notional, reason: "declared", ts: T0, consumed: false }],
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-hook-"));
  writeFileSync(join(dir, "leash.policy.yaml"), POLICY, "utf8");
  deps = {
    policyPath: join(dir, "leash.policy.yaml"),
    statePath: join(dir, "state.json"),
    auditPath: join(dir, "audit.jsonl"),
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
    declare(12, { withPosition: true }); // an open position is what forces a price lookup
    // A fake clock the price lookup pushes past the budget — deterministic, no racing.
    let elapsed = 0;
    const slow: HookDeps = {
      ...deps,
      budgetMs: 10,
      clock: () => elapsed,
      fetchMarks: async () => { elapsed += 50; return {}; },
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

describe("audit trail", () => {
  it("records the denial, with the rule that caused it", async () => {
    await decide(order({ symbol: "PEPEUSDT", side: "BUY", quoteOrderQty: 5 }), deps);
    const { entries } = readAudit(deps.auditPath);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.verdict).toBe("DENY");
    expect(entries[0]?.rule).toBe("symbol_allowlist");
  });

  it("records what it let through, together with the reason the agent declared", async () => {
    declare(12);
    await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), deps);
    const { entries } = readAudit(deps.auditPath);

    expect(entries[0]?.verdict).toBe("ALLOW");
    expect(entries[0]?.agent_reason).toBe("declared");
  });

  it("writes nothing for a read — the trail is about decisions, not traffic", async () => {
    await decide(
      { tool_name: "mcp__binance-mcp-server__spot_ticker24hr", tool_input: { symbol: "BTCUSDT" } },
      deps,
    );
    expect(readAudit(deps.auditPath).entries).toHaveLength(0);
  });
});

describe("the trail must be complete", () => {
  it("records a timeout denial too — an unlogged block is a block nobody can audit", async () => {
    declare(12, { withPosition: true });
    let elapsed = 0;
    const slow: HookDeps = {
      ...deps,
      budgetMs: 10,
      clock: () => elapsed,
      fetchMarks: async () => { elapsed += 50; return {}; },
    };
    await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), slow);
    const { entries } = readAudit(deps.auditPath);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.verdict).toBe("DENY");
    expect(entries[0]?.rule).toBe("time_budget");
  });

  it("does not touch the network when there is nothing to price", async () => {
    declare(12);
    let called = false;
    const watched: HookDeps = {
      ...deps,
      fetchMarks: async () => { called = true; return { BTCUSDT: 81000 }; },
    };
    // No open positions, and the order states its own size in USDT.
    await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), watched);

    expect(called).toBe(false);
  });

  it("does reach for prices when a position needs marking to market", async () => {
    declare(12, { withPosition: true });
    let called = false;
    const watched: HookDeps = {
      ...deps,
      fetchMarks: async () => { called = true; return { BTCUSDT: 81000 }; },
    };
    await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), watched);

    expect(called).toBe(true);
  });
});

describe("tampering", () => {
  it("blocks everything and records it when state was edited outside Leash", async () => {
    declare(12, { lossStreak: 3 });
    const edited = JSON.parse(readFileSync(deps.statePath, "utf8")) as Record<string, unknown>;
    edited["lossStreak"] = 0; // the edit that would unlock martingale
    writeFileSync(deps.statePath, JSON.stringify(edited), "utf8");

    const out = await decide(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }), deps);

    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(readAudit(deps.auditPath).entries[0]?.rule).toBe("leash_unavailable");
    expect(readAudit(deps.auditPath).entries[0]?.detail).toMatch(/chữ ký|sửa/i);
  });
});
