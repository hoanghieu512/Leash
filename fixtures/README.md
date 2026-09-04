# Fixtures

`recon.jsonl` holds real `PreToolUse` payloads captured from Claude Code while
driving the Binance MCP server on 2026-09-04 — market data reads, spot orders in
both directions, a rejected order, and one order routed through `tool_execute`.

The adapter tests read this file directly rather than hand-written samples, so a
change in Binance's payload shape shows up as a failing test instead of a
guardrail that silently stops matching.

Only the fields the adapter reads are kept — session ids, transcript paths and
local directories were stripped. They identify a machine and prove nothing.
