// Dip-bounce v2: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// v1 bought the moment price sat 0.4% under a 2-hour EMA, and on the dev window those dips kept
// falling (one-minute returns carry ~0.15 autocorrelation: a drop tends to run on for a few bars).
// v2 waits for the turn instead:
//   - Fair value: an EMA of the last FAIR_BARS closes.
//   - Arm: once a close sits DIP_BPS or more under the EMA the bot is armed (disarmed again when
//     price gets back to the EMA without a signal).
//   - Entry: armed, still under the EMA, and the latest bar closed BOUNCE_BPS or more above the
//     close before it -> buy with all cash at the next bar's open.
//   - Exit: once a close is TAKE_BPS above the decision close the exit is armed, and the bot sells
//     on the first close that gives back TRAIL_BPS from the highest close since the buy (short-term
//     moves run on, so the winner is ridden a little). A wide emergency stop sits STOP_BPS below
//     the entry. What is still held at the end is sold by the replay itself.
// One order per reply at most, no clock and no randomness: the bot is a pure function of the
// hello and the batches, so two executions write the same bytes.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAIR_BARS = 20;
const DIP_BPS = 5;
const BOUNCE_BPS = 8;
/** Reaching this gain arms the exit; the bot then rides the run until a close gives back TRAIL_BPS. */
const TAKE_BPS = 70;
const TRAIL_BPS = 5;
const STOP_BPS = 300;
const MAX_SLIPPAGE_BPS = 60;

let ema: number | null = null;
let prevClose: number | null = null;
let bars = 0;
let armed = false;
let entryClose: number | null = null;
/** Highest close since the buy, and whether the take-profit level has been reached. */
let peak = 0;
let reached = false;
let pending = false;

function decide(state: BarsState): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null) return [];
  const px = Number(close);
  const last = prevClose;
  prevClose = px;
  ema = ema === null ? px : ema + (2 / (FAIR_BARS + 1)) * (px - ema);
  bars += 1;

  const held = state.positions.get(SYMBOL);
  const flat = held === undefined || held.qty === 0n;
  if (flat) entryClose = null;
  if (pending || bars < FAIR_BARS || last === null) return [];

  if (flat) {
    if (px <= ema * (1 - DIP_BPS / 10_000)) armed = true;
    if (px >= ema) armed = false;
    const bounced = px >= last * (1 + BOUNCE_BPS / 10_000);
    if (armed && bounced && px < ema && state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
      armed = false;
      entryClose = px;
      peak = px;
      reached = false;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  const ref = entryClose ?? px;
  if (px > peak) peak = px;
  if (px >= ref * (1 + TAKE_BPS / 10_000)) reached = true;
  const trailed = reached && px <= peak * (1 - TRAIL_BPS / 10_000);
  if (trailed || px <= ref * (1 - STOP_BPS / 10_000)) {
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
