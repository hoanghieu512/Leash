import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toIntent } from "../../src/adapters/binanceTool.js";
import { emptyState, isDenied, type LeashState } from "../../src/domain/types.js";
import { evaluate } from "../../src/rules/index.js";
import { T0, policy } from "../helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = emptyState("2026-09-05", 100);
const ctx = { now: T0, marks: { BTCUSDT: 81000 } };

/** Real payloads captured from the hook on 04/09, not hand-written guesses. */
function fixture(pred: (tool: string, input: Record<string, unknown>) => boolean) {
  const lines = readFileSync(join(ROOT, "fixtures", "recon.jsonl"), "utf8").trim().split("\n");
  for (const line of lines) {
    const { payload } = JSON.parse(line) as {
      payload: { tool_name: string; tool_input: Record<string, unknown> };
    };
    if (payload.tool_name !== undefined && pred(payload.tool_name, payload.tool_input ?? {})) {
      return payload;
    }
  }
  throw new Error("fixture not found — did fixtures/recon.jsonl change?");
}

describe("real captured payloads", () => {
  it("reads a real market BUY", () => {
    const p = fixture((t, i) => t.endsWith("spot_newOrder") && i["side"] === "BUY");
    const intent = toIntent(p, S, ctx);

    expect(intent?.canonicalTool).toBe("spot_newOrder");
    expect(intent?.market).toBe("spot");
    expect(intent?.kind).toBe("order");
    expect(intent?.symbol).toBe("BTCUSDT");
    expect(intent?.side).toBe("BUY");
    expect(intent?.notionalUsdt).toBe(12);
    expect(intent?.reduceOnly).toBe(false);
  });

  it("reads a real SELL and calls it a reduction when a position exists", () => {
    const p = fixture((t, i) => t.endsWith("spot_newOrder") && i["side"] === "SELL" && "quantity" in i);
    const held: LeashState = {
      ...S,
      positions: { BTCUSDT: { symbol: "BTCUSDT", quantity: 0.00013986, avgCost: 81061 } },
    };
    const intent = toIntent(p, held, ctx);

    expect(intent?.side).toBe("SELL");
    expect(intent?.reduceOnly).toBe(true);
    expect(intent?.notionalUsdt).toBeCloseTo(0.00007 * 81000, 4);
  });

  it("does not call a SELL a reduction when nothing is held", () => {
    const p = fixture((t, i) => t.endsWith("spot_newOrder") && i["side"] === "SELL");
    expect(toIntent(p, S, ctx)?.reduceOnly).toBe(false);
  });

  it("ignores read-only tools entirely", () => {
    const p = fixture((t) => t.endsWith("spot_ticker24hr"));
    expect(toIntent(p, S, ctx)).toBeNull();
  });

  it("unwraps the real tool_execute payload", () => {
    const p = fixture((t) => t.endsWith("tool_execute"));
    const intent = toIntent(p, S, ctx);

    expect(intent?.rawToolName).toContain("tool_execute");
    // dot-separated inside, underscore-separated outside — both must land here
    expect(intent?.canonicalTool).toBe("spot_newOrder");
    expect(intent?.market).toBe("spot");
    expect(intent?.notionalUsdt).toBe(12);
  });
});

describe("the tool_execute back door", () => {
  const via = (toolName: unknown, args: Record<string, unknown> = {}) =>
    toIntent(
      { tool_name: "mcp__binance-mcp-server__tool_execute", tool_input: { toolName, arguments: args } },
      S,
      ctx,
    );

  it("routes a wrapped futures order into the futures market, where spot_only refuses it", () => {
    const intent = via("futures_usds.newOrder", { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 10 });
    expect(intent?.market).toBe("futures");

    const d = evaluate(intent!, S, policy(), ctx);
    expect(isDenied(d) && d.rule).toBe("spot_only");
  });

  it("cannot smuggle a credential mint past the hard rules", () => {
    const intent = via("margin.createSpecialKey", {});
    const d = evaluate(intent!, S, policy(), ctx);

    expect(isDenied(d) && d.rule).toBe("never_mint_credentials");
  });

  it("refuses a wrapper with no toolName", () => {
    const intent = via(undefined);
    expect(intent?.market).toBe("unknown");
    expect(isDenied(evaluate(intent!, S, policy(), ctx))).toBe(true);
  });

  it("refuses a wrapper naming a tool nobody has heard of", () => {
    const intent = via("spot.someBrandNewThing");
    expect(intent?.market).toBe("unknown");
    expect(isDenied(evaluate(intent!, S, policy(), ctx))).toBe(true);
  });

  it("refuses a non-string toolName instead of coercing it", () => {
    expect(via(42)?.market).toBe("unknown");
  });
});

describe("name matching", () => {
  const direct = (tool: string, input: Record<string, unknown> = {}) =>
    toIntent({ tool_name: `mcp__binance-mcp-server__${tool}`, tool_input: input }, S, ctx);

  it("matches regardless of how the name was cased", () => {
    expect(direct("SPOT_NEWORDER", { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 5 })?.market)
      .toBe("spot");
  });

  it("does not treat a longer name containing a known one as that tool", () => {
    // substring matching here would wave through anything ending in a safe name
    expect(direct("evil_spot_newOrder", { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 5 })?.market)
      .toBe("unknown");
  });

  it("treats a tool from another MCP server as none of its business", () => {
    expect(toIntent({ tool_name: "mcp__other-server__spot_newOrder", tool_input: {} }, S, ctx)).toBeNull();
  });
});

describe("working out what an order is worth", () => {
  const order = (input: Record<string, unknown>) =>
    toIntent({ tool_name: "mcp__binance-mcp-server__spot_newOrder", tool_input: input }, S, ctx);

  it("takes quoteOrderQty at face value", () => {
    expect(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 12 })?.notionalUsdt).toBe(12);
  });

  it("multiplies quantity by an explicit limit price", () => {
    expect(order({ symbol: "BTCUSDT", side: "BUY", quantity: 0.001, price: 80000 })?.notionalUsdt)
      .toBeCloseTo(80, 6);
  });

  it("falls back to the mark price for a market order sized in coin", () => {
    expect(order({ symbol: "BTCUSDT", side: "SELL", quantity: 0.001 })?.notionalUsdt)
      .toBeCloseTo(81, 6);
  });

  it("reports an unknown size rather than guessing when there is no price at all", () => {
    const intent = toIntent(
      { tool_name: "mcp__binance-mcp-server__spot_newOrder", tool_input: { symbol: "ETHUSDT", side: "BUY", quantity: 1 } },
      S,
      { now: T0 },
    );
    expect(intent?.notionalUsdt).toBeNull();
  });

  it("accepts numbers that arrived as strings, the way JSON often carries them", () => {
    expect(order({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: "12.5" })?.notionalUsdt).toBe(12.5);
  });
});
