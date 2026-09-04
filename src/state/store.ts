import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyState, type LeashState } from "../domain/types.js";
import { loadOrCreateSecret, sign, verify } from "./integrity.js";
import { dayKeyUtc } from "./reduce.js";

export class StateError extends Error {
  override readonly name = "StateError";
}

/**
 * Read state from disk.
 *
 * A missing file is a first run, not a failure — that is the only case that
 * yields a fresh state. A file that exists but cannot be parsed throws, so the
 * caller denies the order: continuing from a blank slate would silently reset
 * the daily loss and the losing streak, which is exactly what a losing agent
 * would benefit from.
 */
export function loadState(
  path: string,
  now: number,
  equityNow: number,
  secretPath = `${path}.key`,
): LeashState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return emptyState(dayKeyUtc(now), equityNow);
  }

  try {
    const parsed = JSON.parse(text) as LeashState & { sig?: string };
    if (typeof parsed.dayStartUtc !== "string" || typeof parsed.realizedPnlToday !== "number") {
      throw new Error("required fields are missing");
    }

    // The losing streak, the daily P&L and the kill switch all live in this file.
    // Rewriting them by hand is the cheapest way to defeat three rules at once,
    // so an unsigned or mis-signed file is treated as tampering.
    if (!verify(parsed, loadOrCreateSecret(secretPath))) {
      throw new StateError(
        `${path} was modified outside Leash — the signature does not match. Every order is refused. ` +
          `To start over, accepting the loss of today's P&L and the losing streak, delete ${path}.`,
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof StateError) throw err;
    throw new StateError(
      `${path} is unreadable (${(err as Error).message}). Leash refuses every order until it is fixed.`,
    );
  }
}

/** Write via a temp file and rename, so a crash mid-write cannot leave torn state. */
export function saveState(path: string, state: LeashState, secretPath = `${path}.key`): void {
  mkdirSync(dirname(path), { recursive: true });
  const signed = { ...state, sig: sign(state, loadOrCreateSecret(secretPath)) };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(signed, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
