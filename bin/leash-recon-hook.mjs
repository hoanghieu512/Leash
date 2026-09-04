#!/usr/bin/env node
// Leash recon hook — Task 0 ONLY.
//
// Two jobs:
//   1. Record what Claude Code hands a PreToolUse hook, so the real enforcement
//      hook can be written against real payloads instead of guesses.
//   2. Optionally prove the BLOCK mechanism works, without risking real money:
//      put a substring in fixtures/BLOCK_MATCH.txt and any MCP tool whose name
//      contains it gets denied. Empty or missing file = nothing is ever blocked.
//
// Remove this hook from .claude/settings.json once fixtures are captured.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "fixtures", "recon.jsonl");
const BLOCK_MATCH_FILE = join(ROOT, "fixtures", "BLOCK_MATCH.txt");

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 800); // never hang the session
  });
}

const raw = await readStdin();
let payload = null;

try {
  try { payload = JSON.parse(raw); } catch { payload = { unparsed_stdin: raw }; }
  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(OUT, JSON.stringify({ captured_at: new Date().toISOString(), payload }) + "\n", "utf8");
} catch {
  // recon must never interfere with a real trading session
}

try {
  const needle = readFileSync(BLOCK_MATCH_FILE, "utf8").trim();
  const toolName = payload?.tool_name ?? "";
  if (needle && toolName.includes(needle)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `LEASH BLOCK TEST: tool "${toolName}" khop chuoi "${needle}" trong fixtures/BLOCK_MATCH.txt. ` +
          `Day la thu nghiem co che chan, chua phai luat that.`
      }
    }));
  }
} catch {
  // no BLOCK_MATCH.txt -> block nothing
}

process.exit(0);
