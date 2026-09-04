import { describe, expect, it } from "vitest";
import { allow, deny, emptyState, isDenied } from "../../src/domain/types.js";

describe("emptyState", () => {
  it("starts a day with no history and the switch off", () => {
    const s = emptyState("2026-09-05", 100);

    expect(s.dayStartUtc).toBe("2026-09-05");
    expect(s.dayStartEquity).toBe(100);
    expect(s.realizedPnlToday).toBe(0);
    expect(s.lossStreak).toBe(0);
    expect(s.positions).toEqual({});
    expect(s.recentOrders).toEqual([]);
    expect(s.closedTrades).toEqual([]);
    expect(s.tickets).toEqual([]);
    expect(s.killSwitch.manual).toBe(false);
  });

  it("hands back a fresh object each call, not a shared one", () => {
    const a = emptyState("2026-09-05", 100);
    const b = emptyState("2026-09-05", 100);
    a.recentOrders.push({ ts: 1, symbol: "BTCUSDT", notionalUsdt: 5 });

    expect(b.recentOrders).toEqual([]);
  });
});

describe("decisions", () => {
  it("carries the rule name and a human-readable detail when denying", () => {
    const d = deny("max_notional_per_order", "180 USDT vượt hạn mức 15 USDT mỗi lệnh", ["spot_only"]);

    expect(isDenied(d)).toBe(true);
    if (!isDenied(d)) throw new Error("unreachable");
    expect(d.rule).toBe("max_notional_per_order");
    expect(d.detail).toContain("15 USDT");
    expect(d.rulesEvaluated).toEqual(["spot_only"]);
  });

  it("records which rules ran even when allowing", () => {
    const d = allow(["spot_only", "max_notional_per_order"]);

    expect(isDenied(d)).toBe(false);
    expect(d.rulesEvaluated).toEqual(["spot_only", "max_notional_per_order"]);
  });
});
