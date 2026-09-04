import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Decision, LeashState, OrderIntent } from "../domain/types.js";

/**
 * One decision, one line. Both allowances and denials are recorded — a log that
 * only holds refusals cannot answer "what did it actually let through?", which
 * is the question anyone auditing an agent asks second.
 */
export interface AuditEntry {
  ts: string;
  tool: string;
  raw_tool: string;
  symbol: string | null;
  side: string | null;
  notional: number | null;
  agent_reason: string | null;
  verdict: "ALLOW" | "DENY";
  rule?: string;
  detail?: string;
  state: {
    daily_pnl_usdt: number;
    orders_last_hour: number;
    loss_streak: number;
    kill_switch: boolean;
  };
}

const HOUR_MS = 60 * 60 * 1000;

export function buildEntry(
  intent: OrderIntent,
  state: LeashState,
  decision: Decision,
  reason: string | null,
  now: number,
): AuditEntry {
  const entry: AuditEntry = {
    ts: new Date(now).toISOString(),
    tool: intent.canonicalTool,
    raw_tool: intent.rawToolName,
    symbol: intent.symbol,
    side: intent.side,
    notional: intent.notionalUsdt,
    agent_reason: reason,
    verdict: decision.verdict,
    state: {
      daily_pnl_usdt: round(state.realizedPnlToday),
      orders_last_hour: state.recentOrders.filter((o) => now - o.ts < HOUR_MS).length,
      loss_streak: state.lossStreak,
      kill_switch: state.killSwitch.manual,
    },
  };

  if (decision.verdict === "DENY") {
    entry.rule = decision.rule;
    entry.detail = decision.detail;
  }
  return entry;
}

/**
 * Append one line. Never throws: this file is evidence, not a dependency. If the
 * disk is full, Leash must still be able to refuse an order — losing the record
 * of a block is bad, failing to block is worse.
 */
export function appendAudit(path: string, entry: AuditEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // deliberately swallowed — see above
  }
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
