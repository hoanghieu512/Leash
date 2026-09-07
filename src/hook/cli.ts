#!/usr/bin/env node
/** Entry point wired into settings.json as both a PreToolUse and PostToolUse hook. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, type HookInput } from "./preToolUse.js";
import { record, type PostHookInput } from "./postToolUse.js";
import { fetchMarks } from "./marks.js";

const ROOT = process.env["LEASH_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), "..");

const paths = {
  policyPath: join(ROOT, "leash.policy.yaml"),
  statePath: join(ROOT, "state.json"),
  auditPath: join(ROOT, "audit.jsonl"),
};

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
let input: { hook_event_name?: unknown } & HookInput & PostHookInput;
try {
  input = JSON.parse(raw) as typeof input;
} catch {
  // Unparseable input is still a denial: something called us and we cannot tell what.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "[Leash] Could not parse the hook payload. Refused, because it is not clear what was about to run.",
    },
  }));
  process.exit(0);
}

// After the fact: the exchange has already answered, so there is nothing left to
// refuse. Write down what happened and stay silent.
if (input.hook_event_name === "PostToolUse") {
  record(input, { ...paths, now: Date.now() });
  process.exit(0);
}

const out = await decide(input, { ...paths, now: Date.now(), fetchMarks });
if (out.hookSpecificOutput !== undefined) process.stdout.write(JSON.stringify(out));
process.exit(0);
