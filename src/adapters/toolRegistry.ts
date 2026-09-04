import type { IntentKind, Market } from "../domain/types.js";

export interface ToolFacts {
  market: Market;
  kind: IntentKind;
  /** Does calling this change anything? Reads never reach the rules. */
  writes: boolean;
}

/**
 * What Leash knows about the Binance MCP surface.
 *
 * Scanned live on 04/09: 316 callable tools, of which tools/list advertises 79.
 * This registry covers those 79 plus the hidden credential tools, because those
 * are the ones an agent reaches without going looking.
 *
 * Anything absent is not "probably fine". An unknown tool becomes market
 * "unknown" and kind "order", which the order rules refuse — recognising every
 * safe tool is achievable, recognising every dangerous one is not.
 *
 * Cancels are writes but classed "non_order": they only ever reduce exposure,
 * and blocking the agent from cancelling its own mistakes would make Leash the
 * cause of the loss.
 */
const READ: ToolFacts = { market: "spot", kind: "non_order", writes: false };
const spotOrder: ToolFacts = { market: "spot", kind: "order", writes: true };
const marginOrder: ToolFacts = { market: "margin", kind: "order", writes: true };
const futuresOrder: ToolFacts = { market: "futures", kind: "order", writes: true };
const cancel = (market: Market): ToolFacts => ({ market, kind: "non_order", writes: true });
const walletWrite: ToolFacts = { market: "wallet", kind: "non_order", writes: true };

export const TOOL_REGISTRY: Readonly<Record<string, ToolFacts>> = {
  // ---- spot ----
  spot_newOrder: spotOrder,
  spot_deleteOrder: cancel("spot"),
  spot_deleteOpenOrders: cancel("spot"),
  spot_depth: READ,
  spot_exchangeInfo: READ,
  spot_getAccount: READ,
  spot_getOpenOrders: READ,
  spot_getOrder: READ,
  spot_klines: READ,
  spot_myTrades: READ,
  spot_ticker24hr: READ,
  spot_tickerPrice: READ,
  spot_uiKlines: READ,

  // ---- margin ----
  margin_marginAccountNewOrder: marginOrder,
  // Borrowing is how a spot account becomes a leveraged one.
  margin_marginAccountBorrowRepay: marginOrder,
  margin_marginAccountCancelOrder: cancel("margin"),
  margin_marginAccountCancelAllOpenOrdersOnASymbol: cancel("margin"),
  margin_crossMarginCollateralRatio: READ,
  margin_getAllIsolatedMarginSymbol: READ,
  margin_getAllMarginAssets: READ,
  margin_queryCrossMarginAccountDetails: READ,
  margin_queryMarginAccountsAllOrders: READ,
  margin_queryMarginAccountsOpenOrders: READ,
  margin_queryMarginAccountsOrder: READ,
  margin_queryMarginAccountsTradeList: READ,
  margin_queryMaxBorrow: READ,

  // ---- credential tools (hidden; reachable only via tool_execute) ----
  margin_createSpecialKey: walletWrite,
  margin_editIpForSpecialKey: walletWrite,
  margin_deleteSpecialKey: walletWrite,
  margin_exitSpecialKeyMode: walletWrite,

  // ---- USD-M futures ----
  futures_usds_newOrder: futuresOrder,
  futures_usds_changeInitialLeverage: futuresOrder,
  futures_usds_changeMarginType: futuresOrder,
  futures_usds_cancelOrder: cancel("futures"),
  futures_usds_accountInformationV3: READ,
  futures_usds_continuousContractKlineCandlestickData: READ,
  futures_usds_currentAllOpenOrders: READ,
  futures_usds_exchangeInformation: READ,
  futures_usds_futuresAccountBalanceV3: READ,
  futures_usds_indexPriceKlineCandlestickData: READ,
  futures_usds_klineCandlestickData: READ,
  futures_usds_markPriceKlineCandlestickData: READ,
  futures_usds_positionInformationV2: READ,
  futures_usds_premiumIndexKlineData: READ,
  futures_usds_queryOrder: READ,
  futures_usds_symbolPriceTicker: READ,

  // ---- COIN-M futures ----
  futures_coin_newOrder: futuresOrder,
  futures_coin_changeInitialLeverage: futuresOrder,
  futures_coin_changeMarginType: futuresOrder,
  futures_coin_cancelOrder: cancel("futures"),
  futures_coin_accountInformation: READ,
  futures_coin_continuousContractKlineCandlestickData: READ,
  futures_coin_currentAllOpenOrders: READ,
  futures_coin_exchangeInformation: READ,
  futures_coin_futuresAccountBalance: READ,
  futures_coin_indexPriceKlineCandlestickData: READ,
  futures_coin_klineCandlestickData: READ,
  futures_coin_markPriceKlineCandlestickData: READ,
  futures_coin_positionInformation: READ,
  futures_coin_premiumIndexKlineData: READ,
  futures_coin_queryOrder: READ,
  futures_coin_symbolPriceTicker: READ,

  // ---- convert ----
  convert_acceptQuote: { market: "convert", kind: "order", writes: true },
  convert_placeLimitOrder: { market: "convert", kind: "order", writes: true },
  convert_cancelLimitOrder: cancel("convert"),
  convert_sendQuoteRequest: READ,
  convert_getConvertTradeHistory: READ,
  convert_listAllConvertPairs: READ,
  convert_orderStatus: READ,
  convert_queryLimitOpenOrders: READ,
  convert_queryOrderQuantityPrecisionPerAsset: READ,

  // ---- wallet ----
  wallet_userUniversalTransfer: walletWrite,
  wallet_accountStatus: READ,
  wallet_allCoinsInformation: READ,
  wallet_dailyAccountSnapshot: READ,
  wallet_depositAddress: READ,
  wallet_depositHistory: READ,
  wallet_getApiKeyPermission: READ,
  wallet_queryUserUniversalTransferHistory: READ,
  wallet_queryUserWalletBalance: READ,
  wallet_withdrawHistory: READ,

  // ---- misc ----
  analysis_getTokenAiReport: READ,
  sub_account_getMainAccountAsset: READ,
  tool_search: READ,
};

export const MCP_PREFIX = "mcp__binance-mcp-server__";
export const TOOL_EXECUTE = "tool_execute";
