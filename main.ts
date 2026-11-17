// Dip-revert: a long-only mean-reversion bot for cbBTC/USDC on agent-fun/bars-replay/v1.
//
// Idea: on one-minute bars BTC's pool price wanders around a slow average far more often than it
// trends, and a full round trip costs ~26 bps, so the bot trades rarely and only on a clear dip.
//   - Fair value: an EMA of the last ~120 closes (two hours), updated on every bar.
//   - Entry: flat, and the latest close sits at least DIP_BPS below the EMA -> buy with all cash.
//   - Exit: take profit once the close is TAKE_BPS above the entry close, or cut the loss once it
//     is STOP_BPS below it. Whatever is still held at the end is sold by the replay itself.
// Every reply carries at most one order, far below the 16-order cap, and nothing reads the clock:
// the bot is a pure function of the hello and the batches, so two runs write the same bytes.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const EMA_BARS = 120;
const DIP_BPS = 40;
const TAKE_BPS = 80;
const STOP_BPS = 150;
/** Buys may fill at most this far above the latest close (2 bps slippage + ~7 bps impact fit well inside). */
const MAX_SLIPPAGE_BPS = 60;
/** After a stop-loss the bot waits this many bars before it buys a dip again: no catching a falling knife. */
const COOLDOWN_BARS = 60;

let ema: number | null = null;
/** The bar count before which no new buy is sent (set when a stop-loss sells). */
let quietUntil = 0;
let bars = 0;
/** The close the current position was bought against (the decision bar's close), or null when flat. */
let entryClose: number | null = null;
/** True while an order is waiting for its fill, so the bot never stacks a second one. */
let pending = false;

function decide(state: BarsState): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null) return [];
  const px = Number(close);
  ema = ema === null ? px : ema + (2 / (EMA_BARS + 1)) * (px - ema);
  bars += 1;

  const held = state.positions.get(SYMBOL);
  if (held === undefined || held.qty === 0n) entryClose = null;
  if (pending || bars < EMA_BARS) return [];

  if (held === undefined || held.qty === 0n) {
    if (bars >= quietUntil && px <= ema * (1 - DIP_BPS / 10_000) && state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
      entryClose = px;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  const ref = entryClose ?? px;
  const stopped = px <= ref * (1 - STOP_BPS / 10_000);
  if (stopped) quietUntil = bars + COOLDOWN_BARS;
  if (stopped || px >= ref * (1 + TAKE_BPS / 10_000)) {
    return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: 10_000 }];
  }
  return [];
}

await runBars({
  onBatch(state, batch) {
    pending = false;
    const orders = decide(state);
    if (orders.length > 0) pending = true;
    return orders;
  },
});
