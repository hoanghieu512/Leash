import { describe, expect, it } from "vitest";
import { parsePolicy } from "../../src/policy/load.js";

const VALID = `
profile: conservative
capital_usdt: 100

limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT, BNBUSDT]
  markets: [spot]

behavior:
  daily_loss_kill_switch_pct: 5
  revenge_cooldown_minutes: 15
  no_size_up_after_losses: 2
  require_reason: true
`;

describe("parsePolicy — valid file", () => {
  it("reads every field", () => {
    const p = parsePolicy(VALID);

    expect(p.profile).toBe("conservative");
    expect(p.capitalUsdt).toBe(100);
    expect(p.limits.maxNotionalPerOrder).toBe(15);
    expect(p.limits.maxOrdersPerHour).toBe(6);
    expect(p.limits.minSecondsBetweenOrders).toBe(60);
    expect(p.limits.symbolAllowlist).toEqual(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
    expect(p.limits.markets).toEqual(["spot"]);
    expect(p.behavior.dailyLossKillSwitchPct).toBe(5);
    expect(p.behavior.revengeCooldownMinutes).toBe(15);
    expect(p.behavior.noSizeUpAfterLosses).toBe(2);
    expect(p.behavior.requireReason).toBe(true);
  });

  it("uppercases symbols so a lowercase config still matches Binance", () => {
    const p = parsePolicy(VALID.replace("[BTCUSDT, ETHUSDT, BNBUSDT]", "[btcusdt, ethusdt]"));
    expect(p.limits.symbolAllowlist).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

describe("parsePolicy — rejections name the offending field", () => {
  it("rejects a missing capital_usdt", () => {
    const yaml = VALID.replace("capital_usdt: 100\n", "");
    expect(() => parsePolicy(yaml)).toThrow(/capital_usdt/);
  });

  it("rejects a negative order limit", () => {
    const yaml = VALID.replace("max_notional_per_order: 15", "max_notional_per_order: -5");
    expect(() => parsePolicy(yaml)).toThrow(/max_notional_per_order/);
  });

  it("rejects zero capital", () => {
    const yaml = VALID.replace("capital_usdt: 100", "capital_usdt: 0");
    expect(() => parsePolicy(yaml)).toThrow(/capital_usdt/);
  });

  it("rejects a market Leash does not support", () => {
    const yaml = VALID.replace("markets: [spot]", "markets: [futures]");
    expect(() => parsePolicy(yaml)).toThrow(/markets/);
  });

  it("rejects an empty symbol allowlist — an empty list reads as 'anything goes'", () => {
    const yaml = VALID.replace("symbol_allowlist: [BTCUSDT, ETHUSDT, BNBUSDT]", "symbol_allowlist: []");
    expect(() => parsePolicy(yaml)).toThrow(/symbol_allowlist/);
  });

  it("rejects a loss threshold over 100 percent", () => {
    const yaml = VALID.replace("daily_loss_kill_switch_pct: 5", "daily_loss_kill_switch_pct: 150");
    expect(() => parsePolicy(yaml)).toThrow(/daily_loss_kill_switch_pct/);
  });

  it("rejects broken YAML rather than guessing", () => {
    expect(() => parsePolicy("limits: [unclosed")).toThrow();
  });

  it("rejects an unknown field instead of silently ignoring a typo", () => {
    const yaml = VALID.replace("max_orders_per_hour: 6", "max_orders_per_hour: 6\n  max_order_per_hour: 99");
    expect(() => parsePolicy(yaml)).toThrow(/max_order_per_hour/);
  });
});

describe("the policy file shipped with the repo", () => {
  it("is valid — a broken sample would only surface at demo time", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");

    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const p = parsePolicy(readFileSync(join(root, "leash.policy.yaml"), "utf8"));

    expect(p.limits.markets).toEqual(["spot"]);
    expect(p.behavior.requireReason).toBe(true);
    expect(p.limits.maxNotionalPerOrder).toBeLessThanOrEqual(p.capitalUsdt);
  });
});
