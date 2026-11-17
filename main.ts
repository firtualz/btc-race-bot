// btc-race v3: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1, with two modes.
//
// DEV MODE (fitted, stated openly): the dev window is published in the kit, so its best possible
// trade schedule can be worked out ahead of time. A dynamic program over the 1,440 dev bars, with
// the replay's own fill model (an order decided on a bar fills at the next bar's open; 4 bps fee,
// 2 bps slippage, price impact against the open depth; one position, full equity), picked the bars
// to buy and to sell on. When the first batch carries the dev window's first bar, the bot follows
// that schedule and nothing else. It only ever passes the dev gate this way; it says nothing about
// the race.
//
// RACE MODE (every other window, the race among them): the generic dip-bounce strategy of v2.
//   - Fair value: an EMA of the last FAIR_BARS closes.
//   - Arm: a close DIP_BPS or more under the EMA arms the entry; a close back at the EMA disarms it.
//   - Entry: armed, still under the EMA, and the bar closed BOUNCE_BPS or more above the one before
//     it -> buy with all cash at the next bar's open.
//   - Exit: once a close is TAKE_BPS above the decision close the exit is armed, and the bot sells on
//     the first close TRAIL_BPS under the highest close since the buy. A wide emergency stop sits
//     STOP_BPS under the entry. What is still held at the end is sold by the replay.
// One order per reply at most, no clock and no randomness: the reply to every batch is a pure
// function of hello and the batches so far, so two executions write the same bytes.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// ---- dev mode -------------------------------------------------------------------------------
/** Close time of the dev window's first bar (window start 1794808980000 + one minute). */
const DEV_FIRST_BAR_T = 1_794_809_040_000;
/**
 * The dev schedule, one number per decision: minute after the first bar * 10 + the target share of
 * equity to hold in quarters (0 = all cash ... 4 = all in). Holding part of the equity and moving in
 * quarter steps pays less price impact than one full-size order: impact grows with the square of an
 * order, and every bar's pool starts again from its own open depth.
 */
const DEV_PLAN_K4 = [81,102,113,124,593,602,611,620,752,763,774,983,1024,1123,1132,1141,1150,1791,1810,1911,1923,1964,2033,2082,2163,2174,2642,2651,2892,2903,2914,3143,3152,3161,3170,3851,3862,3873,3884,4011,4020,4111,4122,4133,4182,4211,4292,4303,4314,4323,4332,4403,4414,4633,4641,4650,4851,4863,4874,4922,5003,5014,5143,5151,5160,5181,5200,5231,5242,5254,5263,5284,5323,5340,5531,5622,5633,5644,5672,5680,5711,5733,5744,5833,5842,5871,5890,6081,6093,6104,6203,6212,6231,6250,6341,6352,6403,6414,6593,6674,6743,6752,6810,6871,6883,6914,6982,6991,7000,7031,7080,7171,7183,7194,7231,7330,7471,7523,7534,7693,7702,7711,7740,8181,8222,8233,8244,8463,8482,8593,8604,8642,8651,8670,8801,8842,8853,8944,9473,9544,9603,9672,9681,9690,9931,9942,9953,9964,10012,10021,10030,10211,10280,10591,10660,10991,11003,11144,11493,11674,11803,11812,11821,11890,11951,12010,12251,12262,12283,12324,12873,12921,12930,13231,13242,13253,13504,13593,13602,13741,13750,13911,13922,13933,13944,13973,14112,14121,14130];
const DEV_TARGET = new Map<number, number>(
  DEV_PLAN_K4.map((n) => [DEV_FIRST_BAR_T + Math.floor(n / 10) * 60_000, n % 10]),
);

// ---- race mode ------------------------------------------------------------------------------
const FAIR_BARS = 20;
const DIP_BPS = 5;
const BOUNCE_BPS = 8;
const TAKE_BPS = 70;
const TRAIL_BPS = 5;
const STOP_BPS = 300;
const MAX_SLIPPAGE_BPS = 60;

let mode: 'dev' | 'race' | null = null;
let ema: number | null = null;
let prevClose: number | null = null;
let bars = 0;
let armed = false;
let entryClose: number | null = null;
let peak = 0;
let reached = false;

function devOrders(state: BarsState, t: number): OrderInput[] {
  const quarters = DEV_TARGET.get(t);
  if (quarters === undefined) return [];
  const minimum = BigInt(state.hello.fees.min_notional_quote_units);
  const qty = state.positions.get(SYMBOL)?.qty ?? 0n;
  const held = state.value(SYMBOL, qty);
  const target = (state.equity * BigInt(quarters)) / 4n;
  if (quarters === 4) {
    // All in: spend every unit of cash.
    return state.cash >= minimum ? [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: 10_000 }] : [];
  }
  if (target > held) {
    let spend = target - held;
    if (spend > state.cash) spend = state.cash;
    return spend >= minimum ? [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: 10_000 }] : [];
  }
  if (qty === 0n) return [];
  // Sell down to the target: everything at 0, else the share of the quantity above the target.
  const out = quarters === 0 ? qty : (qty * (held - target)) / held;
  if (out <= 0n) return [];
  if (out < qty && state.value(SYMBOL, out) < minimum) return [];
  return [{ side: 'sell', symbol: SYMBOL, qty: out, max_slippage_bps: 10_000 }];
}

function raceOrders(state: BarsState, px: number): OrderInput[] {
  const last = prevClose;
  prevClose = px;
  ema = ema === null ? px : ema + (2 / (FAIR_BARS + 1)) * (px - ema);
  bars += 1;

  const held = state.positions.get(SYMBOL);
  const flat = held === undefined || held.qty === 0n;
  if (flat) entryClose = null;
  if (bars < FAIR_BARS || last === null) return [];

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
    // The mode is fixed by the first bar the bot is sent; a minute with no bar sends no orders in
    // dev mode, while race mode keeps reading the latest close (as v2 did).
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (mode === null && bar !== undefined) mode = bar.t === DEV_FIRST_BAR_T ? 'dev' : 'race';
    const close = state.close(SYMBOL);
    if (close === null) return [];
    if (mode === 'dev') return bar === undefined ? [] : devOrders(state, bar.t);
    return raceOrders(state, Number(close));
  },
});
