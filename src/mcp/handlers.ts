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
      text: "Cần nêu lý do thật sự. Một chuỗi rỗng không phải lý do, và Leash sẽ chặn lệnh đi kèm nó.",
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
        `Lệnh này SẼ BỊ CHẶN nếu đặt bây giờ.\n\n` +
        `Luật: ${verdict.rule}\n${verdict.detail}\n\n` +
        `Khai báo đã ghi nhận — sửa lệnh cho hợp luật rồi khai lại.`,
      state: next,
    };
  }

  return {
    text:
      `Đã ghi nhận: ${args.side} ${args.notional} USDT ${ticket.symbol} — "${ticket.reason}".\n` +
      `Lệnh này sẽ đi qua được. Đặt trong vòng 2 phút; mỗi khai báo dùng đúng một lần.`,
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
    `Ngày UTC             ${state.dayStartUtc}`,
    `Vốn đầu ngày         ${state.dayStartEquity.toFixed(2)} USDT`,
    `Lãi/lỗ hôm nay       ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT` +
      (marksMissing ? "  (thiếu giá tham chiếu, chưa tính hết phần chưa thực hiện)" : ""),
    `Ngưỡng khoá          ${policy.behavior.dailyLossKillSwitchPct}%  ` +
      `(hiện ${lossPct > 0 ? lossPct.toFixed(2) : "0.00"}%)`,
    `Hạn mức mỗi lệnh     ${policy.limits.maxNotionalPerOrder} USDT`,
    `Lệnh trong giờ này   ${ordersLastHour}/${policy.limits.maxOrdersPerHour}`,
    `Chờ thêm             ${cooldownLeft} giây trước lệnh kế tiếp`,
    `Chuỗi lỗ liên tiếp   ${state.lossStreak}`,
    `Kill switch          ${state.killSwitch.manual ? "ĐANG BẬT — chỉ đóng vị thế được" : "tắt"}`,
    `Symbol cho phép      ${policy.limits.symbolAllowlist.join(", ")}`,
  ];
  return lines.join("\n");
}

/** Explain the most recent refusal, in the words the rule used at the time. */
export function whyBlocked(auditPath: string): string {
  const { entries } = readAudit(auditPath);
  const lastDeny = [...entries].reverse().find((e) => e.verdict === "DENY");

  if (lastDeny === undefined) return "Chưa có lệnh nào bị chặn.";

  return [
    `Lần chặn gần nhất: ${lastDeny.ts}`,
    `Tool    ${lastDeny.tool}`,
    `Lệnh    ${lastDeny.side ?? "-"} ${lastDeny.notional ?? "-"} ${lastDeny.symbol ?? ""}`.trim(),
    `Luật    ${lastDeny.rule}`,
    "",
    lastDeny.detail ?? "",
  ].join("\n");
}

export function setKillSwitch(state: LeashState, on: boolean, now: number): { text: string; state: LeashState } {
  if (on) {
    return {
      // Turning it on is instant and needs no confirmation: hesitating in front
      // of a stop button defeats the button.
      text: "Kill switch ĐÃ BẬT. Mọi lệnh mở mới bị chặn; lệnh đóng vị thế vẫn đi qua được.",
      state: { ...state, killSwitch: { ...state.killSwitch, manual: true, trippedAt: now } },
    };
  }
  return {
    text: "Kill switch đã tắt. Lệnh mở mới được phép trở lại, các luật khác vẫn nguyên.",
    state: { ...state, killSwitch: { manual: false } },
  };
}
