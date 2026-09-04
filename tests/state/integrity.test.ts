import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { StateError, loadState, saveState } from "../../src/state/store.js";

let dir: string;
let path: string;
const NOW = Date.UTC(2026, 8, 5, 10, 0, 0);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-integrity-"));
  path = join(dir, "state.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lost = (streak: number) => ({ ...emptyState("2026-09-05", 100), lossStreak: streak, realizedPnlToday: -8 });

describe("signed state", () => {
  it("round-trips what Leash itself wrote", () => {
    saveState(path, lost(3));
    expect(loadState(path, NOW, 100).lossStreak).toBe(3);
  });

  it("keeps the secret readable only by its owner", () => {
    saveState(path, lost(1));
    expect(statSync(`${path}.key`).mode & 0o077).toBe(0);
  });

  it("refuses a file whose losing streak was edited by hand", () => {
    saveState(path, lost(3));
    const edited = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    edited["lossStreak"] = 0; // the exact edit that would unlock martingale
    writeFileSync(path, JSON.stringify(edited), "utf8");

    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("refuses a file whose daily loss was wiped", () => {
    saveState(path, lost(2));
    const edited = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    edited["realizedPnlToday"] = 0;
    writeFileSync(path, JSON.stringify(edited), "utf8");

    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("refuses a file whose kill switch was flipped off", () => {
    saveState(path, { ...emptyState("2026-09-05", 100), killSwitch: { manual: true } });
    const edited = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    edited["killSwitch"] = { manual: false };
    writeFileSync(path, JSON.stringify(edited), "utf8");

    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("refuses a state with no signature at all", () => {
    writeFileSync(path, JSON.stringify(emptyState("2026-09-05", 100)), "utf8");
    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("refuses a signature made with a different secret", () => {
    saveState(path, lost(1));
    writeFileSync(`${path}.key`, "a-different-secret\n", "utf8");

    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("is unaffected by key order in the file", () => {
    saveState(path, lost(2));
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    writeFileSync(path, JSON.stringify(reordered), "utf8");

    expect(loadState(path, NOW, 100).lossStreak).toBe(2);
  });
});
