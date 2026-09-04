import { describe, expect, it } from "vitest";
import { emptyState, type Fill } from "../../src/domain/types.js";
import { applyFill, dayKeyUtc, rollDayIfNeeded } from "../../src/state/reduce.js";

const T0 = Date.UTC(2026, 8, 5, 10, 0, 0); // 2026-09-05T10:00:00Z

function buy(quantity: number, price: number, opts: Partial<Fill> = {}): Fill {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity,
    price,
    quoteQty: quantity * price,
    feeAsset: "BTC",
    fee: quantity * 0.001,
    orderId: "1",
    ts: T0,
    ...opts,
  };
}

function sell(quantity: number, price: number, opts: Partial<Fill> = {}): Fill {
  return {
    symbol: "BTCUSDT",
    side: "SELL",
    quantity,
    price,
    quoteQty: quantity * price,
    feeAsset: "USDT",
    fee: quantity * price * 0.001,
    orderId: "2",
    ts: T0,
    ...opts,
  };
}

describe("cost basis", () => {
  it("averages two buys at different prices", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, buy(1, 200, { fee: 0 }));

    expect(s.positions.BTCUSDT?.quantity).toBeCloseTo(2, 10);
    expect(s.positions.BTCUSDT?.avgCost).toBeCloseTo(150, 10);
  });

  it("credits only what survived the fee when the fee is charged in the base asset", () => {
    // Real observation 04/09: a 0.00014 BTC buy charged 0.00000014 BTC in fees,
    // leaving 0.00013986. Ignoring this makes a later "sell everything" fail.
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(0.00014, 81061.44, { fee: 0.00000014 }));

    expect(s.positions.BTCUSDT?.quantity).toBeCloseTo(0.00013986, 12);
  });
});

describe("closing trades", () => {
  it("books a loss and lengthens the losing streak", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 90, { fee: 0 }));

    expect(s.realizedPnlToday).toBeCloseTo(-10, 10);
    expect(s.lossStreak).toBe(1);
    expect(s.closedTrades[0]?.pnlUsdt).toBeCloseTo(-10, 10);
    expect(s.positions.BTCUSDT).toBeUndefined();
  });

  it("books a win and clears the streak", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 90, { fee: 0 }));
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 130, { fee: 0 }));

    expect(s.lossStreak).toBe(0);
    expect(s.realizedPnlToday).toBeCloseTo(20, 10);
  });

  it("counts a streak step by step across two losses and a win", () => {
    let s = emptyState("2026-09-05", 100);
    const steps: number[] = [];
    for (const price of [90, 80, 130]) {
      s = applyFill(s, buy(1, 100, { fee: 0 }));
      s = applyFill(s, sell(1, price, { fee: 0 }));
      steps.push(s.lossStreak);
    }

    expect(steps).toEqual([1, 2, 0]);
  });

  it("subtracts the fee when it is charged in the quote asset", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 100, { fee: 0.5 }));

    expect(s.realizedPnlToday).toBeCloseTo(-0.5, 10);
    expect(s.lossStreak).toBe(1);
  });

  it("handles a partial sell without closing the position", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(2, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 120, { fee: 0 }));

    expect(s.positions.BTCUSDT?.quantity).toBeCloseTo(1, 10);
    expect(s.positions.BTCUSDT?.avgCost).toBeCloseTo(100, 10);
    expect(s.realizedPnlToday).toBeCloseTo(20, 10);
  });

  it("ignores a sell of something never bought rather than inventing a cost basis", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, sell(1, 100, { fee: 0 }));

    expect(s.realizedPnlToday).toBe(0);
    expect(s.closedTrades).toEqual([]);
  });
});

describe("rate-limit history", () => {
  it("records each fill and drops ones older than two hours", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0, ts: T0 }));
    s = applyFill(s, buy(1, 100, { fee: 0, ts: T0 + 3 * 3600_000 }));

    expect(s.recentOrders).toHaveLength(1);
    expect(s.recentOrders[0]?.ts).toBe(T0 + 3 * 3600_000);
  });
});

describe("UTC day roll", () => {
  it("derives the day key from a timestamp", () => {
    expect(dayKeyUtc(Date.UTC(2026, 8, 5, 23, 59, 59))).toBe("2026-09-05");
    expect(dayKeyUtc(Date.UTC(2026, 8, 6, 0, 0, 0))).toBe("2026-09-06");
  });

  it("resets the daily loss but keeps positions and the losing streak", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, buy(1, 100, { fee: 0 }));
    s = applyFill(s, sell(1, 90, { fee: 0 }));
    s = applyFill(s, buy(1, 100, { fee: 0 }));

    const next = rollDayIfNeeded(s, Date.UTC(2026, 8, 6, 0, 0, 1), 88);

    expect(next.dayStartUtc).toBe("2026-09-06");
    expect(next.dayStartEquity).toBe(88);
    expect(next.realizedPnlToday).toBe(0);
    expect(next.positions.BTCUSDT?.quantity).toBeCloseTo(1, 10);
    expect(next.lossStreak).toBe(1); // a losing streak is behaviour, not a calendar entry
  });

  it("clears a tripped kill switch at the new day but leaves a manual one alone", () => {
    let s = emptyState("2026-09-05", 100);
    s = { ...s, killSwitch: { manual: true, trippedAt: T0 } };

    const next = rollDayIfNeeded(s, Date.UTC(2026, 8, 6, 0, 0, 1), 100);

    expect(next.killSwitch.trippedAt).toBeUndefined();
    expect(next.killSwitch.manual).toBe(true);
  });

  it("does nothing within the same day", () => {
    const s = emptyState("2026-09-05", 100);
    expect(rollDayIfNeeded(s, Date.UTC(2026, 8, 5, 23, 0, 0), 50)).toBe(s);
  });
});

describe("purity", () => {
  it("never mutates the state handed in", () => {
    const s = emptyState("2026-09-05", 100);
    const frozen = structuredClone(s);
    applyFill(s, buy(1, 100, { fee: 0 }));

    expect(s).toEqual(frozen);
  });
});
