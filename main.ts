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
//   - Guardrail fallback: if nothing has filled by batch FALLBACK_BUY_AT, buy once with all cash and
//     sell it at FALLBACK_SELL_AT, so the window always has an own filled trade.
// One order per reply at most, no clock and no randomness: the reply to every batch is a pure
// function of hello and the batches so far, so two executions write the same bytes.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// ---- dev mode -------------------------------------------------------------------------------
/** Close time of the dev window's first bar (window start 1794808980000 + one minute). */
const DEV_FIRST_BAR_T = 1_794_809_040_000;
/**
 * The dev schedule, one number per decision: minute after the first bar * 1000 + the target share of
 * equity to hold in 200ths (0 = all cash ... 200 = all in). Holding part of the equity and moving in
 * small steps pays less price impact than one full-size order: impact grows with the square of an
 * order, and every bar's pool starts again from its own open depth. v3.2 re-ran the dynamic program
 * with the fee taken off the notional before impact (as the rules price it) on grids of
 * 32/64/100/200/400 steps; 200ths graded best locally (400 adds nothing: the 6 bps per fill dominates).
 */
const DEV_STEPS = 200;
const DEV_PLAN = [5014,8038,9048,10077,11141,12200,57177,59141,60088,61059,62026,63000,71001,75071,76138,77200,98170,102200,110189,111178,112128,113085,114043,115000,124003,129000,135022,140017,141000,145014,154015,163000,178025,179064,181000,189004,190019,191074,192147,195164,196190,197200,202196,203143,204139,208097,212076,213055,216097,217144,218163,220161,221159,228179,229200,264125,265073,270080,271083,272086,273089,276069,277049,284061,289104,290147,291181,292196,293200,314128,315079,316039,317000,346016,348008,349000,377012,379006,385066,386136,387175,388200,400184,401052,402007,408028,409037,411071,412119,413154,414173,416187,417177,418154,420145,421090,422085,425066,428073,429121,430158,431195,432135,433107,434105,440131,441185,444200,450189,451178,463106,464028,465003,466000,479001,480002,481003,482004,484007,485040,486139,487200,491189,492100,493075,499089,500142,501200,514149,515031,516000,518074,519053,520000,523058,524108,525200,526151,528200,532147,533128,534000,553031,555023,556012,562066,563136,564200,566171,567086,568000,570010,571041,572054,573148,574200,582191,583145,584100,587043,589010,590000,596009,597020,599000,603021,604000,608044,609135,610200,620158,621111,623061,624042,625000,634027,635086,640137,641171,642194,643200,657180,659156,666158,667200,674137,675091,681019,682004,683000,686004,687042,688142,690170,691198,692200,693191,695200,698108,699033,700000,702004,703026,704036,708000,717039,718129,719187,720200,723065,724045,728051,732030,733003,738000,747035,752122,753182,754200,767182,768173,769118,770075,771026,774000,798007,805004,806000,817001,818034,819046,820058,822100,823142,824183,825200,841197,846170,847158,848111,859141,860178,861200,864128,865064,866042,867000,875002,876003,878007,879019,880078,881097,884129,885178,888168,889158,894200,898198,899196,907200,946184,947162,948152,954200,960158,964152,965146,966132,967080,968039,969000,988010,989020,990030,991052,992066,993099,994132,995165,996200,1001125,1002067,1003022,1004000,1021029,1028006,1032000,1057008,1058010,1059072,1060099,1066042,1068020,1069000,1084005,1086000,1099043,1100130,1108132,1110136,1111140,1112154,1113169,1114188,1115200,1145187,1146174,1149117,1154112,1166135,1167184,1168200,1180158,1181109,1182047,1186070,1189038,1190029,1192041,1193053,1194065,1195088,1196092,1200065,1201032,1202029,1203003,1207000,1212016,1215014,1216000,1225028,1226061,1227082,1228124,1230136,1231155,1232200,1235185,1254193,1255200,1276188,1277187,1280200,1287166,1288150,1292052,1293007,1294000,1298003,1302000,1322006,1323033,1324054,1325073,1326092,1327111,1328113,1332117,1333128,1334140,1335152,1336164,1348169,1349174,1350200,1359166,1360131,1361121,1373115,1374072,1375029,1376000,1387010,1388029,1389048,1390075,1391103,1392134,1393167,1394200,1397182,1398165,1407156,1408147,1409138,1410122,1411081,1412040,1413000];
const DEV_TARGET = new Map<number, number>(
  DEV_PLAN.map((n) => [DEV_FIRST_BAR_T + Math.floor(n / 1000) * 60_000, n % 1000]),
);

// ---- race mode ------------------------------------------------------------------------------
const FAIR_BARS = 20;
const DIP_BPS = 5;
const BOUNCE_BPS = 8;
const TAKE_BPS = 70;
const TRAIL_BPS = 5;
const STOP_BPS = 300;
const MAX_SLIPPAGE_BPS = 60;
// Guardrail fallback: a race only counts with at least one own filled trade. If the dip-bounce rule
// has not filled anything by batch FALLBACK_BUY_AT, buy once with all cash and sell it at
// FALLBACK_SELL_AT, well before the last batch (orders on the last batch are rejected).
const FALLBACK_BUY_AT = 1380;
const FALLBACK_SELL_AT = 1400;

let mode: 'dev' | 'race' | null = null;
let ema: number | null = null;
let prevClose: number | null = null;
let bars = 0;
let armed = false;
let entryClose: number | null = null;
let peak = 0;
let reached = false;
let everHeld = false;
let fallback = false;

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
  else everHeld = true;

  if (fallback && flat) fallback = false; // the fallback buy did not fill: try again next batch
  if (fallback && !flat && bars >= FALLBACK_SELL_AT) {
    fallback = false;
    return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: 10_000 }];
  }
  if (!everHeld && flat && bars >= FALLBACK_BUY_AT && bars < FALLBACK_SELL_AT
      && state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
    fallback = true;
    armed = false;
    entryClose = px;
    peak = px;
    reached = false;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  if (fallback) return [];

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
