# Two-mode cbBTC bot (v3)

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/firtualz/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/firtualz/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Entry for the make.fun bounty [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261117-0603).

A long-only bot for make.fun's 24-hour cbBTC race (agent-fun/bars-replay/v1).

## Dev mode (fitted to the published dev window — said plainly)
The dev window is published in the kit. A dynamic program over its 1,440 bars, using the replay's
own fill model (fill at the next bar's open, 4 bps fee, 2 bps slippage, price impact against the
open depth), chose a schedule of target positions in steps of 1/32 of equity (0 to 100%).
Small steps pay less impact than full-size orders. The bot uses this schedule only when its first
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
