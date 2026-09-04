import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAudit, buildEntry, type AuditEntry } from "../../src/audit/log.js";
import { formatReport, readAudit, summarise } from "../../src/audit/report.js";
import { allow, deny, emptyState } from "../../src/domain/types.js";
import { T0, intent } from "../helpers.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-audit-"));
  path = join(dir, "audit.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const S = emptyState("2026-09-05", 100);

describe("entries", () => {
  it("records a denial with the rule and the explanation", () => {
    const e = buildEntry(intent({ notionalUsdt: 180 }), S, deny("max_notional_per_order", "quá lớn", []), null, T0);

    expect(e.verdict).toBe("DENY");
    expect(e.rule).toBe("max_notional_per_order");
    expect(e.detail).toBe("quá lớn");
    expect(e.notional).toBe(180);
  });

  it("records what went through too, with the reason the agent gave", () => {
    const e = buildEntry(intent(), S, allow([]), "breakout above resistance", T0);

    expect(e.verdict).toBe("ALLOW");
    expect(e.agent_reason).toBe("breakout above resistance");
    expect(e.rule).toBeUndefined();
  });

  it("carries no account identifiers — this file ends up on screen", () => {
    const e = buildEntry(intent(), S, allow([]), "x", T0);
    const text = JSON.stringify(e);

    expect(text).not.toMatch(/session|token|apiKey|secret|uid|1273687478/i);
  });
});

describe("appending", () => {
  it("keeps every line and never rewrites an old one", () => {
    appendAudit(path, buildEntry(intent(), S, allow([]), null, T0));
    appendAudit(path, buildEntry(intent(), S, deny("rate_limit", "quá nhanh", []), null, T0 + 1));

    expect(readAudit(path).entries).toHaveLength(2);
  });

  it("stays quiet when the file cannot be written — blocking matters more than recording", () => {
    expect(() => appendAudit("/proc/nope/audit.jsonl", buildEntry(intent(), S, allow([]), null, T0))).not.toThrow();
  });
});

describe("report", () => {
  const entries = (): AuditEntry[] => [
    buildEntry(intent({ notionalUsdt: 12 }), S, allow([]), "ok", T0),
    buildEntry(intent({ notionalUsdt: 180 }), S, deny("max_notional_per_order", "d", []), null, T0),
    buildEntry(intent({ notionalUsdt: 90 }), S, deny("max_notional_per_order", "d", []), null, T0),
    buildEntry(intent({ notionalUsdt: 20 }), S, deny("spot_only", "d", []), null, T0),
  ];

  it("counts allowances, denials and the value kept off the exchange", () => {
    const r = summarise(entries());

    expect(r.total).toBe(4);
    expect(r.allowed).toBe(1);
    expect(r.denied).toBe(3);
    expect(r.notionalBlocked).toBeCloseTo(290, 6);
  });

  it("ranks the rules that fire most", () => {
    expect(summarise(entries()).byRule[0]).toEqual({ rule: "max_notional_per_order", count: 2 });
  });

  it("survives an empty log", () => {
    expect(summarise([]).total).toBe(0);
    expect(formatReport(summarise([]))).toContain("Chưa có");
  });

  it("skips a corrupt line and still totals the rest", () => {
    writeFileSync(
      path,
      [JSON.stringify(entries()[0]), "{ half a line", JSON.stringify(entries()[1])].join("\n"),
      "utf8",
    );
    const { entries: read, malformed } = readAudit(path);
    const r = summarise(read, malformed);

    expect(r.total).toBe(2);
    expect(r.malformedLines).toBe(1);
    expect(formatReport(r)).toContain("1 dòng hỏng");
  });

  it("prints something a person can read out loud", () => {
    const text = formatReport(summarise(entries()));

    expect(text).toContain("Tổng lệnh đi qua Leash");
    expect(text).toContain("290.00 USDT");
    expect(text).toContain("max_notional_per_order");
  });
});
