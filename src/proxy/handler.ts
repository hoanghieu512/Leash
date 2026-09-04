import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { decide, type HookInput } from "../hook/preToolUse.js";

export interface ProxyConfig {
  upstream: string;
  root: string;
  fetchMarks: (symbols: string[]) => Promise<Record<string, number>>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Headers worth carrying upstream. Everything else is hop-by-hop noise. */
const FORWARD_REQUEST = [
  "authorization",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];
const FORWARD_RESPONSE = ["content-type", "mcp-session-id", "www-authenticate", "cache-control"];

interface JsonRpcCall {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(buf));
  });
}

/**
 * Turn one MCP tools/call into the shape the hook already understands, so both
 * front doors ask the identical question of the identical rules.
 */
export function asHookInput(call: JsonRpcCall): HookInput | null {
  if (call.method !== "tools/call") return null;
  const name = call.params?.name;
  if (typeof name !== "string") return null;

  return {
    tool_name: `mcp__binance-mcp-server__${name}`,
    tool_input: call.params?.arguments ?? {},
  };
}

export function rpcError(id: unknown, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } });
}

export function createHandler(config: ProxyConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const upstreamOrigin = new URL(config.upstream).origin;

  async function judge(bodyText: string): Promise<{ refusal: string; id: unknown } | null> {
    let call: JsonRpcCall;
    try {
      call = JSON.parse(bodyText) as JsonRpcCall;
    } catch {
      return null; // not JSON — let upstream decide what to do with it
    }

    const input = asHookInput(call);
    if (input === null) return null;

    const out = await decide(input, {
      policyPath: join(config.root, "leash.policy.yaml"),
      statePath: join(config.root, "state.json"),
      auditPath: join(config.root, "audit.jsonl"),
      now: Date.now(),
      fetchMarks: config.fetchMarks,
    });

    const reason = out.hookSpecificOutput?.permissionDecisionReason;
    return reason === undefined ? null : { refusal: reason, id: call.id };
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    // Point clients at the upstream's own OAuth metadata. Leash issues nothing.
    if (url.pathname.startsWith("/.well-known/")) {
      const upstreamRes = await doFetch(`${upstreamOrigin}${url.pathname}`, {
        headers: { accept: "application/json" },
      });
      const text = await upstreamRes.text();
      res.writeHead(upstreamRes.status, { "content-type": "application/json" });
      res.end(text);
      return;
    }

    const bodyText = req.method === "POST" ? await readBody(req) : "";

    if (bodyText !== "") {
      const verdict = await judge(bodyText);
      if (verdict !== null) {
        // Refused here, so the request never leaves the machine at all.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(rpcError(verdict.id, verdict.refusal));
        return;
      }
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARD_REQUEST) {
      const v = req.headers[name];
      if (typeof v === "string") headers[name] = v;
    }

    const init: RequestInit = { method: req.method ?? "POST", headers };
    if (bodyText !== "") init.body = bodyText;

    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(config.upstream, init);
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(rpcError(null, `[Leash proxy] upstream unreachable: ${(err as Error).message}`));
      return;
    }

    const outHeaders: Record<string, string> = {};
    for (const name of FORWARD_RESPONSE) {
      const v = upstreamRes.headers.get(name);
      if (v !== null) outHeaders[name] = v;
    }
    res.writeHead(upstreamRes.status, outHeaders);

    if (upstreamRes.body === null) {
      res.end();
      return;
    }

    // Stream rather than buffer: an SSE response never ends, and buffering it
    // would hang the client forever.
    const reader = upstreamRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // client hung up mid-stream
    }
    res.end();
  };
}
