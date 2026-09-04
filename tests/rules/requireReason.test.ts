import { describe, expect, it } from "vitest";
import { emptyState, type CheckTicket, type LeashState } from "../../src/domain/types.js";
import { requireReason } from "../../src/rules/requireReason.js";
import { addTicket, consumeTicket, findMatchingTicket } from "../../src/state/reduce.js";
import { T0, intent, policy } from "../helpers.js";

const base = emptyState("2026-09-05", 100);
const ctx = { now: T0 };

function ticket(over: Partial<CheckTicket> = {}): CheckTicket {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    notionalUsdt: 12,
    reason: "breakout above yesterday's high",
    ts: T0 - 10_000,
    consumed: false,
    ...over,
  };
}

const withTicket = (t: CheckTicket): LeashState => ({ ...base, tickets: [t] });

describe("require_reason", () => {
  it("lets an order through when a matching declaration came first", () => {
    expect(requireReason.check(intent(), withTicket(ticket()), policy(), ctx)).toBeNull();
  });

  it("blocks an undeclared order, and the message tells the agent what to do", () => {
    const v = requireReason.check(intent(), base, policy(), ctx);

    expect(v?.rule).toBe("require_reason");
    expect(v?.detail).toContain("check_order");
  });

  it("blocks when the declaration has gone stale", () => {
    const stale = ticket({ ts: T0 - 121_000 });
    expect(requireReason.check(intent(), withTicket(stale), policy(), ctx)).not.toBeNull();
  });

  it("blocks when the declared symbol was different", () => {
    expect(
      requireReason.check(intent({ symbol: "ETHUSDT" }), withTicket(ticket()), policy(), ctx),
    ).not.toBeNull();
  });

  it("blocks when the declared side was different", () => {
    expect(
      requireReason.check(intent({ side: "SELL" }), withTicket(ticket()), policy(), ctx),
    ).not.toBeNull();
  });

  it("tolerates a 4% difference in size — agents round differently than they declare", () => {
    expect(
      requireReason.check(intent({ notionalUsdt: 12.48 }), withTicket(ticket()), policy(), ctx),
    ).toBeNull();
  });

  it("rejects a 20% difference", () => {
    expect(
      requireReason.check(intent({ notionalUsdt: 14.4 }), withTicket(ticket()), policy(), ctx),
    ).not.toBeNull();
  });

  it("refuses a declaration whose reason is only whitespace", () => {
    expect(
      requireReason.check(intent(), withTicket(ticket({ reason: "   " })), policy(), ctx),
    ).not.toBeNull();
  });

  it("will not let one declaration cover two orders", () => {
    expect(
      requireReason.check(intent(), withTicket(ticket({ consumed: true })), policy(), ctx),
    ).not.toBeNull();
  });

  it("stands down when the policy switches it off", () => {
    const off = policy().behavior.requireReason ? { ...policy(), behavior: { ...policy().behavior, requireReason: false } } : policy();
    expect(requireReason.check(intent(), base, off, ctx)).toBeNull();
  });
});

describe("ticket bookkeeping", () => {
  it("keeps the newest declaration and drops expired ones", () => {
    let s = addTicket(base, ticket({ ts: T0 - 200_000 }), T0 - 200_000);
    s = addTicket(s, ticket({ reason: "fresh" }), T0);

    expect(s.tickets).toHaveLength(1);
    expect(s.tickets[0]?.reason).toBe("fresh");
  });

  it("marks a ticket consumed so it cannot be reused", () => {
    const s = consumeTicket(withTicket(ticket()), intent(), T0);
    expect(s.tickets[0]?.consumed).toBe(true);

    expect(findMatchingTicket(s, intent(), T0)).toBeUndefined();
  });

  it("consuming when nothing matches leaves state untouched", () => {
    const s = withTicket(ticket());
    expect(consumeTicket(s, intent({ symbol: "ETHUSDT" }), T0)).toBe(s);
  });
});
