# Leash

**A policy layer for [Binance Agent OS](https://developers.binance.com/en/docs/agent-native/mcp-server). Your rules live in a YAML file, and the agent cannot talk its way past them.**

Binance lets you limit *what* an agent may touch — scopes, a dedicated sub-account, static caps. Nothing limits *how it behaves*: doubling down after a loss, walking straight back into the trade that just hurt it, hammering the API in a broken loop, or quietly moving to leverage.

Leash sits between the agent's intent and the exchange.

```console
$ # the agent is told to go all in
[Leash · max_notional_per_order] 180 USDT exceeds the 15 USDT per-order limit.

$ # so it tries the futures desk instead, through the tool_execute back door
[Leash · spot_only] This order targets the futures market (tool "futures_usds_newOrder"). Only spot is permitted.

$ # then a coin nobody approved
[Leash · symbol_allowlist] PEPEUSDT is not on the allowlist (BTCUSDT, ETHUSDT, BNBUSDT).

$ # and finally, an API key of its own
[Leash · never_mint_credentials] Tool "margin_createSpecialKey" creates or alters an API key.
A key minted this way no longer travels through the MCP server, so every Leash guard stops
applying to it — permanently, and even after the agent is switched off. This is a hard rule:
it is not in the config file and cannot be turned off.
```

Every one of those is a real refusal from the real binary. Nothing above is illustrative.

## Install

```bash
git clone https://github.com/hoanghieu512/Leash.git && cd Leash && npm run setup
```

Point Claude Code at the hook and the tools, from the repository root:

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

`.claude/settings.json` and `.mcp.json` ship with the repo, so the `PreToolUse` hook and the four Leash tools load when you start `claude` here. Then edit `leash.policy.yaml` and run.

```bash
npm run dash      # control panel at http://127.0.0.1:4577
npm run report    # what has been refused, and what it was worth
```

## The rules

Your limits, in a file written to be read:

```yaml
profile: conservative
capital_usdt: 100

limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT, BNBUSDT]
  markets: [spot]

behavior:
  daily_loss_kill_switch_pct: 5
  revenge_cooldown_minutes: 15
  no_size_up_after_losses: 2
  require_reason: true
```

| Rule | Stops | Binance scopes can express it? |
|---|---|---|
| `max_notional_per_order` | going all in on one impulse | ✗ |
| `symbol_allowlist` | wandering into a coin it just read about | ✗ |
| `spot_only` | quietly switching to leverage | partly |
| `rate_limit` | a broken loop burning the account in fees | ✗ |
| `daily_loss_kill_switch` | a bad day becoming a catastrophic one | ✗ |
| `revenge_cooldown` | re-entering the symbol that just took money | ✗ |
| `no_size_up_after_losses` | martingale | ✗ |
| `require_reason` | orders with no stated rationale | ✗ |

Static scopes cap *what*. These are about *conduct over time* — the shape of the last five orders, whether today is going badly, whether the agent is chasing a loss.

### Two rules with no off switch

Some things should not be somebody's configuration choice.

| Hard rule | Why it is not configurable |
|---|---|
| `never_mint_credentials` | Four tools on the Binance surface mint or reshape API keys. A key created that way never travels through the MCP server again, so every guard on that path stops applying — permanently, and after the agent is gone. |
| `no_leverage_funding` | Exactly one tool in the 316 moves assets between wallets. Blocking leveraged *orders* while leaving the funding route open is locking the door and opening the gate. The reverse direction stays open: that is the retreat. |

Neither function takes a `Policy` argument. A test asserts that, because a rule that could read config would eventually grow a flag to switch it off.

## How it enforces

```
Claude Code ──(tool call)──► [ LEASH HOOK ] ──► Binance MCP ──► exchange
                                   │
                        leash.policy.yaml + state (day P&L, order history, cooldowns)
                                   │
                        audit.jsonl  +  control panel
```

A `PreToolUse` hook intercepts every Binance MCP call before it leaves the machine, and a `PostToolUse` hook records what actually filled. Both halves are needed: the first can only see intent, and the four behavioural rules judge a history that only the second can write. Alongside it, a small MCP server gives the agent four tools — `check_order`, `budget_status`, `why_blocked`, `kill_switch` — so it can find out where the fence is instead of walking into it.

`check_order` is not a courtesy. Binance order payloads have no field for a reason, so `require_reason` is enforced by looking for a declaration made in the last two minutes. No declaration, no order — which turns the MCP server from advisory into a gate.

### The back door, and why the naive version leaks

`tools/list` advertises 79 tools. The server actually exposes **316**; the other 237 are reachable only through `tool_execute`, with the real name hidden in `arguments.toolName` — and **56 of the 76 write tools are among them**.

A guard reading `tool_name` sees `tool_execute` and waves it through. We confirmed the leak with a real filled order before closing it. The names also differ by route — `spot_newOrder` directly, `spot.newOrder` inside the wrapper — so both normalise to one form, matched exactly, never by substring.

Unrecognised tools are treated as orders and refused. Recognising every safe tool out of 316 is achievable; recognising every dangerous one is not.

## What Leash does not do

Worth stating plainly, because a guardrail that oversells itself is worse than none.

- **It enforces on the MCP path, not on a shell.** An agent that can run commands as your user can edit Leash's own state. `state.json` is HMAC-signed, so an edited file refuses every order and lands in the audit trail — that is tamper-*evidence*, not tamper-*proofing*. Closing the gap properly means separating privileges: a different uid, a container, or a service off the machine.
- **It does not pick trades.** Leash never decides what to buy. It decides which orders are allowed to leave.
- **Spot only, for now.** Margin and futures are refused rather than policed.
- **Claude Code enforces via a hook; every other MCP client via the proxy.** `npm run proxy` puts the same rules on the transport. Verified end to end against the live Binance endpoint: OAuth completes through the proxy, reads pass through, and an order sent *directly* — with the agent explicitly told not to pre-flight — is refused at the transport layer and never reaches the exchange. The refusal text is identical to the hook's, because both call the same `evaluate()`.
- **The proxy forwards your OAuth token and never holds one.** Binance's authorization server advertises no `registration_endpoint`, so a proxy could not obtain its own client identity even if it wanted one. Passthrough is not the tidier design here; it is the only one available.
- **It cannot move your money.** There is no withdrawal tool anywhere in the Binance MCP surface, so the threat Leash addresses is value destroyed in place, not funds leaving.

## The agent being policed

[`agent/WORKFLOW.md`](agent/WORKFLOW.md) is a complete trading workflow — the Dip Ladder — written so anyone can run the same thing. It is deliberately ordinary and claims no edge, because the point of this project is not the strategy:

> Most trading agents do not fail because their idea was wrong. They fail because nothing stopped them when it was.

## Under the hood

Node 20+, TypeScript, no framework. The decision core — `policy/`, `rules/`, `state/` — is pure functions with no I/O, wrapped in four thin adapters: the hook, the MCP server, the audit log, the dashboard. No adapter holds a rule.

```
217 tests passing
```

Everything fails closed. Unreadable config, corrupt state, a rule that throws, a blown time budget, a payload with no tool name — each one refuses the order. A guardrail that fails open is decoration.

---

Built for the Binance Agent OS Mini Hackathon, September 2026. Track A.
