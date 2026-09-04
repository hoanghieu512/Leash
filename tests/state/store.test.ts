import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../../src/domain/types.js";
import { applyFill } from "../../src/state/reduce.js";
import { StateError, loadState, saveState } from "../../src/state/store.js";

let dir: string;
let path: string;
const NOW = Date.UTC(2026, 8, 5, 10, 0, 0);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-state-"));
  path = join(dir, "state.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("state store", () => {
  it("round-trips a state that has history in it", () => {
    let s = emptyState("2026-09-05", 100);
    s = applyFill(s, {
      symbol: "BTCUSDT", side: "BUY", quantity: 0.00014, price: 81061.44,
      quoteQty: 11.3486016, feeAsset: "BTC", fee: 0.00000014, orderId: "66234582804", ts: NOW,
    });
    saveState(path, s);

    // The file also carries a signature; everything Leash reasons about must survive.
    expect(loadState(path, NOW, 100)).toMatchObject(s);
  });

  it("treats a missing file as a first run, not an error", () => {
    const s = loadState(path, NOW, 100);

    expect(s.dayStartUtc).toBe("2026-09-05");
    expect(s.dayStartEquity).toBe(100);
    expect(s.realizedPnlToday).toBe(0);
  });

  it("refuses to start blank when the file exists but is corrupt", () => {
    writeFileSync(path, "{ not json", "utf8");

    // Starting fresh here would quietly wipe the day's losses and the streak —
    // the two numbers a losing agent most benefits from losing.
    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("refuses a file that parses but is missing required fields", () => {
    writeFileSync(path, JSON.stringify({ hello: "world" }), "utf8");
    expect(() => loadState(path, NOW, 100)).toThrow(StateError);
  });

  it("leaves no temp file behind", async () => {
    const { readdirSync } = await import("node:fs");
    saveState(path, emptyState("2026-09-05", 100));

    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["state.json", "state.json.key"]);
  });
});
