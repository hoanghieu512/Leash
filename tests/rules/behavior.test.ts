import { describe, expect, it } from "vitest";
import { emptyState, type LeashState } from "../../src/domain/types.js";
import { dailyLoss } from "../../src/rules/dailyLoss.js";
import { noSizeUpAfterLosses } from "../../src/rules/noSizeUpAfterLosses.js";
import { revengeCooldown } from "../../src/rules/revengeCooldown.js";
import { T0, intent, policy } from "../helpers.js";

const base = emptyState("2026-09-05", 100);
const ctx = { now: T0 };

describe("daily_loss_kill_switch", () => {
  const withRealized = (pnl: number): LeashState => ({ ...base, realizedPnlToday: pnl });

  it("allows trading at 4.9% down", () => {
    expect(dailyLoss.check(intent(), withRealized(-4.9), policy(), ctx)).toBeNull();
  });

  it("blocks at 5.1% down", () => {
    const v = dailyLoss.check(intent(), withRealized(-5.1), policy(), ctx);
    expect(v?.rule).toBe("daily_loss_kill_switch");
    expect(v?.detail).toContain("5");
  });

  it("still lets a closing order through once tripped — lock the agent, not the money", () => {
    expect(dailyLoss.check(intent({ reduceOnly: true }), withRealized(-20), policy(), ctx)).toBeNull();
  });

  it("counts unrealised losses too when a mark price is available", () => {
    const s: LeashState = {
      ...base,
      positions: { BTCUSDT: { symbol: "BTCUSDT", quantity: 1, avgCost: 100 } },
    };
    const v = dailyLoss.check(intent(), s, policy(), { now: T0, marks: { BTCUSDT: 93 } });

    expect(v).not.toBeNull();
  });

  it("says so plainly when no mark price was available", () => {
    const s: LeashState = {
      ...base,
      realizedPnlToday: -5.5,
      positions: { BTCUSDT: { symbol: "BTCUSDT", quantity: 1, avgCost: 100 } },
    };
    const v = dailyLoss.check(intent(), s, policy(), ctx);

    expect(v?.detail).toMatch(/chưa thực hiện|mark|realized/i);
  });

  it("ignores a profitable day", () => {
    expect(dailyLoss.check(intent(), withRealized(30), policy(), ctx)).toBeNull();
  });
});

describe("revenge_cooldown", () => {
  const afterLoss = (symbol: string, minutesAgo: number): LeashState => ({
    ...base,
    closedTrades: [{ symbol, pnlUsdt: -3, notionalUsdt: 12, ts: T0 - minutesAgo * 60_000 }],
  });

  it("blocks going straight back into the symbol that just lost", () => {
    const v = revengeCooldown.check(intent({ symbol: "BTCUSDT" }), afterLoss("BTCUSDT", 2), policy(), ctx);

    expect(v?.rule).toBe("revenge_cooldown");
    expect(v?.detail).toContain("BTCUSDT");
  });

  it("leaves other symbols alone — this locks one door, not the building", () => {
    expect(revengeCooldown.check(intent({ symbol: "ETHUSDT" }), afterLoss("BTCUSDT", 2), policy(), ctx)).toBeNull();
  });

  it("lets the symbol back in once the cooldown has passed", () => {
    expect(revengeCooldown.check(intent({ symbol: "BTCUSDT" }), afterLoss("BTCUSDT", 16), policy(), ctx)).toBeNull();
  });

  it("does not trigger after a winning close", () => {
    const s: LeashState = {
      ...base,
      closedTrades: [{ symbol: "BTCUSDT", pnlUsdt: 4, notionalUsdt: 12, ts: T0 - 60_000 }],
    };
    expect(revengeCooldown.check(intent(), s, policy(), ctx)).toBeNull();
  });

  it("still allows closing a position during the cooldown", () => {
    expect(
      revengeCooldown.check(intent({ reduceOnly: true }), afterLoss("BTCUSDT", 2), policy(), ctx),
    ).toBeNull();
  });
});

describe("no_size_up_after_losses", () => {
  const afterLosses = (count: number, lastNotional: number): LeashState => ({
    ...base,
    lossStreak: count,
    closedTrades: [{ symbol: "BTCUSDT", pnlUsdt: -2, notionalUsdt: lastNotional, ts: T0 - 60_000 }],
  });

  it("says nothing after a single loss", () => {
    expect(noSizeUpAfterLosses.check(intent({ notionalUsdt: 14 }), afterLosses(1, 5), policy(), ctx)).toBeNull();
  });

  it("blocks a bigger order after two losses in a row", () => {
    const v = noSizeUpAfterLosses.check(intent({ notionalUsdt: 14 }), afterLosses(2, 7), policy(), ctx);

    expect(v?.rule).toBe("no_size_up_after_losses");
    expect(v?.detail).toContain("14");
    expect(v?.detail).toContain("7");
  });

  it("allows the same size", () => {
    expect(noSizeUpAfterLosses.check(intent({ notionalUsdt: 7 }), afterLosses(2, 7), policy(), ctx)).toBeNull();
  });

  it("allows a smaller size", () => {
    expect(noSizeUpAfterLosses.check(intent({ notionalUsdt: 5 }), afterLosses(2, 7), policy(), ctx)).toBeNull();
  });

  it("stops applying once a winning trade breaks the streak", () => {
    const s: LeashState = { ...afterLosses(0, 7), lossStreak: 0 };
    expect(noSizeUpAfterLosses.check(intent({ notionalUsdt: 14 }), s, policy(), ctx)).toBeNull();
  });

  it("blocks an order of unknown size while the streak is live", () => {
    expect(
      noSizeUpAfterLosses.check(intent({ notionalUsdt: null }), afterLosses(2, 7), policy(), ctx),
    ).not.toBeNull();
  });

  it("allows closing a position regardless of size", () => {
    expect(
      noSizeUpAfterLosses.check(intent({ notionalUsdt: 99, reduceOnly: true }), afterLosses(3, 7), policy(), ctx),
    ).toBeNull();
  });
});
