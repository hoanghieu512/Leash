import { describe, expect, it } from "vitest";
import { extractFill } from "../../src/adapters/fillParser.js";
import { T0 } from "../helpers.js";

/** The shape Binance returned on 04/09 for a MARKET BUY with newOrderRespType FULL. */
const BINANCE_FULL = {
  symbol: "BTCUSDT",
  orderId: 66234582804,
  transactTime: 1757000000000,
  price: "0.00000000",
  origQty: "0.00014000",
  executedQty: "0.00014000",
  cummulativeQuoteQty: "11.34860160",
  status: "FILLED",
  type: "MARKET",
  side: "BUY",
  fills: [
    { price: "81061.44", qty: "0.00014000", commission: "0.00000014", commissionAsset: "BTC", tradeId: 1 },
  ],
};

describe("reading a fill out of whatever the tool returned", () => {
  it("reads a plain Binance response", () => {
    const fill = extractFill(BINANCE_FULL, T0);

    expect(fill?.symbol).toBe("BTCUSDT");
    expect(fill?.side).toBe("BUY");
    expect(fill?.quantity).toBeCloseTo(0.00014, 10);
    expect(fill?.quoteQty).toBeCloseTo(11.3486016, 8);
    expect(fill?.fee).toBeCloseTo(0.00000014, 12);
    expect(fill?.feeAsset).toBe("BTC");
    expect(fill?.orderId).toBe("66234582804");
  });

  it("derives the average fill price from value over quantity", () => {
    expect(extractFill(BINANCE_FULL, T0)?.price).toBeCloseTo(81061.44, 2);
  });

  it("unwraps an MCP content array carrying the JSON as text", () => {
    const wrapped = { content: [{ type: "text", text: JSON.stringify(BINANCE_FULL) }] };
    expect(extractFill(wrapped, T0)?.orderId).toBe("66234582804");
  });

  it("unwraps a bare JSON string", () => {
    expect(extractFill(JSON.stringify(BINANCE_FULL), T0)?.symbol).toBe("BTCUSDT");
  });

  it("finds the order however deeply it is nested", () => {
    const buried = { result: { data: { response: BINANCE_FULL } } };
    expect(extractFill(buried, T0)?.orderId).toBe("66234582804");
  });

  it("sums commission across several fills", () => {
    const multi = {
      ...BINANCE_FULL,
      fills: [
        { price: "81000", qty: "0.00007", commission: "0.00000007", commissionAsset: "BTC" },
        { price: "81100", qty: "0.00007", commission: "0.00000007", commissionAsset: "BTC" },
      ],
    };
    expect(extractFill(multi, T0)?.fee).toBeCloseTo(0.00000014, 12);
  });

  it("reads a SELL whose fee is charged in the quote asset", () => {
    const sell = {
      ...BINANCE_FULL,
      side: "SELL",
      executedQty: "0.00007000",
      cummulativeQuoteQty: "5.67256200",
      fills: [{ price: "81036.60", qty: "0.00007", commission: "0.00567256", commissionAsset: "USDT" }],
    };
    const fill = extractFill(sell, T0);

    expect(fill?.side).toBe("SELL");
    expect(fill?.feeAsset).toBe("USDT");
    expect(fill?.fee).toBeCloseTo(0.00567256, 8);
  });

  it("returns nothing when the order did not fill", () => {
    expect(extractFill({ ...BINANCE_FULL, executedQty: "0.00000000", status: "EXPIRED" }, T0)).toBeNull();
  });

  it("returns nothing for an exchange error", () => {
    expect(extractFill({ code: -1013, msg: "Filter failure: NOTIONAL" }, T0)).toBeNull();
  });

  it("returns nothing for a response that is not an order at all", () => {
    expect(extractFill({ symbol: "BTCUSDT", price: "79902.69" }, T0)).toBeNull();
  });

  it("returns nothing for junk", () => {
    expect(extractFill("not json", T0)).toBeNull();
    expect(extractFill(null, T0)).toBeNull();
    expect(extractFill(undefined, T0)).toBeNull();
  });

  it("falls back to the hook's clock when the response carries no timestamp", () => {
    const { transactTime, ...noTime } = BINANCE_FULL;
    expect(extractFill(noTime, T0)?.ts).toBe(T0);
  });
});
