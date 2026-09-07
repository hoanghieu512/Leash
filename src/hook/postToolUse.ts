import { toIntent, type HookPayload } from "../adapters/binanceTool.js";
import { extractFill } from "../adapters/fillParser.js";
import { appendAudit, buildSystemEntry } from "../audit/log.js";
import { applyFill, rollDayIfNeeded } from "../state/reduce.js";
import { loadPolicy } from "../policy/load.js";
import { loadState, saveState } from "../state/store.js";

export interface PostHookInput {
  tool_name?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
}

export interface PostHookDeps {
  policyPath: string;
  statePath: string;
  auditPath: string;
  now: number;
}

/**
 * Record what actually happened, after the exchange has spoken.
 *
 * The PreToolUse hook can only see intent. Four rules — the rate limit, the
 * daily loss breaker, the revenge cooldown and the martingale brake — read a
 * history that nothing else writes, so without this they never fire on real
 * trading and exist only for seeded state.
 *
 * This hook never blocks: the order is already placed and refusing after the
 * fact would achieve nothing but noise. Every failure path is swallowed, since
 * a bookkeeping problem must not break the session the user is working in.
 */
export function record(input: PostHookInput, deps: PostHookDeps): void {
  try {
    if (typeof input.tool_name !== "string") return;

    const policy = loadPolicy(deps.policyPath);
    const loaded = loadState(deps.statePath, deps.now, policy.capitalUsdt);

    // Reuse the adapter so tool_execute is unwrapped here exactly as it is on
    // the way in; a fill that arrived through the back door still counts.
    const intent = toIntent(input as HookPayload, loaded, { now: deps.now });
    if (intent === null || intent.kind !== "order") return;

    const fill = extractFill(input.tool_response, deps.now);
    if (fill === null) return;

    const state = rollDayIfNeeded(loaded, deps.now, loaded.dayStartEquity + loaded.realizedPnlToday);
    saveState(deps.statePath, applyFill(state, fill));
  } catch (err) {
    // Losing one fill skews the history; crashing the session helps nobody.
    // The trail records that it happened, so a gap is visible rather than silent.
    try {
      appendAudit(
        deps.auditPath,
        buildSystemEntry("fill_not_recorded", (err as Error).message, deps.now),
      );
    } catch {
      // nothing left to do
    }
  }
}
