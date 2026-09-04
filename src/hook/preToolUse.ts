import { toIntent, type HookPayload } from "../adapters/binanceTool.js";
import { appendAudit, buildEntry } from "../audit/log.js";
import { deny, isDenied, type LeashState, type OrderIntent } from "../domain/types.js";
import { loadPolicy } from "../policy/load.js";
import { evaluate } from "../rules/index.js";
import { consumeTicket, findMatchingTicket, rollDayIfNeeded } from "../state/reduce.js";
import { loadState, saveState } from "../state/store.js";

/** The shape Claude Code hands a PreToolUse hook, as captured live on 04/09. */
export interface HookInput {
  tool_name?: unknown;
  tool_input?: unknown;
  session_id?: unknown;
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

export interface HookDeps {
  policyPath: string;
  statePath: string;
  auditPath: string;
  now: number;
  /** Best-effort public prices. Failure here must never block the session. */
  fetchMarks: (symbols: string[]) => Promise<Record<string, number>>;
  /** Wall-clock budget for the whole decision. */
  budgetMs?: number;
  /** Elapsed-time source, injectable so timeout behaviour can be tested without racing a real clock. */
  clock?: () => number;
}

const ALLOW: HookOutput = {};

function denyOutput(reason: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * The hook's whole job: parse, adapt, ask the rules, persist, answer.
 *
 * Not one line of policy lives here. Every path that cannot reach a confident
 * answer — unreadable config, corrupt state, a crash, running out of time —
 * ends in a denial. A guardrail that fails open is decoration.
 */
export async function decide(input: HookInput, deps: HookDeps): Promise<HookOutput> {
  const budget = deps.budgetMs ?? 1000;
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + budget;

  // A tool name that is present but belongs elsewhere is normal — the matcher may
  // be broad. A tool name that is missing or not a string is not normal: something
  // invoked us and we cannot tell what it was about to do.
  if (typeof input.tool_name !== "string" || input.tool_name.length === 0) {
    return denyOutput(
      "[Leash] Hook nhận payload không có tên tool nên không xác định được lệnh gì sắp chạy — chặn vì không chắc chắn.",
    );
  }

  try {
    const policy = loadPolicy(deps.policyPath);
    const loaded = loadState(deps.statePath, deps.now, policy.capitalUsdt);
    const equityNow = loaded.dayStartEquity + loaded.realizedPnlToday;
    const state = rollDayIfNeeded(loaded, deps.now, equityNow);

    const intentNoMarks = toIntent(input as HookPayload, state, { now: deps.now });
    if (intentNoMarks === null) return ALLOW; // a read, or another server's tool

    // Prices cost a network round trip, so only pay for them when they change an
    // answer: to mark open positions to market, or to size an order that states
    // neither a quote amount nor a price. Most orders need neither.
    const marks = needsPrices(state, intentNoMarks)
      ? await withDeadline(deps.fetchMarks(symbolsToPrice(state, intentNoMarks)), deadline - clock(), {})
      : {};

    const ctx = { now: deps.now, marks };
    const intent = toIntent(input as HookPayload, state, ctx) ?? intentNoMarks;

    // Out of time counts as a decision, and every decision goes in the trail: a
    // block nobody can audit is indistinguishable from no block at all.
    const decision = clock() >= deadline
      ? deny(
          "time_budget",
          "Leash hết thời gian đánh giá lệnh này nên chặn để an toàn. Thử lại sau vài giây.",
          [],
        )
      : evaluate(intent, state, policy, ctx);

    // Read the declaration before it is spent, so the trail records why the
    // agent said it was doing this.
    const reason = findMatchingTicket(state, intent, deps.now)?.reason ?? null;
    appendAudit(deps.auditPath, buildEntry(intent, state, decision, reason, deps.now));

    if (isDenied(decision)) {
      return denyOutput(`[Leash · ${decision.rule}] ${decision.detail}`);
    }

    // The declaration that authorised this order is spent, so it cannot cover a
    // second one. Persisted before the order goes out, not after: if the process
    // dies mid-flight, a ticket burned in error is far cheaper than one reused.
    saveState(deps.statePath, consumeTicket(state, intent, deps.now));
    return ALLOW;
  } catch (err) {
    return denyOutput(
      `[Leash] Không đánh giá được lệnh: ${(err as Error).message} — chặn vì không chắc chắn.`,
    );
  }
}

/** Resolve with a fallback rather than letting a slow call hold up the session. */
async function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return fallback;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Which symbols are worth a price lookup for this decision. */
function symbolsToPrice(state: LeashState, intent: OrderIntent): string[] {
  const symbols = new Set(Object.keys(state.positions));
  if (intent.symbol !== null && intent.notionalUsdt === null) {
    symbols.add(intent.symbol.toUpperCase());
  }
  return [...symbols];
}

function needsPrices(state: LeashState, intent: OrderIntent): boolean {
  return symbolsToPrice(state, intent).length > 0;
}
