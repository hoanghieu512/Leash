import { allow, deny, type Decision, type LeashState, type OrderIntent } from "../domain/types.js";
import type { Policy } from "../policy/schema.js";
import { dailyLoss } from "./dailyLoss.js";
import { neverMintCredentials } from "./hard/neverMintCredentials.js";
import { noLeverageFunding } from "./hard/noLeverageFunding.js";
import { killSwitch } from "./killSwitch.js";
import { maxNotional } from "./maxNotional.js";
import { noSizeUpAfterLosses } from "./noSizeUpAfterLosses.js";
import { rateLimit } from "./rateLimit.js";
import { requireReason } from "./requireReason.js";
import { revengeCooldown } from "./revengeCooldown.js";
import { spotOnly } from "./spotOnly.js";
import { symbolAllowlist } from "./symbolAllowlist.js";
import type { HardRule, Rule, RuleContext } from "./types.js";

/**
 * Hard rules run first and read no policy — nothing later may overturn them.
 */
export const HARD_RULES: readonly HardRule[] = [neverMintCredentials, noLeverageFunding];

/**
 * Order rules, in a fixed sequence.
 *
 * The order is part of the contract, not an implementation detail: the same
 * situation must always name the same rule, or the audit log and the report tell
 * a different story each time they are read. Broadest and most serious first, so
 * an agent that trips several gets told about the one that matters most.
 */
export const ORDER_RULES: readonly Rule[] = [
  killSwitch,
  dailyLoss,
  spotOnly,
  symbolAllowlist,
  maxNotional,
  rateLimit,
  revengeCooldown,
  noSizeUpAfterLosses,
  requireReason,
];

/** The single gate. Everything else in Leash asks this question. */
export function evaluate(
  intent: OrderIntent,
  state: LeashState,
  policy: Policy,
  ctx: RuleContext,
): Decision {
  const ran: string[] = [];

  for (const rule of HARD_RULES) {
    ran.push(rule.name);
    try {
      const v = rule.check(intent, ctx);
      if (v !== null) return deny(v.rule, v.detail, ran);
    } catch (err) {
      return deny(`rule_error:${rule.name}`, ruleCrashed(rule.name, err), ran);
    }
  }

  if (intent.kind === "order") {
    for (const rule of ORDER_RULES) {
      ran.push(rule.name);
      try {
        const v = rule.check(intent, state, policy, ctx);
        if (v !== null) return deny(v.rule, v.detail, ran);
      } catch (err) {
        return deny(`rule_error:${rule.name}`, ruleCrashed(rule.name, err), ran);
      }
    }
  }

  return allow(ran);
}

/** A rule that crashes is a rule with no opinion, and no opinion means no. */
function ruleCrashed(name: string, err: unknown): string {
  return (
    `Luật "${name}" lỗi khi chạy: ${(err as Error).message}. ` +
    `Leash chặn lệnh khi không tự tin đánh giá được — một guardrail hỏng phải nghiêng về từ chối.`
  );
}
