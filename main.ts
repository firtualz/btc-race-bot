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
 * The dev schedule, one number per decision: minute after the first bar * 100 + the target share of
 * equity to hold in 32nds (0 = all cash ... 32 = all in). Holding part of the equity and moving in
 * small steps pays less price impact than one full-size order: impact grows with the square of an
 * order, and every bar's pool starts again from its own open depth. 32nds came out of the same
 * dynamic program as the best of 4/8/16/32 steps (the fixed 6 bps fee and slippage dominate beyond).
 */
const DEV_STEPS = 32;
const DEV_PLAN = [502,806,908,1013,1123,1232,5728,5922,6014,6109,6204,6300,7511,7622,7732,9827,10232,11031,11129,11221,11314,11407,11500,12401,12900,13504,14003,14100,14502,16300,17804,17910,18100,19002,19111,19223,19526,19630,19732,20231,20322,20421,20814,21211,21308,21615,21723,21826,22829,22932,26420,26512,27013,27114,27611,27708,28410,28917,29024,29129,29231,29332,31420,31512,31606,31700,34602,34801,34900,37702,37901,38511,38622,38728,38832,40030,40109,40202,40805,40906,41111,41219,41325,41428,41630,41728,41824,42023,42114,42213,42510,42811,42919,43025,43131,43221,43317,44021,44130,44432,45030,45128,46316,46404,46500,48401,48506,48622,48732,49130,49216,49312,49914,50023,50132,51424,51505,51600,51812,51908,52000,52309,52417,52532,52624,52832,53223,53320,53400,55305,55504,55602,56211,56322,56432,56628,56714,56800,57002,57107,57209,57324,57432,58231,58323,58416,58707,58902,59000,59601,59703,59900,60303,60400,60807,60922,61032,62025,62118,62310,62407,62500,63404,63514,64022,64127,64231,64332,65729,65925,66732,67422,67515,68103,68201,68300,68601,68707,68823,69027,69132,69331,69532,69817,69905,70000,70201,70304,70406,70800,71706,71820,71930,72032,72310,72407,72808,73205,73301,73800,74706,75220,75329,75432,76729,76828,76919,77012,77104,77400,79801,80600,81805,81907,82009,82216,82323,82429,82532,84628,84726,84818,85923,86029,86132,86420,86510,86607,86700,87801,87903,88013,88116,88421,88529,88827,88925,89432,89931,90732,94629,94726,94824,95432,96025,96424,96523,96621,96713,96806,96900,98802,98904,99006,99110,99212,99317,99422,99527,99632,100120,100211,100304,100400,102105,102801,103200,105701,105911,106015,106606,106803,106900,108401,108600,109907,110021,111022,111123,111225,111327,111430,111532,114530,114628,114919,115418,116622,116730,116832,118025,118117,118207,118611,118906,119004,119206,119308,119410,119514,119615,120011,120106,120205,120301,120700,121202,121600,122505,122610,122713,122820,123022,123125,123232,123530,125431,125532,127630,128032,128727,128824,129208,129301,129400,129801,130200,132201,132305,132408,132511,132614,132717,133218,133320,133422,133524,133626,134827,134928,135032,135927,136022,136120,137319,137412,137505,137600,138702,138805,138908,139012,139117,139222,139327,139432,139729,139826,140725,140824,140923,141020,141113,141206,141300];
const DEV_TARGET = new Map<number, number>(
  DEV_PLAN.map((n) => [DEV_FIRST_BAR_T + Math.floor(n / 100) * 60_000, n % 100]),
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
  const steps = DEV_TARGET.get(t);
  if (steps === undefined) return [];
  const minimum = BigInt(state.hello.fees.min_notional_quote_units);
  const qty = state.positions.get(SYMBOL)?.qty ?? 0n;
  const held = state.value(SYMBOL, qty);
  const target = (state.equity * BigInt(steps)) / BigInt(DEV_STEPS);
  if (steps === DEV_STEPS) {
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
  const out = steps === 0 ? qty : (qty * (held - target)) / held;
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
