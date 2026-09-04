import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../../src/proxy/handler.js";
import { emptyState } from "../../src/domain/types.js";
import { saveState } from "../../src/state/store.js";
import { T0 } from "../helpers.js";

const POLICY = `
profile: conservative
capital_usdt: 100
limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT]
  markets: [spot]
behavior:
  daily_loss_kill_switch_pct: 5
  revenge_cooldown_minutes: 15
  no_size_up_after_losses: 2
  require_reason: true
`;

/** Records exactly what the proxy sent, so "the header was forwarded" is provable. */
interface Seen {
  headers: Record<string, string>;
  body: string;
  method: string;
  url: string;
}

let dir: string;
let upstream: Server;
let upstreamUrl: string;
let seen: Seen[];
let proxy: Server;
let proxyUrl: string;

function startUpstream(handler: (seen: Seen) => { status: number; headers: Record<string, string>; body: string }) {
  return new Promise<void>((resolve) => {
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const record: Seen = {
          headers: req.headers as Record<string, string>,
          body,
          method: req.method ?? "",
          url: req.url ?? "",
        };
        seen.push(record);
        const out = handler(record);
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      });
    });
    upstream.listen(0, "127.0.0.1", () => {
      const addr = upstream.address();
      upstreamUrl = typeof addr === "object" && addr !== null ? `http://127.0.0.1:${addr.port}/mcp` : "";
      resolve();
    });
  });
}

function startProxy() {
  return new Promise<void>((resolve) => {
    const handle = createHandler({
      upstream: upstreamUrl,
      root: dir,
      fetchMarks: async () => ({ BTCUSDT: 81000 }),
    });
    proxy = createServer((req, res) => { void handle(req, res); });
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address();
      proxyUrl = typeof addr === "object" && addr !== null ? `http://127.0.0.1:${addr.port}` : "";
      resolve();
    });
  });
}

const call = (name: string, args: Record<string, unknown>, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "leash-proxy-"));
  writeFileSync(join(dir, "leash.policy.yaml"), POLICY, "utf8");
  seen = [];
  await startUpstream(() => ({
    status: 200,
    headers: { "content-type": "application/json", "mcp-session-id": "sess-42" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
  }));
  await startProxy();
});

afterEach(() => {
  proxy.close();
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
});

function declare(notional: number) {
  saveState(join(dir, "state.json"), {
    ...emptyState("2026-09-05", 100),
    tickets: [{ symbol: "BTCUSDT", side: "BUY", notionalUsdt: notional, reason: "declared", ts: Date.now(), consumed: false }],
  });
}

describe("forwarding", () => {
  it("carries the Authorization header through untouched", async () => {
    declare(12);
    await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok-abc123" },
      body: call("spot_newOrder", { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers["authorization"]).toBe("Bearer tok-abc123");
  });

  it("carries the MCP session id in both directions", async () => {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-session-id": "sess-42" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(seen[0]?.headers["mcp-session-id"]).toBe("sess-42");
    expect(res.headers.get("mcp-session-id")).toBe("sess-42");
  });

  it("passes a read straight through without judging it", async () => {
    await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: call("spot_ticker24hr", { symbol: "BTCUSDT" }),
    });

    expect(seen).toHaveLength(1);
  });

  it("leaves non-tool traffic alone", async () => {
    await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(seen).toHaveLength(1);
  });
});

describe("refusing", () => {
  it("stops an oversized order before it leaves the machine", async () => {
    declare(180);
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok" },
      body: call("spot_newOrder", { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 180 }, 7),
    });
    const json = (await res.json()) as { id: number; error: { message: string } };

    // The point of a transport-level guard: upstream never heard about it.
    expect(seen).toHaveLength(0);
    expect(json.id).toBe(7);
    expect(json.error.message).toContain("max_notional_per_order");
  });

  it("closes the tool_execute back door here too", async () => {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: call("tool_execute", {
        toolName: "futures_usds.newOrder",
        arguments: { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 40 },
      }),
    });
    const json = (await res.json()) as { error: { message: string } };

    expect(seen).toHaveLength(0);
    expect(json.error.message).toContain("spot_only");
  });

  it("refuses a credential mint", async () => {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: call("tool_execute", { toolName: "margin.createSpecialKey", arguments: {} }),
    });
    const json = (await res.json()) as { error: { message: string } };

    expect(seen).toHaveLength(0);
    expect(json.error.message).toContain("never_mint_credentials");
  });

  it("gives the same sentence the hook would have given", async () => {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: call("spot_newOrder", { symbol: "PEPEUSDT", side: "BUY", quoteOrderQty: 9 }),
    });
    const json = (await res.json()) as { error: { message: string } };

    expect(json.error.message).toBe(
      "[Leash · symbol_allowlist] PEPEUSDT is not on the allowlist (BTCUSDT, ETHUSDT).",
    );
  });
});

describe("streaming", () => {
  it("relays an SSE stream chunk by chunk instead of buffering it", async () => {
    // Buffering an event stream that never ends would hang the client forever,
    // so the first chunk must arrive before the last one is written.
    upstream.close();
    await new Promise<void>((resolve) => {
      upstream = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("data: first\n\n");
          setTimeout(() => { res.write("data: second\n\n"); res.end(); }, 120);
        });
      });
      upstream.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = upstream.address();
    upstreamUrl = typeof addr === "object" && addr !== null ? `http://127.0.0.1:${addr.port}/mcp` : "";
    proxy.close();
    await startProxy();

    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const firstChunk = decoder.decode((await reader.read()).value);
    expect(firstChunk).toContain("first");
    expect(firstChunk).not.toContain("second"); // proof it was not buffered whole

    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value);
    }
    expect(rest).toContain("second");
  });
});

describe("upstream failure", () => {
  it("reports an unreachable upstream instead of hanging", async () => {
    upstream.close();
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain("upstream unreachable");
  });
});
