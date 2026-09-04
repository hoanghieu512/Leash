#!/usr/bin/env node
/** Entry point wired into .claude/settings.json as a PreToolUse hook. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, type HookInput } from "./preToolUse.js";
import { fetchMarks } from "./marks.js";

const ROOT = process.env["LEASH_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), "..");

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 800);
  });
}

const raw = await readStdin();
let input: HookInput;
try {
  input = JSON.parse(raw) as HookInput;
} catch {
  // Unparseable input is still a denial: something called us and we cannot tell what.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "[Leash] Không đọc được dữ liệu hook gửi tới — chặn vì không chắc chắn.",
    },
  }));
  process.exit(0);
}

const out = await decide(input, {
  policyPath: join(ROOT, "leash.policy.yaml"),
  statePath: join(ROOT, "state.json"),
  now: Date.now(),
  fetchMarks,
});

if (out.hookSpecificOutput !== undefined) process.stdout.write(JSON.stringify(out));
process.exit(0);
