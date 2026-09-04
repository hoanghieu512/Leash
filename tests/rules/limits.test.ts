import { describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { maxNotional } from "../../src/rules/maxNotional.js";
import { rateLimit } from "../../src/rules/rateLimit.js";
import { spotOnly } from "../../src/rules/spotOnly.js";
import { symbolAllowlist } from "../../src/rules/symbolAllowlist.js";
import { T0, intent, policy } from "../helpers.js";

const S = emptyState("2026-09-05", 100);
const ctx = { now: T0 };

describe("max_notional_per_order", () => {
  it("lets a small order through", () => {
    expect(maxNotional.check(intent({ notionalUsdt: 12 }), S, policy(), ctx)).toBeNull();
  });

  it("allows an order exactly at the limit", () => {
    expect(maxNotional.check(intent({ notionalUsdt: 15 }), S, policy(), ctx)).toBeNull();
  });

  it("blocks an oversized order and says both numbers", () => {
    const v = maxNotional.check(intent({ notionalUsdt: 180 }), S, policy(), ctx);

    expect(v?.rule).toBe("max_notional_per_order");
    expect(v?.detail).toContain("180");
    expect(v?.detail).toContain("15");
  });

  it("blocks an order whose size could not be determined", () => {
    // An unknown size is not a small size.
    expect(maxNotional.check(intent({ notionalUsdt: null }), S, policy(), ctx)).not.toBeNull();
  });
});

describe("symbol_allowlist", () => {
  it("allows a listed symbol", () => {
    expect(symbolAllowlist.check(intent({ symbol: "BTCUSDT" }), S, policy(), ctx)).toBeNull();
  });

  it("is case-insensitive about how the agent typed it", () => {
    expect(symbolAllowlist.check(intent({ symbol: "btcusdt" }), S, policy(), ctx)).toBeNull();
  });

  it("blocks a symbol nobody put on the list", () => {
    const v = symbolAllowlist.check(intent({ symbol: "PEPEUSDT" }), S, policy(), ctx);
    expect(v?.rule).toBe("symbol_allowlist");
    expect(v?.detail).toContain("PEPEUSDT");
  });

  it("blocks an order with no symbol at all", () => {
    expect(symbolAllowlist.check(intent({ symbol: null }), S, policy(), ctx)).not.toBeNull();
  });
});

describe("spot_only", () => {
  it("allows spot", () => {
    expect(spotOnly.check(intent({ market: "spot" }), S, policy(), ctx)).toBeNull();
  });

  it("blocks futures", () => {
    const v = spotOnly.check(
      intent({ market: "futures", canonicalTool: "futures_usds_newOrder" }), S, policy(), ctx,
    );
    expect(v?.rule).toBe("spot_only");
    expect(v?.detail).toContain("futures");
  });

  it("blocks margin", () => {
    expect(spotOnly.check(intent({ market: "margin" }), S, policy(), ctx)).not.toBeNull();
  });

  it("blocks a tool it has never seen — an unrecognised market is a denial, not a gap", () => {
    const v = spotOnly.check(
      intent({ market: "unknown", canonicalTool: "some_new_tool" }), S, policy(), ctx,
    );
    expect(v).not.toBeNull();
    expect(v?.detail).toContain("some_new_tool");
  });
});

describe("rate_limit", () => {
  const withOrders = (times: number[]) => ({
    ...S,
    recentOrders: times.map((ts) => ({ ts, symbol: "BTCUSDT", notionalUsdt: 5 })),
  });

  it("allows the sixth order in an hour", () => {
    const five = [1, 2, 3, 4, 5].map((i) => T0 - i * 5 * 60_000);
    expect(rateLimit.check(intent(), withOrders(five), policy(), ctx)).toBeNull();
  });

  it("blocks the seventh", () => {
    const six = [2, 3, 4, 5, 6, 7].map((i) => T0 - i * 5 * 60_000);
    const v = rateLimit.check(intent(), withOrders(six), policy(), ctx);

    expect(v?.rule).toBe("rate_limit");
    expect(v?.detail).toContain("6");
  });

  it("forgets orders older than an hour", () => {
    const old = [1, 2, 3, 4, 5, 6].map((i) => T0 - 61 * 60_000 - i * 1000);
    expect(rateLimit.check(intent(), withOrders(old), policy(), ctx)).toBeNull();
  });

  it("blocks an order fired seconds after the last one", () => {
    const v = rateLimit.check(intent(), withOrders([T0 - 30_000]), policy(), ctx);

    expect(v?.rule).toBe("rate_limit");
    expect(v?.detail).toContain("60");
  });

  it("allows one placed after the cooldown", () => {
    expect(rateLimit.check(intent(), withOrders([T0 - 61_000]), policy(), ctx)).toBeNull();
  });
});
