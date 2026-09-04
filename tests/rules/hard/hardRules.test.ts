import { describe, expect, it } from "vitest";
import { neverMintCredentials } from "../../../src/rules/hard/neverMintCredentials.js";
import { noLeverageFunding } from "../../../src/rules/hard/noLeverageFunding.js";
import { T0, intent } from "../../helpers.js";

const ctx = { now: T0 };

describe("never_mint_credentials", () => {
  const KEY_TOOLS = [
    "margin_createSpecialKey",
    "margin_editIpForSpecialKey",
    "margin_deleteSpecialKey",
    "margin_exitSpecialKeyMode",
  ];

  for (const tool of KEY_TOOLS) {
    it(`blocks ${tool}`, () => {
      const v = neverMintCredentials.check(
        intent({ canonicalTool: tool, market: "margin" }), ctx,
      );
      expect(v?.rule).toBe("never_mint_credentials");
    });
  }

  it("blocks it just the same when smuggled through tool_execute", () => {
    const v = neverMintCredentials.check(
      intent({
        rawToolName: "mcp__binance-mcp-server__tool_execute",
        canonicalTool: "margin_createSpecialKey",
      }),
      ctx,
    );
    expect(v).not.toBeNull();
  });

  it("says why, in terms of what the key would let the agent do", () => {
    const v = neverMintCredentials.check(intent({ canonicalTool: "margin_createSpecialKey" }), ctx);
    expect(v?.detail).toMatch(/MCP|Leash|guard/i);
  });

  it("leaves ordinary trading alone", () => {
    expect(neverMintCredentials.check(intent({ canonicalTool: "spot_newOrder" }), ctx)).toBeNull();
  });

  it("takes no policy argument at all — there must be no switch to flip", () => {
    expect(neverMintCredentials.check.length).toBe(2);
  });
});

describe("no_leverage_funding", () => {
  const transfer = (type: unknown) =>
    intent({ canonicalTool: "wallet_userUniversalTransfer", market: "wallet", args: { type, asset: "USDT", amount: 50 } });

  it("blocks spot into USD-M futures", () => {
    const v = noLeverageFunding.check(transfer("MAIN_UMFUTURE"), ctx);
    expect(v?.rule).toBe("no_leverage_funding");
    expect(v?.detail).toContain("MAIN_UMFUTURE");
  });

  it("blocks spot into margin", () => {
    expect(noLeverageFunding.check(transfer("MAIN_MARGIN"), ctx)).not.toBeNull();
  });

  it("blocks spot into portfolio margin", () => {
    expect(noLeverageFunding.check(transfer("MAIN_PORTFOLIO_MARGIN"), ctx)).not.toBeNull();
  });

  it("allows futures back into spot — the retreat must stay open", () => {
    expect(noLeverageFunding.check(transfer("UMFUTURE_MAIN"), ctx)).toBeNull();
  });

  it("allows margin back into spot", () => {
    expect(noLeverageFunding.check(transfer("MARGIN_MAIN"), ctx)).toBeNull();
  });

  it("allows spot into funding — funding carries no leverage", () => {
    expect(noLeverageFunding.check(transfer("MAIN_FUNDING"), ctx)).toBeNull();
  });

  it("blocks a transfer type it has never seen", () => {
    expect(noLeverageFunding.check(transfer("MAIN_SOMETHING_NEW"), ctx)).not.toBeNull();
  });

  it("blocks a transfer with no type at all", () => {
    expect(noLeverageFunding.check(transfer(undefined), ctx)).not.toBeNull();
  });

  it("blocks a non-string type instead of coercing it", () => {
    expect(noLeverageFunding.check(transfer(42), ctx)).not.toBeNull();
  });

  it("leaves tools that are not transfers alone", () => {
    expect(noLeverageFunding.check(intent({ canonicalTool: "spot_newOrder" }), ctx)).toBeNull();
  });

  it("takes no policy argument at all", () => {
    expect(noLeverageFunding.check.length).toBe(2);
  });
});
