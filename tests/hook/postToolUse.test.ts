import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { record, type PostHookDeps } from "../../src/hook/postToolUse.js";
import { loadState, saveState } from "../../src/state/store.js";
import { readAudit } from "../../src/audit/report.js";
import { T0 } from "../helpers.js";

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

const BUY_RESPONSE = {
  symbol: "BTCUSDT",
  orderId: 66234582804,
  transactTime: T0,
  executedQty: "0.00014000",
  cummulativeQuoteQty: "11.34860160",
  status: "FILLED",
  side: "BUY",
  fills: [{ price: "81061.44", qty: "0.00014000", commission: "0.00000014", commissionAsset: "BTC" }],
};

let dir: string;
let deps: PostHookDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-post-"));
  writeFileSync(join(dir, "leash.policy.yaml"), POLICY, "utf8");
  deps = {
    policyPath: join(dir, "leash.policy.yaml"),
    statePath: join(dir, "state.json"),
    auditPath: join(dir, "audit.jsonl"),
    now: T0,
  };
  saveState(deps.statePath, emptyState("2026-09-05", 100));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (response: unknown, tool = "spot_newOrder") => ({
  tool_name: `mcp__binance-mcp-server__${tool}`,
  tool_input: { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 },
  tool_response: response,
});

describe("recording a real fill", () => {
  it("makes the rate limit counter move, which is what was broken", () => {
    record(call(BUY_RESPONSE), deps);
    const s = loadState(deps.statePath, T0, 100);

    expect(s.recentOrders).toHaveLength(1);
    expect(s.recentOrders[0]?.symbol).toBe("BTCUSDT");
    expect(s.recentOrders[0]?.notionalUsdt).toBeCloseTo(11.3486016, 6);
  });

  it("opens a position with a cost basis, net of the base-asset fee", () => {
    record(call(BUY_RESPONSE), deps);
    const pos = loadState(deps.statePath, T0, 100).positions.BTCUSDT;

    expect(pos?.quantity).toBeCloseTo(0.00013986, 10);
    expect(pos?.avgCost).toBeGreaterThan(80000);
  });

  it("books a loss and starts a losing streak when a sell closes below cost", () => {
    record(call(BUY_RESPONSE), deps);
    record(
      {
        tool_name: "mcp__binance-mcp-server__spot_newOrder",
        tool_input: { symbol: "BTCUSDT", side: "SELL", quantity: 0.00013986 },
        tool_response: {
          symbol: "BTCUSDT",
          orderId: 2,
          transactTime: T0 + 60_000,
          executedQty: "0.00013986",
          cummulativeQuoteQty: "10.00000000",
          status: "FILLED",
          side: "SELL",
          fills: [{ price: "71500", qty: "0.00013986", commission: "0.01", commissionAsset: "USDT" }],
        },
      },
      deps,
    );
    const s = loadState(deps.statePath, T0, 100);

    expect(s.realizedPnlToday).toBeLessThan(0);
    expect(s.lossStreak).toBe(1);
    expect(s.closedTrades).toHaveLength(1);
  });

  it("counts a fill that arrived through tool_execute", () => {
    record(
      {
        tool_name: "mcp__binance-mcp-server__tool_execute",
        tool_input: { toolName: "spot.newOrder", arguments: { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 } },
        tool_response: BUY_RESPONSE,
      },
      deps,
    );

    expect(loadState(deps.statePath, T0, 100).recentOrders).toHaveLength(1);
  });
});

describe("recording nothing when there is nothing to record", () => {
  it("ignores an order that did not fill", () => {
    record(call({ ...BUY_RESPONSE, executedQty: "0.00000000", status: "EXPIRED" }), deps);
    expect(loadState(deps.statePath, T0, 100).recentOrders).toHaveLength(0);
  });

  it("ignores an exchange error", () => {
    record(call({ code: -1013, msg: "Filter failure: NOTIONAL" }), deps);
    expect(loadState(deps.statePath, T0, 100).recentOrders).toHaveLength(0);
  });

  it("ignores a market data read", () => {
    record(call({ symbol: "BTCUSDT", price: "79902.69" }, "spot_ticker24hr"), deps);
    expect(loadState(deps.statePath, T0, 100).recentOrders).toHaveLength(0);
  });

  it("ignores another server's tool", () => {
    record({ tool_name: "Bash", tool_input: {}, tool_response: BUY_RESPONSE }, deps);
    expect(loadState(deps.statePath, T0, 100).recentOrders).toHaveLength(0);
  });
});

describe("failing safely", () => {
  it("never throws when the policy file is gone", () => {
    rmSync(deps.policyPath);
    expect(() => record(call(BUY_RESPONSE), deps)).not.toThrow();
  });

  it("leaves a trace when a fill could not be recorded", () => {
    writeFileSync(deps.statePath, "{ corrupt", "utf8");
    record(call(BUY_RESPONSE), deps);

    expect(readAudit(deps.auditPath).entries[0]?.rule).toBe("fill_not_recorded");
  });
});
