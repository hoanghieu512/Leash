import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyState, type LeashState } from "../domain/types.js";
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
export function loadState(path: string, now: number, equityNow: number): LeashState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return emptyState(dayKeyUtc(now), equityNow);
  }

  try {
    const parsed = JSON.parse(text) as LeashState;
    if (typeof parsed.dayStartUtc !== "string" || typeof parsed.realizedPnlToday !== "number") {
      throw new Error("thiếu trường bắt buộc");
    }
    return parsed;
  } catch (err) {
    throw new StateError(
      `${path} hỏng (${(err as Error).message}). Leash chặn mọi lệnh cho tới khi file này đọc được — ` +
        `xoá nó chỉ khi huynh chấp nhận mất lịch sử lãi/lỗ trong ngày và chuỗi lỗ.`,
    );
  }
}

/** Write via a temp file and rename, so a crash mid-write cannot leave torn state. */
export function saveState(path: string, state: LeashState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
