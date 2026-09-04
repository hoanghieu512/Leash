#!/usr/bin/env node
/**
 * The Leash MCP server: four tools the agent uses to stay on the right side of
 * the rules.
 *
 * It decides nothing of its own — every answer routes through the same
 * evaluate() the hook calls. Two sources of truth would let an agent be told one
 * thing here and another at the boundary.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchMarks } from "../hook/marks.js";
import { loadPolicy } from "../policy/load.js";
import { loadState, saveState } from "../state/store.js";
import { rollDayIfNeeded } from "../state/reduce.js";
import { budgetStatus, checkOrder, setKillSwitch, whyBlocked } from "./handlers.js";

// Bundled to bin/, so the repo root is one level up — same as the hook.
const ROOT = process.env["LEASH_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = join(ROOT, "leash.policy.yaml");
const STATE_PATH = join(ROOT, "state.json");
const AUDIT_PATH = join(ROOT, "audit.jsonl");

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

/** Load policy and state together, rolling the day over if the clock has. */
function open(now: number) {
  const policy = loadPolicy(POLICY_PATH);
  const loaded = loadState(STATE_PATH, now, policy.capitalUsdt);
  const state = rollDayIfNeeded(loaded, now, loaded.dayStartEquity + loaded.realizedPnlToday);
  return { policy, state };
}

async function marksFor(state: { positions: Record<string, unknown> }, extra?: string) {
  const symbols = new Set(Object.keys(state.positions));
  if (extra !== undefined) symbols.add(extra.toUpperCase());
  return symbols.size === 0 ? {} : await fetchMarks([...symbols]);
}

const server = new McpServer({ name: "leash", version: "0.1.0" });

server.registerTool(
  "check_order",
  {
    title: "Declare an order before placing it",
    description:
      "Declare what you are about to trade and why. Leash tells you immediately whether the order " +
      "would pass, and records the declaration. An order placed without one is refused.",
    inputSchema: {
      symbol: z.string().describe("e.g. BTCUSDT"),
      side: z.enum(["BUY", "SELL"]),
      notional: z.number().positive().describe("Order size in USDT"),
      reason: z.string().min(1).describe("Why this trade, in your own words"),
    },
  },
  async ({ symbol, side, notional, reason }) => {
    const now = Date.now();
    const { policy, state } = open(now);
    const marks = await marksFor(state, symbol);
    const r = checkOrder({ symbol, side, notional, reason }, state, policy, { now, marks });
    saveState(STATE_PATH, r.state);
    return text(r.text);
  },
);

server.registerTool(
  "budget_status",
  {
    title: "How much room is left",
    description:
      "Current limits and how close you are to them: daily P&L against the kill-switch threshold, " +
      "orders used this hour, cooldown remaining, losing streak, allowed symbols.",
    inputSchema: {},
  },
  async () => {
    const now = Date.now();
    const { policy, state } = open(now);
    const marks = await marksFor(state);
    return text(budgetStatus(state, policy, { now, marks }));
  },
);

server.registerTool(
  "why_blocked",
  {
    title: "Explain the last refusal",
    description: "Show the most recent order Leash refused, which rule stopped it, and why.",
    inputSchema: {},
  },
  () => text(whyBlocked(AUDIT_PATH)),
);

server.registerTool(
  "kill_switch",
  {
    title: "Stop or resume opening trades",
    description:
      "Turn the manual stop on or off. While on, no new or larger position may be opened; " +
      "closing an existing one still works.",
    inputSchema: { on: z.boolean().describe("true to stop trading, false to resume") },
  },
  ({ on }) => {
    const now = Date.now();
    const { state } = open(now);
    const r = setKillSwitch(state, on, now);
    saveState(STATE_PATH, r.state);
    return text(r.text);
  },
);

await server.connect(new StdioServerTransport());
