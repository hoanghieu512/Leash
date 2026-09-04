import { readAudit } from "../audit/report.js";
import type { CheckTicket, LeashState, Side } from "../domain/types.js";
import { isDenied } from "../domain/types.js";
import type { Policy } from "../policy/schema.js";
import { evaluate } from "../rules/index.js";
import { addTicket } from "../state/reduce.js";
import type { RuleContext } from "../rules/types.js";
import type { OrderIntent } from "../domain/types.js";

/**
 * The four tools Leash exposes to the agent.
 *
 * None of them decides anything: every answer comes from evaluate(), the same
 * gate the hook uses. If these tools had their own judgement, an agent could be
 * told one thing here and another at the boundary.
 */

export interface CheckOrderArgs {
  symbol: string;
  side: Side;
  notional: number;
  reason: string;
}

export interface CheckOrderResult {
  text: string;
  state: LeashState;
}

/** Build the intent a check_order describes, as the hook would see it. */
function plannedIntent(a: CheckOrderArgs, now: number): OrderIntent {
  return {
    kind: "order",
    rawToolName: "leash__check_order",
    canonicalTool: "spot_newOrder",
    market: "spot",
    symbol: a.symbol.toUpperCase(),
    side: a.side,
    notionalUsdt: a.notional,
    quantity: null,
    reduceOnly: false,
    args: {},
    ts: now,
  };
}

/**
 * Declare an intent and find out, before spending anything, whether it would
 * pass. The declaration is recorded either way — an agent that learns its plan
 * is refused should not have to declare again to try a smaller one.
 */
export function checkOrder(
  args: CheckOrderArgs,
  state: LeashState,
  policy: Policy,
  ctx: RuleContext,
): CheckOrderResult {
  if (args.reason.trim().length === 0) {
    return {
      text: "A real reason is required. An empty string is not one, and Leash will refuse the order it accompanies.",
      state,
    };
  }

  const intent = plannedIntent(args, ctx.now);
  const verdict = evaluate(intent, state, policy, ctx);

  const ticket: CheckTicket = {
    symbol: intent.symbol ?? args.symbol,
    side: args.side,
    notionalUsdt: args.notional,
    reason: args.reason.trim(),
    ts: ctx.now,
    consumed: false,
  };
  const next = addTicket(state, ticket, ctx.now);

  // require_reason is the one rule this call is in the middle of satisfying, so
  // its objection here says nothing about whether the order itself is sound.
  if (isDenied(verdict) && verdict.rule !== "require_reason") {
    return {
      text:
        `This order WOULD BE REFUSED if placed now.\n\n` +
        `Rule: ${verdict.rule}\n${verdict.detail}\n\n` +
        `The declaration was recorded — adjust the order to fit the rules and declare again.`,
      state: next,
    };
  }

  return {
    text:
      `Recorded: ${args.side} ${args.notional} USDT ${ticket.symbol} — "${ticket.reason}".\n` +
      `This order will pass. Place it within 2 minutes; each declaration covers exactly one order.`,
    state: next,
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** What room is left, in the terms the rules actually use. */
export function budgetStatus(state: LeashState, policy: Policy, ctx: RuleContext): string {
  const ordersLastHour = state.recentOrders.filter((o) => ctx.now - o.ts < HOUR_MS).length;
  const lastTs = state.recentOrders.reduce((max, o) => Math.max(max, o.ts), 0);
  const sinceLast = lastTs === 0 ? null : Math.floor((ctx.now - lastTs) / 1000);
  const cooldownLeft =
    sinceLast === null ? 0 : Math.max(0, policy.limits.minSecondsBetweenOrders - sinceLast);

  let unrealized = 0;
  let marksMissing = false;
  for (const p of Object.values(state.positions)) {
    const mark = ctx.marks?.[p.symbol];
    if (mark === undefined) marksMissing = true;
    else unrealized += (mark - p.avgCost) * p.quantity;
  }
  const pnl = state.realizedPnlToday + unrealized;
  const lossPct = (-pnl / state.dayStartEquity) * 100;

  const lines = [
    `UTC day              ${state.dayStartUtc}`,
    `Opening equity       ${state.dayStartEquity.toFixed(2)} USDT`,
    `P&L today            ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT` +
      (marksMissing ? "  (unrealised P&L could not be priced)" : ""),
    `Lock threshold       ${policy.behavior.dailyLossKillSwitchPct}%  ` +
      `(now ${lossPct > 0 ? lossPct.toFixed(2) : "0.00"}%)`,
    `Per-order limit      ${policy.limits.maxNotionalPerOrder} USDT`,
    `Orders this hour     ${ordersLastHour}/${policy.limits.maxOrdersPerHour}`,
    `Cooldown remaining   ${cooldownLeft}s before the next order`,
    `Losing streak        ${state.lossStreak}`,
    `Kill switch          ${state.killSwitch.manual ? "ON — closing orders only" : "off"}`,
    `Allowed symbols      ${policy.limits.symbolAllowlist.join(", ")}`,
  ];
  return lines.join("\n");
}

/** Explain the most recent refusal, in the words the rule used at the time. */
export function whyBlocked(auditPath: string): string {
  const { entries } = readAudit(auditPath);
  const lastDeny = [...entries].reverse().find((e) => e.verdict === "DENY");

  if (lastDeny === undefined) return "No order has been refused yet.";

  return [
    `Most recent refusal: ${lastDeny.ts}`,
    `Tool    ${lastDeny.tool}`,
    `Order   ${lastDeny.side ?? "-"} ${lastDeny.notional ?? "-"} ${lastDeny.symbol ?? ""}`.trim(),
    `Rule    ${lastDeny.rule}`,
    "",
    lastDeny.detail ?? "",
  ].join("\n");
}

export function setKillSwitch(state: LeashState, on: boolean, now: number): { text: string; state: LeashState } {
  if (on) {
    return {
      // Turning it on is instant and needs no confirmation: hesitating in front
      // of a stop button defeats the button.
      text: "Kill switch is ON. No new or larger position may be opened; closing orders still go through.",
      state: { ...state, killSwitch: { ...state.killSwitch, manual: true, trippedAt: now } },
    };
  }
  return {
    text: "Kill switch is off. Opening is allowed again; every other rule still applies.",
    state: { ...state, killSwitch: { manual: false } },
  };
}
