import { z } from "zod";

/**
 * The YAML shape, mirrored field-for-field in snake_case so validation errors
 * name the key the user actually typed.
 *
 * Two deliberate choices:
 *  - `.strict()` everywhere: a typo'd key is a silently missing rule, which in a
 *    safety tool is worse than a crash.
 *  - No defaults. A limit that quietly defaults to something is a limit nobody
 *    reviewed.
 */
const limitsSchema = z
  .object({
    max_notional_per_order: z.number().positive(),
    max_orders_per_hour: z.number().int().positive(),
    min_seconds_between_orders: z.number().int().nonnegative(),
    symbol_allowlist: z.array(z.string().min(1)).nonempty(),
    // Only spot in v1. Accepting "futures" here would promise a market Leash
    // cannot actually police yet.
    markets: z.array(z.literal("spot")).nonempty(),
  })
  .strict();

const behaviorSchema = z
  .object({
    daily_loss_kill_switch_pct: z.number().positive().max(100),
    revenge_cooldown_minutes: z.number().nonnegative(),
    no_size_up_after_losses: z.number().int().positive(),
    require_reason: z.boolean(),
  })
  .strict();

export const policySchema = z
  .object({
    profile: z.string().min(1),
    capital_usdt: z.number().positive(),
    limits: limitsSchema,
    behavior: behaviorSchema,
  })
  .strict();

export type RawPolicy = z.infer<typeof policySchema>;

export interface Policy {
  profile: string;
  capitalUsdt: number;
  limits: {
    maxNotionalPerOrder: number;
    maxOrdersPerHour: number;
    minSecondsBetweenOrders: number;
    symbolAllowlist: string[];
    markets: "spot"[];
  };
  behavior: {
    dailyLossKillSwitchPct: number;
    revengeCooldownMinutes: number;
    noSizeUpAfterLosses: number;
    requireReason: boolean;
  };
}

export function toPolicy(raw: RawPolicy): Policy {
  return {
    profile: raw.profile,
    capitalUsdt: raw.capital_usdt,
    limits: {
      maxNotionalPerOrder: raw.limits.max_notional_per_order,
      maxOrdersPerHour: raw.limits.max_orders_per_hour,
      minSecondsBetweenOrders: raw.limits.min_seconds_between_orders,
      symbolAllowlist: raw.limits.symbol_allowlist.map((s) => s.toUpperCase()),
      markets: [...raw.limits.markets],
    },
    behavior: {
      dailyLossKillSwitchPct: raw.behavior.daily_loss_kill_switch_pct,
      revengeCooldownMinutes: raw.behavior.revenge_cooldown_minutes,
      noSizeUpAfterLosses: raw.behavior.no_size_up_after_losses,
      requireReason: raw.behavior.require_reason,
    },
  };
}
