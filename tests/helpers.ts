import type { OrderIntent, Side } from "../src/domain/types.js";
import { parsePolicy } from "../src/policy/load.js";
import type { Policy } from "../src/policy/schema.js";

export const T0 = Date.UTC(2026, 8, 5, 10, 0, 0);

export function policy(overrides = ""): Policy {
  return parsePolicy(`
profile: conservative
capital_usdt: 100
limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT]
  markets: [spot]
behavior:
  daily_loss_kill_switch_pct: 5
  revenge_cooldown_minutes: 15
  no_size_up_after_losses: 2
  require_reason: true
${overrides}`);
}

export function intent(over: Partial<OrderIntent> = {}): OrderIntent {
  return {
    kind: "order" as const,
    rawToolName: "mcp__binance-mcp-server__spot_newOrder",
    canonicalTool: "spot_newOrder",
    market: "spot",
    symbol: "BTCUSDT",
    side: "BUY" as Side,
    notionalUsdt: 12,
    quantity: null,
    reduceOnly: false,
    args: {},
    ts: T0,
    ...over,
  };
}
