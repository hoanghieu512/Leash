import { readFileSync } from "node:fs";
import type { AuditEntry } from "./log.js";

export interface Report {
  total: number;
  allowed: number;
  denied: number;
  notionalBlocked: number;
  byRule: { rule: string; count: number }[];
  malformedLines: number;
}

/** Read the trail, skipping lines that cannot be parsed rather than giving up on the file. */
export function readAudit(path: string): { entries: AuditEntry[]; malformed: number } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { entries: [], malformed: 0 };
  }

  const entries: AuditEntry[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      malformed += 1;
    }
  }
  return { entries, malformed };
}

export function summarise(entries: AuditEntry[], malformed = 0): Report {
  const denied = entries.filter((e) => e.verdict === "DENY");
  const counts = new Map<string, number>();
  for (const e of denied) {
    const rule = e.rule ?? "unknown";
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }

  return {
    total: entries.length,
    allowed: entries.length - denied.length,
    denied: denied.length,
    notionalBlocked: denied.reduce((sum, e) => sum + (e.notional ?? 0), 0),
    byRule: [...counts.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
    malformedLines: malformed,
  };
}

export function formatReport(r: Report): string {
  if (r.total === 0) return "Chưa có quyết định nào được ghi lại.";

  const lines = [
    "",
    "  LEASH — sổ quyết định",
    "  ─────────────────────────────────",
    `  Tổng lệnh đi qua Leash   ${r.total}`,
    `  Cho qua                  ${r.allowed}`,
    `  Chặn                     ${r.denied}`,
    `  Giá trị đã chặn          ${r.notionalBlocked.toFixed(2)} USDT`,
  ];

  if (r.byRule.length > 0) {
    lines.push("", "  Luật nào chặn nhiều nhất");
    for (const { rule, count } of r.byRule) {
      lines.push(`    ${count.toString().padStart(3)} × ${rule}`);
    }
  }
  if (r.malformedLines > 0) {
    lines.push("", `  (bỏ qua ${r.malformedLines} dòng hỏng)`);
  }
  lines.push("");
  return lines.join("\n");
}
