#!/usr/bin/env node
/**
 * Seed a losing streak so the behavioural rules can be demonstrated.
 *
 * Producing two real losing round-trips takes hours and real money, and neither
 * makes the demo more honest — the rule being shown reads the streak, not how
 * the streak was earned. So the history is written directly and the recording
 * says so on screen.
 *
 * It goes through saveState rather than editing state.json by hand, because a
 * hand-edited file fails its signature check and Leash then refuses everything.
 * That is the tamper-evidence working; this is the sanctioned way in.
 *
 *   npm run seed:demo               two losses of 12 USDT, 20 minutes ago
 *   npm run seed:demo -- 3 20       three losses of 20 USDT
 *   npm run seed:demo -- 2 12 5     ...placed 5 minutes ago
 *
 * The age matters, and it decides which rule you get to film. revenge_cooldown
 * runs before no_size_up_after_losses, so a streak inside the cooldown window
 * refuses with "wait before re-entering this symbol" and the martingale brake
 * never gets a turn. The default sits outside the window on purpose.
 */
import { join } from "node:path";
import { emptyState, type ClosedTrade } from "../src/domain/types.js";
import { dayKeyUtc } from "../src/state/reduce.js";
import { saveState } from "../src/state/store.js";

const losses = Number(process.argv[2] ?? 2);
const notional = Number(process.argv[3] ?? 12);
// Older than revenge_cooldown_minutes so the martingale rule is the one that answers.
const minutesAgo = Number(process.argv[4] ?? 20);

if (
  !Number.isInteger(losses) || losses < 1 ||
  !Number.isFinite(notional) || notional <= 0 ||
  !Number.isFinite(minutesAgo) || minutesAgo < 0
) {
  process.stderr.write("usage: npm run seed:demo -- [losses] [notional] [minutesAgo]\n");
  process.exit(1);
}

const root = process.env["LEASH_HOME"] ?? process.cwd();
const now = Date.now();

// Spaced a few minutes apart, most recent first — the shape applyFill produces.
const closedTrades: ClosedTrade[] = Array.from({ length: losses }, (_, i) => ({
  symbol: "BTCUSDT",
  pnlUsdt: -(notional * 0.06),
  notionalUsdt: notional,
  ts: now - (minutesAgo + i * 6) * 60_000,
}));

const state = {
  ...emptyState(dayKeyUtc(now), 100),
  realizedPnlToday: closedTrades.reduce((sum, t) => sum + t.pnlUsdt, 0),
  lossStreak: losses,
  closedTrades,
};

saveState(join(root, "state.json"), state);

process.stdout.write(
  `Seeded ${losses} consecutive losing closes of ${notional} USDT on BTCUSDT.\n` +
    `  losing streak     ${losses}\n` +
    `  realised P&L      ${state.realizedPnlToday.toFixed(2)} USDT\n` +
    `  most recent close  ${minutesAgo} minutes ago\n` +
    `  next order may not exceed ${notional} USDT while the streak stands.\n\n` +
    `This history was written, not traded. Say so on screen.\n`,
);
