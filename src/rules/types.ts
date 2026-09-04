import type { LeashState, OrderIntent } from "../domain/types.js";
import type { Policy } from "../policy/schema.js";

/** What a rule knows about the world beyond the order and the state. */
export interface RuleContext {
  now: number;
  /** Mark prices in USDT, when available. Absent means unrealised P&L is unknown. */
  marks?: Record<string, number>;
}

/** null means "this rule has no objection" — only a violation carries words. */
export type RuleResult = { rule: string; detail: string } | null;

export interface Rule {
  name: string;
  check(intent: OrderIntent, state: LeashState, policy: Policy, ctx: RuleContext): RuleResult;
}

/**
 * A rule with no policy parameter at all.
 *
 * The missing argument is the point: a hard rule that could read config would
 * eventually grow a flag to switch it off, and these are the rules nobody should
 * be able to switch off.
 */
export interface HardRule {
  name: string;
  check(intent: OrderIntent, ctx: RuleContext): RuleResult;
}

export function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
