/**
 * Public price lookup. No authentication, no MCP — this must not depend on the
 * very connection Leash is policing.
 *
 * data-api.binance.vision is Binance's own read-only mirror and answers from
 * regions where the main API host is restricted.
 */
const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

export async function fetchMarks(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  for (const host of HOSTS) {
    try {
      const url = `${host}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (!res.ok) continue;

      const rows = (await res.json()) as { symbol: string; price: string }[];
      const out: Record<string, number> = {};
      for (const r of rows) {
        const n = Number(r.price);
        if (Number.isFinite(n)) out[r.symbol] = n;
      }
      return out;
    } catch {
      // Try the next host; an unreachable price feed costs unrealised P&L
      // precision, and the rule says so in its own message.
    }
  }
  return {};
}
