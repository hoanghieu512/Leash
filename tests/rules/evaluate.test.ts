import { describe, expect, it, vi } from "vitest";
import { emptyState, isDenied, type LeashState } from "../../src/domain/types.js";
import { ORDER_RULES, evaluate } from "../../src/rules/index.js";
import { T0, intent, policy } from "../helpers.js";

const ctx = { now: T0 };
const declared = (s: LeashState): LeashState => ({
  ...s,
  tickets: [{ symbol: "BTCUSDT", side: "BUY", notionalUsdt: 12, reason: "test", ts: T0, consumed: false }],
});

describe("evaluate", () => {
  it("allows a clean, declared order and lists every rule that ran", () => {
    const d = evaluate(intent(), declared(emptyState("2026-09-05", 100)), policy(), ctx);

    expect(d.verdict).toBe("ALLOW");
    expect(d.rulesEvaluated).toContain("never_mint_credentials");
    expect(d.rulesEvaluated).toContain("require_reason");
  });

  it("reports the highest-priority rule when several are broken at once", () => {
    // Oversized, wrong symbol, undeclared, and the switch is on.
    const s: LeashState = { ...emptyState("2026-09-05", 100), killSwitch: { manual: true } };
    const d = evaluate(intent({ symbol: "PEPEUSDT", notionalUsdt: 900 }), s, policy(), ctx);

    expect(isDenied(d) && d.rule).toBe("kill_switch");
  });

  it("puts hard rules above everything, including the kill switch", () => {
    const s: LeashState = { ...emptyState("2026-09-05", 100), killSwitch: { manual: true } };
    const d = evaluate(intent({ canonicalTool: "margin_createSpecialKey" }), s, policy(), ctx);

    expect(isDenied(d) && d.rule).toBe("never_mint_credentials");
  });

  it("blocks a credential mint no matter how permissive the policy is", () => {
    const wideOpen = {
      ...policy(),
      limits: { ...policy().limits, maxNotionalPerOrder: 1e9, symbolAllowlist: ["BTCUSDT"] },
      behavior: { ...policy().behavior, requireReason: false },
    };
    const d = evaluate(
      intent({ canonicalTool: "margin_createSpecialKey" }),
      emptyState("2026-09-05", 100),
      wideOpen,
      ctx,
    );

    expect(isDenied(d) && d.rule).toBe("never_mint_credentials");
  });

  it("denies rather than allows when a rule throws", () => {
    const spy = vi.spyOn(ORDER_RULES[4] as { check: unknown } as { check: () => never }, "check")
      .mockImplementation(() => { throw new Error("boom"); });

    const d = evaluate(intent(), declared(emptyState("2026-09-05", 100)), policy(), ctx);

    expect(d.verdict).toBe("DENY");
    expect(isDenied(d) && d.rule).toContain("rule_error");
    spy.mockRestore();
  });

  it("spares a non-order write from the order rules but not from the hard ones", () => {
    const transfer = intent({
      kind: "non_order",
      canonicalTool: "wallet_userUniversalTransfer",
      market: "wallet",
      symbol: null,
      side: null,
      notionalUsdt: null,
      args: { type: "UMFUTURE_MAIN" },
    });

    expect(evaluate(transfer, emptyState("2026-09-05", 100), policy(), ctx).verdict).toBe("ALLOW");

    const toLeverage = { ...transfer, args: { type: "MAIN_UMFUTURE" } };
    const d = evaluate(toLeverage, emptyState("2026-09-05", 100), policy(), ctx);
    expect(isDenied(d) && d.rule).toBe("no_leverage_funding");
  });
});
