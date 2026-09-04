import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEntry } from "../../src/audit/log.js";
import { deny, emptyState, type LeashState } from "../../src/domain/types.js";
import { budgetStatus, checkOrder, setKillSwitch, whyBlocked } from "../../src/mcp/handlers.js";
import { evaluate } from "../../src/rules/index.js";
import { T0, intent, policy } from "../helpers.js";

const S = emptyState("2026-09-05", 100);
const ctx = { now: T0, marks: { BTCUSDT: 81000 } };
const args = { symbol: "BTCUSDT", side: "BUY" as const, notional: 12, reason: "breakout" };

describe("check_order", () => {
  it("records the declaration and says the order will pass", () => {
    const r = checkOrder(args, S, policy(), ctx);

    expect(r.text).toContain("sẽ đi qua được");
    expect(r.state.tickets[0]?.reason).toBe("breakout");
  });

  it("produces a ticket the real gate then accepts", () => {
    const r = checkOrder(args, S, policy(), ctx);
    const d = evaluate(intent({ notionalUsdt: 12 }), r.state, policy(), ctx);

    expect(d.verdict).toBe("ALLOW");
  });

  it("warns in advance when the order would be refused, naming the rule", () => {
    const r = checkOrder({ ...args, notional: 200 }, S, policy(), ctx);

    expect(r.text).toContain("SẼ BỊ CHẶN");
    expect(r.text).toContain("max_notional_per_order");
  });

  it("still records the declaration after a warning, so the agent can retry smaller", () => {
    const r = checkOrder({ ...args, notional: 200 }, S, policy(), ctx);
    expect(r.state.tickets).toHaveLength(1);
  });

  it("refuses an empty reason without recording anything", () => {
    const r = checkOrder({ ...args, reason: "   " }, S, policy(), ctx);

    expect(r.text).toContain("lý do");
    expect(r.state.tickets).toHaveLength(0);
  });

  it("does not report require_reason as an objection — this call is what satisfies it", () => {
    const r = checkOrder(args, S, policy(), ctx);
    expect(r.text).not.toContain("require_reason");
  });

  it("uppercases the symbol so a lowercase declaration still matches the order", () => {
    const r = checkOrder({ ...args, symbol: "btcusdt" }, S, policy(), ctx);
    expect(r.state.tickets[0]?.symbol).toBe("BTCUSDT");
  });
});

describe("budget_status", () => {
  it("reports the numbers the rules actually use", () => {
    const s: LeashState = {
      ...S,
      realizedPnlToday: -2.5,
      lossStreak: 1,
      recentOrders: [{ ts: T0 - 30_000, symbol: "BTCUSDT", notionalUsdt: 12 }],
    };
    const text = budgetStatus(s, policy(), ctx);

    expect(text).toContain("-2.50 USDT");
    expect(text).toContain("1/6");
    expect(text).toContain("30 giây");
    expect(text).toContain("BTCUSDT, ETHUSDT");
  });

  it("says plainly when the kill switch is on", () => {
    const s: LeashState = { ...S, killSwitch: { manual: true } };
    expect(budgetStatus(s, policy(), ctx)).toContain("ĐANG BẬT");
  });

  it("admits when unrealised P&L could not be priced", () => {
    const s: LeashState = { ...S, positions: { BTCUSDT: { symbol: "BTCUSDT", quantity: 1, avgCost: 100 } } };
    expect(budgetStatus(s, policy(), { now: T0 })).toContain("thiếu giá tham chiếu");
  });
});

describe("why_blocked", () => {
  it("repeats the rule's own words from the last refusal", () => {
    const dir = mkdtempSync(join(tmpdir(), "leash-why-"));
    const path = join(dir, "audit.jsonl");
    const e = buildEntry(intent({ notionalUsdt: 180 }), S, deny("max_notional_per_order", "180 vượt 15", []), null, T0);
    writeFileSync(path, `${JSON.stringify(e)}\n`, "utf8");

    const text = whyBlocked(path);
    expect(text).toContain("max_notional_per_order");
    expect(text).toContain("180 vượt 15");
    rmSync(dir, { recursive: true, force: true });
  });

  it("says so when nothing has been blocked", () => {
    expect(whyBlocked(join(tmpdir(), "definitely-absent.jsonl"))).toContain("Chưa có");
  });
});

describe("kill_switch", () => {
  it("turns on without ceremony", () => {
    const r = setKillSwitch(S, true, T0);

    expect(r.state.killSwitch.manual).toBe(true);
    expect(r.text).toContain("ĐÃ BẬT");
  });

  it("turns off and leaves the other rules alone", () => {
    const on = setKillSwitch(S, true, T0).state;
    const off = setKillSwitch(on, false, T0);

    expect(off.state.killSwitch.manual).toBe(false);
    expect(off.text).toContain("các luật khác vẫn nguyên");
  });

  it("once on, the real gate blocks opening but not closing", () => {
    const on = setKillSwitch(S, true, T0).state;
    // require_reason is switched off here so the assertion is about the kill
    // switch alone. In normal use a closing order still needs a declaration —
    // check_order issues one for closes just as it does for opens.
    const noDeclaration = { ...policy(), behavior: { ...policy().behavior, requireReason: false } };

    expect(evaluate(intent(), on, noDeclaration, ctx).verdict).toBe("DENY");
    expect(evaluate(intent({ reduceOnly: true }), on, noDeclaration, ctx).verdict).toBe("ALLOW");
  });
});
