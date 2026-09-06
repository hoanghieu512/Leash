#!/usr/bin/env node
/**
 * Transport-level proxy: the same rules, for MCP clients other than Claude Code.
 *
 * Token passthrough, never token custody. The client performs OAuth directly
 * with Binance and Leash forwards the Authorization header untouched — it never
 * registers a client, never holds a refresh token, never writes one down. A
 * project selling a story about restraint should not be asking to hold your
 * credentials.
 *
 * Binance's authorization server advertises no registration_endpoint, so a proxy
 * could not obtain its own client identity even if it wanted one. Passthrough is
 * not merely the tidier design here; it is the only one available.
 */
import { createServer } from "node:http";
import { fetchMarks } from "../hook/marks.js";
import { createHandler, rpcError } from "./handler.js";

const UPSTREAM = process.env["LEASH_UPSTREAM"] ?? "https://agent.binance.com/mcp/agentic";
const PORT = Number(process.env["LEASH_PROXY_PORT"] ?? 4578);
const ROOT = process.env["LEASH_HOME"] ?? process.cwd();

const handle = createHandler({ upstream: UPSTREAM, root: ROOT, fetchMarks });

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(rpcError(null, `[Leash proxy] ${(err as Error).message}`));
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // A stack trace here tells the reader nothing they can act on.
    process.stderr.write(
      `Port ${PORT} is already in use — the Leash proxy is probably already running.\n` +
        `  Stop it with: lsof -ti :${PORT} -sTCP:LISTEN | xargs kill\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Leash proxy → http://127.0.0.1:${PORT}/  (upstream ${UPSTREAM})\n`);
});
