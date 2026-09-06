import { toIntent, type HookPayload } from "../adapters/binanceTool.js";
import { appendAudit, buildEntry, buildSystemEntry } from "../audit/log.js";
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

/**
 * Rules whose verdict a price can change: a mark can reveal an unrealised loss,
 * or turn an unknown order size into a known one. Every other rule reaches the
 * same answer with or without the network.
 */
const PRICE_SENSITIVE = new Set([
  "daily_loss_kill_switch",
  "max_notional_per_order",
  "no_size_up_after_losses",
]);

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
      "[Leash] The hook received a payload with no tool name, so it cannot tell what was about to run. Refused.",
    );
  }

  try {
    const policy = loadPolicy(deps.policyPath);
    const loaded = loadState(deps.statePath, deps.now, policy.capitalUsdt);
    const equityNow = loaded.dayStartEquity + loaded.realizedPnlToday;
    const state = rollDayIfNeeded(loaded, deps.now, equityNow);

    const intentNoMarks = toIntent(input as HookPayload, state, { now: deps.now });
    if (intentNoMarks === null) return ALLOW; // a read, or another server's tool

    // Ask the rules once with no prices at all. Most refusals — wrong market,
    // wrong symbol, a hard rule, the kill switch — do not depend on what
    // anything costs, and answering them here means never paying for a network
    // round trip to reach a conclusion already reached.
    //
    // This is not only about speed. A leverage change carries no notional, so
    // the old code went looking for a mark price it could not use, and a slow
    // network turned "futures are not allowed" into "Leash ran out of time" —
    // a true statement that tells the reader nothing.
    const dry = evaluate(intentNoMarks, state, policy, { now: deps.now });
    if (isDenied(dry) && !PRICE_SENSITIVE.has(dry.rule)) {
      const reason = findMatchingTicket(state, intentNoMarks, deps.now)?.reason ?? null;
      appendAudit(deps.auditPath, buildEntry(intentNoMarks, state, dry, reason, deps.now));
      return denyOutput(`[Leash · ${dry.rule}] ${dry.detail}`);
    }

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
          "Leash ran out of time evaluating this order and refused it to be safe. Try again in a few seconds.",
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
    const detail = (err as Error).message;
    // No intent was parsed, so this failure would otherwise leave no trace at
    // all — and a tampered state file is exactly the event worth recording.
    appendAudit(deps.auditPath, buildSystemEntry("leash_unavailable", detail, deps.now));
    return denyOutput(`[Leash] Could not evaluate this order: ${detail}`);
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
