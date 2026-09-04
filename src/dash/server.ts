#!/usr/bin/env node
/**
 * Local dashboard. Reads state and the audit trail, renders them, and offers one
 * button.
 *
 * It holds no logic of its own: the kill switch routes through the same handler
 * the MCP tool uses, and every number shown is read from state, never recomputed
 * here. A second place that decides things is a second place to be wrong.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAudit, summarise } from "../audit/report.js";
import { loadPolicy } from "../policy/load.js";
import { setKillSwitch } from "../mcp/handlers.js";
import { rollDayIfNeeded } from "../state/reduce.js";
import { loadState, saveState } from "../state/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Run via `npm run dash` from the repo root; LEASH_HOME overrides for other layouts.
const ROOT = process.env["LEASH_HOME"] ?? process.cwd();
const PORT = Number(process.env["LEASH_PORT"] ?? 4577);

const POLICY_PATH = join(ROOT, "leash.policy.yaml");
const STATE_PATH = join(ROOT, "state.json");
const AUDIT_PATH = join(ROOT, "audit.jsonl");
const PAGE = join(HERE, "public", "index.html");

const HOUR_MS = 60 * 60 * 1000;

function snapshot() {
  const now = Date.now();
  const policy = loadPolicy(POLICY_PATH);

  let state;
  let tampered: string | null = null;
  try {
    const loaded = loadState(STATE_PATH, now, policy.capitalUsdt);
    state = rollDayIfNeeded(loaded, now, loaded.dayStartEquity + loaded.realizedPnlToday);
  } catch (err) {
    // A tampered or unreadable state file is itself the most important thing to
    // show — the dashboard must not go blank at exactly that moment.
    tampered = (err as Error).message;
    state = null;
  }

  const { entries, malformed } = readAudit(AUDIT_PATH);
  const report = summarise(entries, malformed);

  const ordersLastHour =
    state === null ? 0 : state.recentOrders.filter((o) => now - o.ts < HOUR_MS).length;
  const lastTs = state === null ? 0 : state.recentOrders.reduce((m, o) => Math.max(m, o.ts), 0);
  const cooldownLeft =
    lastTs === 0
      ? 0
      : Math.max(0, policy.limits.minSecondsBetweenOrders - Math.floor((now - lastTs) / 1000));

  const lossPct =
    state === null || state.dayStartEquity === 0
      ? 0
      : Math.max(0, (-state.realizedPnlToday / state.dayStartEquity) * 100);

  return {
    now,
    tampered,
    locked: tampered !== null || (state?.killSwitch.manual ?? false),
    day: state?.dayStartUtc ?? "—",
    pnl: state?.realizedPnlToday ?? 0,
    lossPct,
    lossLimit: policy.behavior.dailyLossKillSwitchPct,
    ordersLastHour,
    ordersLimit: policy.limits.maxOrdersPerHour,
    cooldownLeft,
    cooldownLimit: policy.limits.minSecondsBetweenOrders,
    lossStreak: state?.lossStreak ?? 0,
    maxNotional: policy.limits.maxNotionalPerOrder,
    symbols: policy.limits.symbolAllowlist,
    report,
    feed: entries.slice(-40).reverse(),
  };
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  if (url === "/" || url.startsWith("/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(PAGE, "utf8"));
    return;
  }

  if (url === "/api/status") {
    try {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(snapshot()));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (url === "/api/kill" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const { on } = JSON.parse(body || "{}") as { on?: boolean };
        const now = Date.now();
        const policy = loadPolicy(POLICY_PATH);
        const state = loadState(STATE_PATH, now, policy.capitalUsdt);
        const r = setKillSwitch(state, on === true, now);
        saveState(STATE_PATH, r.state);

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, text: r.text }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
    });
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Leash dashboard → http://127.0.0.1:${PORT}\n`);
});
