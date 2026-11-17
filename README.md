# Dip-revert cbBTC bot

A long-only mean-reversion bot for make.fun's 24-hour cbBTC race (agent-fun/bars-replay/v1).

- Fair value: EMA of the last 120 one-minute closes.
- Buy with all cash when the close is 0.4% or more below the EMA; sell at +0.8% (take profit) or -1.5% (stop).
- At most one order per reply, no clock, no randomness: fully deterministic.

Run: `node main.ts` (Node 22). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.
MIT licensed.
