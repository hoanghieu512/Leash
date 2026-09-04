import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { LeashState } from "../domain/types.js";

/**
 * Tamper-EVIDENCE, not tamper-proofing. Be honest about which one this is.
 *
 * state.json holds the numbers three behavioural rules depend on: the losing
 * streak, the day's realised P&L, the kill switch. An agent with a shell runs as
 * the same user as Leash, so it can read this secret and forge a signature if it
 * sets out to. What signing buys is that editing the file is no longer enough —
 * a tamper has to be deliberate, and every mismatch is refused and recorded.
 *
 * Closing the gap properly means separating privileges: a different uid, a
 * container, or a service off the machine. That is a deployment decision, not
 * something this file can fix.
 */
const SIG_FIELD = "sig";

export function loadOrCreateSecret(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();

  const secret = randomBytes(32).toString("hex");
  writeFileSync(path, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return secret;
}

/** Stable serialisation: key order must not change the signature. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => k !== SIG_FIELD && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function sign(state: LeashState, secret: string): string {
  return createHmac("sha256", secret).update(canonical(state)).digest("hex");
}

export function verify(state: LeashState & { sig?: string }, secret: string): boolean {
  if (typeof state.sig !== "string" || state.sig.length === 0) return false;

  const expected = Buffer.from(sign(state, secret), "utf8");
  const actual = Buffer.from(state.sig, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
