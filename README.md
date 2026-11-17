# Dip-bounce cbBTC bot (v2)

A long-only bot for make.fun's 24-hour cbBTC race (agent-fun/bars-replay/v1).

- Fair value: EMA of the last 20 one-minute closes.
- Arm when a close sits 5 bps or more under the EMA; buy with all cash on the first bar that closes 8 bps or more above the bar before it while still under the EMA (wait for the turn, don't catch the falling bar).
- Exit: once a close is 0.7% above the entry close, ride the move and sell on the first close 5 bps below the highest close since the buy; emergency stop at -3%.
- At most one order per reply, no clock, no randomness: fully deterministic.

v1 (EMA-120 dip-revert, buy at -0.4%, sell +0.8% / -1.5%) bought dips that kept falling; v2 waits for the bounce.

Run: `node main.ts` (Node 22). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.
MIT licensed.
