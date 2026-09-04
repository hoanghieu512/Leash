# Dip Ladder — a trading workflow for Leash to police

This is the agent half of the submission. Leash is the discipline; this file is
the thing being disciplined.

Read it top to bottom and you can run the same agent. It is written for an agent
to follow, not for a machine to parse — every rule is stated precisely enough
that two people running it reach the same decision.

## What this strategy is, honestly

A crude mean-reversion ladder: buy a fixed amount of a major pair after it has
fallen a moderate amount over 24 hours, sell it back on a small bounce or a
larger drop.

**It has no proven edge, and it is not presented as one.** No backtest is
claimed, because none was run. The strategy is deliberately ordinary, and that
is the point of the submission: most trading agents do not fail because their
idea was wrong. They fail because nothing stopped them when it was — they doubled
after a loss, went back into the trade that just hurt them, or quietly moved to
leverage. The interesting question is not whether this ladder wins. It is what
happens to the account while it is losing.

## Before the first session

1. Fund the Agentic sub-account. The agent cannot pull funds itself.
2. Install the Leash hook and MCP server (see the repository README).
3. Open `leash.policy.yaml` and set the numbers you actually accept losing.
   Everything below obeys those numbers; nothing here overrides them.

The workflow never states a limit of its own. Where it needs one it asks
`leash.budget_status`, so there is exactly one place limits live.

## The session loop

Run this whenever you want the agent to act — hourly, daily, on demand. Each
session is self-contained; nothing is remembered between sessions except the
account itself and Leash's state.

### Step 1 — Ask what room is left

Call `leash.budget_status`.

**Stop the session immediately, doing nothing, if any of these hold:**

| Reading | Why stop |
|---|---|
| Kill switch is ON | A person stopped trading. Do not look for a way around it. |
| Cooldown remaining > 0 | The last order was too recent. |
| Orders this hour ≥ limit − 1 | Leave one order of headroom for an exit. |
| Losing streak ≥ 2 | The ladder is not working today. Exits below still run. |

Report which line stopped you, and end. An agent that reports "nothing to do
today" is working correctly.

### Step 2 — Manage what is already open

For each symbol currently held (from `spot_getAccount`), fetch `spot_ticker24hr`
and compute the move from your average cost:

- **Up 2.5% or more → sell the whole position.** Take the bounce.
- **Down 4% or more → sell the whole position.** The premise is broken.
- **Anything in between → hold, and say so.**

Exits go through the same declaration in Step 4 as entries. An exit is a
decision too.

### Step 3 — Look for one entry

Only if nothing was sold this session, and no position is open.

Fetch `spot_ticker24hr` for every symbol on the allowlist reported by
`budget_status`. Keep the ones where the 24-hour change is:

    between −8.0% and −1.5% inclusive

Below −8% is not a dip, it is an event, and this workflow has no view on events.
Above −1.5% is noise.

**If more than one qualifies, take the one that has fallen furthest.** If none
qualifies, end the session and say so.

Order size: exactly the per-order cap from `budget_status`. Never larger, and
never smaller "to be safe" — a size chosen in the moment is a size chosen by
mood.

### Step 4 — Declare before you act

Call `leash.check_order` with the symbol, side, size, and a reason written in
your own words. The reason must state the observation that triggered the
decision, not restate the rule. Good: *"BTCUSDT down 3.1% over 24h, deepest on
the allowlist, no position open."* Useless: *"the strategy says to buy."*

Leash answers immediately with whether the order would pass.

- **Says it would pass** → place it in Step 5.
- **Says it would be refused** → do not place it. Go to Step 6.

### Step 5 — Place the order

Place it with `spot_newOrder` as a MARKET order, sized in USDT via
`quoteOrderQty`, within two minutes of the declaration.

Then report: what filled, at what price, and the reason you declared.

### Step 6 — When Leash refuses

The refusal names a rule and explains itself in a sentence. Read it and take
exactly one of these paths:

- **The rule is right and the order was wrong** → adjust the order so it fits,
  declare again, and continue. A smaller size, a different symbol, waiting out a
  cooldown are all legitimate.
- **The rule is right and there is nothing to adjust** → end the session and say
  which rule stopped you.

**Never** route the same order through a different tool, `tool_execute`, a
different market, or the shell to get around a refusal. If you believe a limit
is wrong, say so to the person and let them edit `leash.policy.yaml`. That file
is theirs; changing it is not your decision, and working around it is not either.

## What this workflow will not do

- It will not average down. One position at a time, one entry per session.
- It will not use leverage, margin, or futures. Spot only.
- It will not move funds between wallets.
- It will not trade a symbol that is not on the allowlist.
- It will not act while the kill switch is on.

The first four are also enforced by Leash, which is the point: the workflow says
what it intends, Leash makes it true even when the agent is confused, careless,
or being talked into something.

## Running it

Paste this into a session that has the Binance MCP server and the Leash MCP
server connected:

> Run one session of the Dip Ladder workflow in agent/WORKFLOW.md. Follow it
> exactly: check budget_status first, manage open positions, then look for at
> most one entry. Declare through leash.check_order before placing anything.
> If Leash refuses an order, report which rule stopped you and stop — do not
> work around it.
