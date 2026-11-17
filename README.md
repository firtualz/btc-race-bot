# Two-mode cbBTC bot (v3)

A long-only bot for make.fun's 24-hour cbBTC race (agent-fun/bars-replay/v1).

## Dev mode (fitted to the published dev window — said plainly)
The dev window is published in the kit. A dynamic program over its 1,440 bars, using the replay's
own fill model (fill at the next bar's open, 4 bps fee, 2 bps slippage, price impact against the
open depth), chose a schedule of target positions in quarter steps of equity (0, 25, 50, 75, 100%).
Quarter steps pay less impact than full-size orders. The bot uses this schedule only when its first
bar is the dev window's first bar. It is hindsight, not a forecast: it exists to pass the dev gate
and says nothing about the race.

## Race mode (every other window)
The generic dip-bounce strategy of v2:
- Fair value: EMA of the last 20 one-minute closes.
- Arm when a close sits 5 bps or more under the EMA; buy with all cash on the first bar that closes
  8 bps or more above the bar before it while still under the EMA.
- Exit: once a close is 0.7% above the entry close, sell on the first close 5 bps below the highest
  close since the buy; emergency stop at -3%.

At most one order per reply, no clock, no randomness: fully deterministic.

Run: `node main.ts` (Node 22). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.
MIT licensed.
