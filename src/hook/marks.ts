/**
 * Public price lookup. No authentication, no MCP — this must not depend on the
 * very connection Leash is policing.
 *
 * data-api.binance.vision is Binance's own read-only mirror and answers from
 * regions where the main API host is restricted.
 */
const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

async function askHost(host: string, symbols: string[]): Promise<Record<string, number>> {
  const url = `${host}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(600) });
  if (!res.ok) throw new Error(`${host} answered ${res.status}`);

  const rows = (await res.json()) as { symbol: string; price: string }[];
  const out: Record<string, number> = {};
  for (const r of rows) {
    const n = Number(r.price);
    if (Number.isFinite(n)) out[r.symbol] = n;
  }
  return out;
}

/**
 * Both hosts at once, first answer wins.
 *
 * Asking them in turn meant one slow host spent the whole time budget before
 * the second was even tried — and a hook that runs out of time refuses the
 * order, so a sluggish price feed became a refusal with the wrong reason.
 */
export async function fetchMarks(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  try {
    return await Promise.any(HOSTS.map((h) => askHost(h, symbols)));
  } catch {
    // No host answered. Unrealised P&L simply goes unpriced, and the rule that
    // needed it says so in its own message.
    return {};
  }
}
