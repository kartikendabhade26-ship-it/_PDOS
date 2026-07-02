/**
 * algo/primitives.js
 * Implements high-precision detectors for the PDOS core primitives.
 */

const { makeEvent } = require('./eventSchema');
const config = require('./config');
const { calculateAvgRangeForIndex } = require('./utils/math/atr');
const EST_OFFSET = -5 * 3600;

function getESTDateTime(unixTs) {
  const d = new Date((unixTs + EST_OFFSET) * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { hour, minute, dateStr, year, month, day };
}

/**
 * 1. STRUCTURE: Displacement Candidates
 * Candle body is the middle bar of an imbalance (Fair Value Gap)
 */
function detectDisplacementCandidates(bars) {
  const candidates = [];

  for (let i = 1; i < bars.length - 1; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    const next = bars[i + 1];

    let isDisplacement = false;
    let direction = 'bullish';

    if (bar.close > bar.open && next.low > prev.high) {
      isDisplacement = true;
      direction = 'bullish';
    } else if (bar.close < bar.open && next.high < prev.low) {
      isDisplacement = true;
      direction = 'bearish';
    }

    if (isDisplacement) {
      const body = Math.abs(bar.close - bar.open);
      candidates.push({
        type: 'displacement',
        direction: direction,
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: Math.max(bar.open, bar.close),
        priceLow: Math.min(bar.open, bar.close),
        gapSize: body,
        barIndex: i,
        properties: { body }
      });
    }
  }
  return candidates;
}

/**
 * Helper: detect swing high and swing low points (3-bar fractal)
 * Kept for backward compatibility with SwingHierarchyEngine and legacy callers.
 */
function findSwings(bars, timeframe = 1) {
  const swingHighs = [];
  const swingLows = [];

  const isHighCand = new Array(bars.length).fill(false);
  const isLowCand = new Array(bars.length).fill(false);

  for (let i = 1; i < bars.length - 1; i++) {
    const curr = bars[i];
    const prev = bars[i - 1];
    const next = bars[i + 1];

    if (curr.high >= prev.high && curr.high >= next.high && (curr.high > prev.high || curr.high > next.high)) {
      isHighCand[i] = true;
    }
    if (curr.low <= prev.low && curr.low <= next.low && (curr.low < prev.low || curr.low < next.low)) {
      isLowCand[i] = true;
    }
  }

  const finalHighs = new Array(bars.length).fill(false);
  const finalLows = new Array(bars.length).fill(false);
  const confirmHighs = new Array(bars.length).fill(0);
  const confirmLows = new Array(bars.length).fill(0);

  // Process Highs
  let i = 1;
  while (i < bars.length - 1) {
    if (isHighCand[i]) {
      let L = i;
      let R = i;
      while (R + 1 < bars.length - 1 && isHighCand[R + 1] && bars[R + 1].high === bars[L].high) {
        R++;
      }
      let bestIdx = L;
      let maxScore = -1;
      for (let idx = L; idx <= R; idx++) {
        let score = isLowCand[idx] ? 0 : 1;
        if (score >= maxScore) {
          maxScore = score;
          bestIdx = idx;
        }
      }
      finalHighs[bestIdx] = true;
      confirmHighs[bestIdx] = R + 1;
      i = R + 1;
    } else {
      i++;
    }
  }

  // Process Lows
  i = 1;
  while (i < bars.length - 1) {
    if (isLowCand[i]) {
      let L = i;
      let R = i;
      while (R + 1 < bars.length - 1 && isLowCand[R + 1] && bars[R + 1].low === bars[L].low) {
        R++;
      }
      let bestIdx = L;
      let maxScore = -1;
      for (let idx = L; idx <= R; idx++) {
        let score = isHighCand[idx] ? 0 : 1;
        if (score >= maxScore) {
          maxScore = score;
          bestIdx = idx;
        }
      }
      finalLows[bestIdx] = true;
      confirmLows[bestIdx] = R + 1;
      i = R + 1;
    } else {
      i++;
    }
  }

  for (let idx = 1; idx < bars.length - 1; idx++) {
    if (finalHighs[idx]) {
      const curr = bars[idx];
      const entry = {
        id: `swing_high_${curr.time}`,
        type: 'swing_high',
        concept: 'swing',
        direction: 'bearish',
        time: curr.time,
        timestamp: curr.time,
        price: curr.high,
        priceHigh: curr.high,
        priceLow: curr.low,
        barIndex: idx,
        confirmationBar: confirmHighs[idx],
        confirmationBarIndex: confirmHighs[idx],
        timeframe
      };
      entry.strength = calculateSwingStrength(entry, bars);
      swingHighs.push(entry);
    }
    if (finalLows[idx]) {
      const curr = bars[idx];
      const entry = {
        id: `swing_low_${curr.time}`,
        type: 'swing_low',
        concept: 'swing',
        direction: 'bullish',
        time: curr.time,
        timestamp: curr.time,
        price: curr.low,
        priceHigh: curr.high,
        priceLow: curr.low,
        barIndex: idx,
        confirmationBar: confirmLows[idx],
        confirmationBarIndex: confirmLows[idx],
        timeframe
      };
      entry.strength = calculateSwingStrength(entry, bars);
      swingLows.push(entry);
    }
  }

  const allSwings = [...swingHighs, ...swingLows].sort((a, b) => a.barIndex - b.barIndex);
  return { swingHighs, swingLows, allSwings };
}

/**
 * Calculates how many bars to the left and right are lower (for high) or higher (for low).
 */
function calculateSwingStrength(swing, bars) {
  const i = swing.barIndex;
  const isHigh = swing.type === 'swing_high';
  const price = swing.price;
  
  let strength = 1;
  while (true) {
    const nextS = strength + 1;
    const leftIdx = i - nextS;
    const rightIdx = i + nextS;
    if (leftIdx < 0 && rightIdx >= bars.length) break;

    let ok = true;
    if (isHigh) {
      if (leftIdx >= 0 && bars[leftIdx].high >= price) ok = false;
      if (rightIdx < bars.length && bars[rightIdx].high >= price) ok = false;
    } else {
      if (leftIdx >= 0 && bars[leftIdx].low <= price) ok = false;
      if (rightIdx < bars.length && bars[rightIdx].low <= price) ok = false;
    }

    if (ok) {
      strength = nextS;
    } else {
      break;
    }
  }
  return strength;
}

/**
 * Windowed swing high/low finder — mirrors joshyattridge/smart-money-concepts reference.
 *
 * Uses the SAME asymmetric inequality as the 3-bar fractal in findSwings():
 *   - Swing High: no bar to the LEFT has high >= curr.high  (strict left)
 *                 no bar to the RIGHT has high >  curr.high  (allow equal right → picks first flat-top bar)
 *   - Swing Low:  no bar to the LEFT has low  <= curr.low   (strict left)
 *                 no bar to the RIGHT has low  <  curr.low   (allow equal right → picks first flat-bottom bar)
 *
 * This matches Pine Script ta.pivothigh/ta.pivotlow semantics and prevents NQ's
 * 0.25-tick flat tops/bottoms from being silently skipped.
 *
 * A single candle CAN qualify as BOTH a swing high and swing low (e.g. a pin bar or
 * inside bar that is both the local high and local low relative to the window).
 *
 * @param {object[]} bars         - OHLC bars array
 * @param {number}   leftLen      - Number of bars to look left (default 5)
 * @param {number}   rightLen     - Number of bars to look right (default 5)
 * @param {number}   timeframe    - Timeframe tag for emitted events
 * @returns {{ swingHighs, swingLows, allSwings }}
 */
function findSwingsWindowed(bars, leftLen = 5, rightLen = 5, timeframe = 1) {
  const swingHighs = [];
  const swingLows  = [];

  const isHighCand = new Array(bars.length).fill(false);
  const isLowCand = new Array(bars.length).fill(false);

  for (let i = leftLen; i < bars.length - rightLen; i++) {
    const curr = bars[i];
    
    let allLowerOrEqualHigh = true;
    let hasStrictlyLowerHigh = false;
    for (let j = i - leftLen; j <= i + rightLen; j++) {
      if (j < 0 || j >= bars.length) continue;
      if (bars[j].high > curr.high) {
        allLowerOrEqualHigh = false;
        break;
      }
      if (bars[j].high < curr.high) {
        hasStrictlyLowerHigh = true;
      }
    }
    if (allLowerOrEqualHigh && hasStrictlyLowerHigh) {
      isHighCand[i] = true;
    }

    let allHigherOrEqualLow = true;
    let hasStrictlyHigherLow = false;
    for (let j = i - leftLen; j <= i + rightLen; j++) {
      if (j < 0 || j >= bars.length) continue;
      if (bars[j].low < curr.low) {
        allHigherOrEqualLow = false;
        break;
      }
      if (bars[j].low > curr.low) {
        hasStrictlyHigherLow = true;
      }
    }
    if (allHigherOrEqualLow && hasStrictlyHigherLow) {
      isLowCand[i] = true;
    }
  }

  const finalHighs = new Array(bars.length).fill(false);
  const finalLows = new Array(bars.length).fill(false);
  const confirmHighs = new Array(bars.length).fill(0);
  const confirmLows = new Array(bars.length).fill(0);

  // Process Highs
  let i = leftLen;
  while (i < bars.length - rightLen) {
    if (isHighCand[i]) {
      let L = i;
      let R = i;
      while (R + 1 < bars.length - rightLen && isHighCand[R + 1] && bars[R + 1].high === bars[L].high) {
        R++;
      }
      let bestIdx = L;
      let maxScore = -1;
      for (let idx = L; idx <= R; idx++) {
        let score = isLowCand[idx] ? 0 : 1;
        if (score >= maxScore) {
          maxScore = score;
          bestIdx = idx;
        }
      }
      finalHighs[bestIdx] = true;
      confirmHighs[bestIdx] = R + rightLen;
      i = R + 1;
    } else {
      i++;
    }
  }

  // Process Lows
  i = leftLen;
  while (i < bars.length - rightLen) {
    if (isLowCand[i]) {
      let L = i;
      let R = i;
      while (R + 1 < bars.length - rightLen && isLowCand[R + 1] && bars[R + 1].low === bars[L].low) {
        R++;
      }
      let bestIdx = L;
      let maxScore = -1;
      for (let idx = L; idx <= R; idx++) {
        let score = isHighCand[idx] ? 0 : 1;
        if (score >= maxScore) {
          maxScore = score;
          bestIdx = idx;
        }
      }
      finalLows[bestIdx] = true;
      confirmLows[bestIdx] = R + rightLen;
      i = R + 1;
    } else {
      i++;
    }
  }

  for (let idx = leftLen; idx < bars.length - rightLen; idx++) {
    if (finalHighs[idx]) {
      const curr = bars[idx];
      const entry = {
        id: `swing_high_w_${curr.time}`,
        type: 'swing_high',
        concept: 'swing',
        direction: 'bearish',
        time: curr.time,
        timestamp: curr.time,
        price: curr.high,
        priceHigh: curr.high,
        priceLow: curr.low,
        barIndex: idx,
        confirmationBar: confirmHighs[idx],
        confirmationBarIndex: confirmHighs[idx],
        timeframe
      };
      entry.strength = calculateSwingStrength(entry, bars);
      swingHighs.push(entry);
    }
    if (finalLows[idx]) {
      const curr = bars[idx];
      const entry = {
        id: `swing_low_w_${curr.time}`,
        type: 'swing_low',
        concept: 'swing',
        direction: 'bullish',
        time: curr.time,
        timestamp: curr.time,
        price: curr.low,
        priceHigh: curr.high,
        priceLow: curr.low,
        barIndex: idx,
        confirmationBar: confirmLows[idx],
        confirmationBarIndex: confirmLows[idx],
        timeframe
      };
      entry.strength = calculateSwingStrength(entry, bars);
      swingLows.push(entry);
    }
  }

  const allSwings = [...swingHighs, ...swingLows].sort((a, b) => a.barIndex - b.barIndex);
  return { swingHighs, swingLows, allSwings };
}


/**
 * Standard Swing High/Low candidate generator
 */
function detectSwingCandidates(bars, preComputedSwings = null) {
  const { allSwings } = preComputedSwings || findSwings(bars);
  return allSwings;
}



/**
 * 2. STRUCTURE: Protected Highs and Protected Lows
 * Swing points that led directly to a BOS or MSS in the opposite direction
 */
function detectProtectedHighLowCandidates(bars, preComputedSwings = null) {
  const { swingHighs, swingLows } = preComputedSwings || findSwings(bars);
  const candidates = [];
  
  // Detect Protected Lows (Swing Lows followed by a bullish break)
  for (const sl of swingLows) {
    let highestHigh = -Infinity;
    let brokeHigh = false;
    let invalid = false;
    let breakTime = null;
    let breakIndex = null;

    for (let j = sl.barIndex + 1; j < bars.length; j++) {
      if (bars[j].close < sl.priceLow) {
        invalid = true;
        break; // Low was broken before any BOS/MSS
      }
      if (bars[j].high > highestHigh) {
        highestHigh = bars[j].high;
      }
      // Bullish structure break: close above the highest high of the range
      if (highestHigh > sl.priceLow && bars[j].close > highestHigh) {
        brokeHigh = true;
        breakTime = bars[j].time;
        breakIndex = j;
        break;
      }
    }

    if (brokeHigh && !invalid) {
      candidates.push({
        type: 'protected_high_low',
        direction: 'bullish', // Protected Low
        time: breakTime,
        timeStart: sl.time,
        timeEnd: breakTime,
        priceHigh: sl.priceLow + 2.0,
        priceLow: sl.priceLow - 2.0,
        gapSize: 4.0,
        barIndex: breakIndex,
        properties: { swingTime: sl.time, swingPrice: sl.priceLow }
      });
    }
  }

  // Detect Protected Highs (Swing Highs followed by a bearish break)
  for (const sh of swingHighs) {
    let lowestLow = Infinity;
    let brokeLow = false;
    let invalid = false;
    let breakTime = null;
    let breakIndex = null;

    for (let j = sh.barIndex + 1; j < bars.length; j++) {
      if (bars[j].close > sh.priceHigh) {
        invalid = true;
        break; // High was broken before any BOS/MSS
      }
      if (bars[j].low < lowestLow) {
        lowestLow = bars[j].low;
      }
      // Bearish structure break: close below the lowest low of the range
      if (lowestLow < sh.priceHigh && bars[j].close < lowestLow) {
        brokeLow = true;
        breakTime = bars[j].time;
        breakIndex = j;
        break;
      }
    }

    if (brokeLow && !invalid) {
      candidates.push({
        type: 'protected_high_low',
        direction: 'bearish', // Protected High
        time: breakTime,
        timeStart: sh.time,
        timeEnd: breakTime,
        priceHigh: sh.priceHigh + 2.0,
        priceLow: sh.priceHigh - 2.0,
        gapSize: 4.0,
        barIndex: breakIndex,
        properties: { swingTime: sh.time, swingPrice: sh.priceHigh }
      });
    }
  }

  return candidates.sort((a, b) => a.barIndex - b.barIndex);
}

/**
 * 2b. STRUCTURE: Market Structure Shift & Break of Structure
 */
function detectBOSMSSCandidates(bars, preComputedSwings = null) {
  const { allSwings } = preComputedSwings || findSwings(bars);
  const candidates = [];
  if (allSwings.length < 2) return [];

  const swingsByBarIndex = {};
  for (let s = 0; s < allSwings.length; s++) {
    swingsByBarIndex[allSwings[s].barIndex] = allSwings[s];
  }

  let lastSwingHigh = null;
  let lastSwingLow = null;
  let trend = 'neutral'; 

  for (let i = 2; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    const confirmedSwing = swingsByBarIndex[i - 2];
    if (confirmedSwing) {
      if (confirmedSwing.direction === 'bearish') {
        lastSwingHigh = confirmedSwing;
      } else {
        lastSwingLow = confirmedSwing;
      }
    }

    if (lastSwingHigh && prevBar.close <= lastSwingHigh.priceHigh && bar.close > lastSwingHigh.priceHigh) {
      const isMSS = (trend === 'bearish');
      
      candidates.push({
        type: isMSS ? 'mss' : 'bos',
        direction: 'bullish',
        time: bar.time,
        timeStart: lastSwingHigh.time,
        priceHigh: bar.high,
        priceLow: lastSwingHigh.priceHigh,
        barIndex: i,
        properties: { referenceSwingTime: lastSwingHigh.time }
      });
      trend = 'bullish'; 
    }

    if (lastSwingLow && prevBar.close >= lastSwingLow.priceLow && bar.close < lastSwingLow.priceLow) {
      const isMSS = (trend === 'bullish');

      candidates.push({
        type: isMSS ? 'mss' : 'bos',
        direction: 'bearish',
        time: bar.time,
        timeStart: lastSwingLow.time,
        priceHigh: lastSwingLow.priceLow,
        priceLow: bar.low,
        barIndex: i,
        properties: { referenceSwingTime: lastSwingLow.time }
      });
      trend = 'bearish'; 
    }
  }

  return candidates.sort((a, b) => a.barIndex - b.barIndex);
}

/**
 * 3. INEFFICIENCY: Volume Imbalance Candidates
 * Gap between body close and open, where wicks overlap
 */
function detectVolumeImbalanceCandidates(bars) {
  const candidates = [];
  for (let i = 1; i < bars.length; i++) {
    const b0 = bars[i - 1];
    const b1 = bars[i];

    // Bullish Volume Imbalance (gap up in bodies)
    if (b1.open > b0.close) {
      const gapSize = b1.open - b0.close;
      if (gapSize >= 1.0) {
        const wickGap = Math.max(0, b1.low - b0.high);
        candidates.push(makeEvent({
          type: 'volume_imbalance',
          direction: 'bullish',
          time: b1.time,
          timeStart: b0.time,
          timeEnd: b1.time,
          priceHigh: b1.open,
          priceLow: b0.close,
          barIndex: i,
          properties: {
            size: gapSize,
            bodyGap: gapSize,
            wickGap: wickGap
          }
        }));
      }
    }

    // Bearish Volume Imbalance (gap down in bodies)
    if (b1.open < b0.close) {
      const gapSize = b0.close - b1.open;
      if (gapSize >= 1.0) {
        const wickGap = Math.max(0, b0.low - b1.high);
        candidates.push(makeEvent({
          type: 'volume_imbalance',
          direction: 'bearish',
          time: b1.time,
          timeStart: b0.time,
          timeEnd: b1.time,
          priceHigh: b0.close,
          priceLow: b1.open,
          barIndex: i,
          properties: {
            size: gapSize,
            bodyGap: gapSize,
            wickGap: wickGap
          }
        }));
      }
    }
  }
  return candidates;
}

/**
 * 4. INEFFICIENCY: Liquidity Void Candidates
 * 3 consecutive high-displacement candles in the same direction
 */
function detectLiquidityVoidCandidates(bars) {
  const candidates = [];
  const ATR_PERIOD = 14;

  for (let i = ATR_PERIOD + 2; i < bars.length; i++) {
    const b0 = bars[i - 2];
    const b1 = bars[i - 1];
    const b2 = bars[i];

    const avgRange = calculateAvgRangeForIndex(bars, i - 3, ATR_PERIOD);
    
    const isBullishRun = b0.close > b0.open && b1.close > b1.open && b2.close > b2.open;
    const isBearishRun = b0.close < b0.open && b1.close < b1.open && b2.close < b2.open;

    if (isBullishRun) {
      const b0Size = b0.close - b0.open;
      const b1Size = b1.close - b1.open;
      const b2Size = b2.close - b2.open;

      if (b0Size > 1.2 * avgRange && b1Size > 1.2 * avgRange && b2Size > 1.2 * avgRange) {
        const rangeSize = b2.close - b0.open;
        candidates.push(makeEvent({
          type: 'liquidity_void',
          direction: 'bullish',
          time: b2.time,
          timeStart: b0.time,
          timeEnd: b2.time,
          priceHigh: b2.close,
          priceLow: b0.open,
          barIndex: i,
          properties: {
            impulseLength: 3,
            rangeMultiplier: 1.2,
            atrMultiplier: 1.2,
            rangeSize: rangeSize
          }
        }));
      }
    } else if (isBearishRun) {
      const b0Size = b0.open - b0.close;
      const b1Size = b1.open - b1.close;
      const b2Size = b2.open - b2.close;

      if (b0Size > 1.2 * avgRange && b1Size > 1.2 * avgRange && b2Size > 1.2 * avgRange) {
        const rangeSize = b0.open - b2.close;
        candidates.push(makeEvent({
          type: 'liquidity_void',
          direction: 'bearish',
          time: b2.time,
          timeStart: b0.time,
          timeEnd: b2.time,
          priceHigh: b0.open,
          priceLow: b2.close,
          barIndex: i,
          properties: {
            impulseLength: 3,
            rangeMultiplier: 1.2,
            atrMultiplier: 1.2,
            rangeSize: rangeSize
          }
        }));
      }
    }
  }
  return candidates;
}

/**
 * 4b. INEFFICIENCY: Fair Value Gap Candidates (BISI / SIBI)
 * Standard 3-bar Fair Value Gap candidate.
 */
function detectFVGCandidates(bars, options = {}) {
  const {
    startBarIdx = 2,
    endBarIdx = bars.length - 1,
    priceMin = 0,
    priceMax = Infinity,
    eligibleDirection = 'both'
  } = options;

  const candidates = [];
  const startIdx = Math.max(2, startBarIdx);
  const endIdx = Math.min(bars.length - 1, endBarIdx);

  for (let i = startIdx; i <= endIdx; i++) {
    const b0 = bars[i - 2]; 
    const b1 = bars[i - 1]; 
    const b2 = bars[i];     

    if (eligibleDirection === 'both' || eligibleDirection === 'bullish') {
      if (b2.low > b0.high) {
        const gapSize = b2.low - b0.high;
        const priceLow = b0.high;
        const priceHigh = b2.low;
        if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) { 
          candidates.push(makeEvent({
            type: 'fvg',
            direction: 'bullish',
            time: b1.time,         
            timeStart: b0.time,
            timeEnd: b2.time,
            priceHigh: priceHigh,     
            priceLow: priceLow,     
            barIndex: i - 1,       
            gapSize: gapSize,
            properties: {
              originBarIndex: i - 2,
              middleBarIndex: i - 1,
              confirmationBarIndex: i,
              gapSize: gapSize
            }
          }));
        }
      }
    }

    if (eligibleDirection === 'both' || eligibleDirection === 'bearish') {
      if (b2.high < b0.low) {
        const gapSize = b0.low - b2.high;
        const priceLow = b2.high;
        const priceHigh = b0.low;
        if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) {
          candidates.push(makeEvent({
            type: 'fvg',
            direction: 'bearish',
            time: b1.time,
            timeStart: b0.time,
            timeEnd: b2.time,
            priceHigh: priceHigh,
            priceLow: priceLow,
            barIndex: i - 1,
            gapSize: gapSize,
            properties: {
              originBarIndex: i - 2,
              middleBarIndex: i - 1,
              confirmationBarIndex: i,
              gapSize: gapSize
            }
          }));
        }
      }
    }
  }

  return candidates;
}

/**
 * 5. TIME: Session High/Low Candidates
 * Groups bars by day and finds high/low of Asia, London, NY AM, NY PM.
 */
function detectSessionCandidates(bars) {
  const candidates = [];
  const daysMap = new Map(); // dateStr -> array of bars

  for (let i = 0; i < bars.length; i++) {
    const est = getESTDateTime(bars[i].time);
    if (!daysMap.has(est.dateStr)) {
      daysMap.set(est.dateStr, []);
    }
    daysMap.get(est.dateStr).push({ bar: bars[i], idx: i, est });
  }

  for (const [dateStr, dayBars] of daysMap.entries()) {
    const sessions = {
      london: { startHour: 2, endHour: 5, bars: [] },
      ny_am:  { startHour: 7.5, endHour: 12, bars: [] }, // 7:30 to 12
      ny_pm:  { startHour: 13.5, endHour: 16, bars: [] }, // 13:30 to 16
      asia:   { startHour: 18, endHour: 24, bars: [] } // 18:00 to midnight
    };

    for (const item of dayBars) {
      const decimalHour = item.est.hour + item.est.minute / 60;
      
      if (decimalHour >= 2 && decimalHour < 5) sessions.london.bars.push(item);
      if (decimalHour >= 7.5 && decimalHour < 12) sessions.ny_am.bars.push(item);
      if (decimalHour >= 13.5 && decimalHour < 16) sessions.ny_pm.bars.push(item);
      if (decimalHour >= 18 && decimalHour < 24) sessions.asia.bars.push(item);
    }

    for (const [name, sess] of Object.entries(sessions)) {
      if (sess.bars.length > 0) {
        let maxHigh = -Infinity;
        let minLow = Infinity;
        for (const item of sess.bars) {
          if (item.bar.high > maxHigh) maxHigh = item.bar.high;
          if (item.bar.low < minLow) minLow = item.bar.low;
        }

        const firstItem = sess.bars[0];
        const lastItem = sess.bars[sess.bars.length - 1];

        candidates.push({
          type: 'session',
          direction: name,
          time: firstItem.bar.time,
          timeStart: firstItem.bar.time,
          timeEnd: lastItem.bar.time,
          priceHigh: maxHigh,
          priceLow: minLow,
          gapSize: maxHigh - minLow,
          barIndex: firstItem.idx,
          properties: { date: dateStr, name }
        });
      }
    }
  }

  return candidates;
}

/**
 * 6. TIME: Macro Candidates
 * 9:50-10:10, 11:50-12:10, 1:50-2:10 (13:50-14:10), 3:15-3:30 (15:15-15:30) EST
 */
function detectMacroCandidates(bars) {
  const candidates = [];
  const daysMap = new Map();

  for (let i = 0; i < bars.length; i++) {
    const est = getESTDateTime(bars[i].time);
    if (!daysMap.has(est.dateStr)) {
      daysMap.set(est.dateStr, []);
    }
    daysMap.get(est.dateStr).push({ bar: bars[i], idx: i, est });
  }

  for (const [dateStr, dayBars] of daysMap.entries()) {
    const macros = [
      { name: 'macro_950', start: 9.83, end: 10.17 }, // 9:50 to 10:10
      { name: 'macro_1150', start: 11.83, end: 12.17 }, // 11:50 to 12:10
      { name: 'macro_150', start: 13.83, end: 14.17 }, // 1:50 to 2:10
      { name: 'macro_315', start: 15.25, end: 15.50 } // 3:15 to 3:30
    ];

    for (const macro of macros) {
      const matchBars = dayBars.filter(item => {
        const decHour = item.est.hour + item.est.minute / 60;
        return decHour >= macro.start && decHour < macro.end;
      });

      if (matchBars.length > 0) {
        let maxHigh = -Infinity;
        let minLow = Infinity;
        for (const item of matchBars) {
          if (item.bar.high > maxHigh) maxHigh = item.bar.high;
          if (item.bar.low < minLow) minLow = item.bar.low;
        }

        const firstItem = matchBars[0];
        const lastItem = matchBars[matchBars.length - 1];

        candidates.push({
          type: 'macro',
          direction: macro.name,
          time: firstItem.bar.time,
          timeStart: firstItem.bar.time,
          timeEnd: lastItem.bar.time,
          priceHigh: maxHigh,
          priceLow: minLow,
          gapSize: maxHigh - minLow,
          barIndex: firstItem.idx,
          properties: { date: dateStr, name: macro.name }
        });
      }
    }
  }

  return candidates;
}

/**
 * 7. TIME: AMD Cycle Candidates (Accumulation, Manipulation, Distribution)
 */
function detectAMDCandidates(bars) {
  const candidates = [];
  const sessions = detectSessionCandidates(bars);
  
  // Group sessions by day
  const sessionsByDay = new Map();
  for (const s of sessions) {
    const dateStr = s.properties.date;
    if (!sessionsByDay.has(dateStr)) {
      sessionsByDay.set(dateStr, []);
    }
    sessionsByDay.get(dateStr).push(s);
  }

  for (const [dateStr, daySess] of sessionsByDay.entries()) {
    const asia = daySess.find(s => s.direction === 'asia');
    const london = daySess.find(s => s.direction === 'london');
    const nyAm = daySess.find(s => s.direction === 'ny_am');
    const nyPm = daySess.find(s => s.direction === 'ny_pm');

    if (asia && (london || nyAm)) {
      // Accumulation is Asia session range
      const accHigh = asia.priceHigh;
      const accLow = asia.priceLow;

      // Check for Manipulation (sweep of Asia range during London/NY AM)
      const testSessions = [london, nyAm].filter(Boolean);
      let sweptHigh = false;
      let sweptLow = false;
      let manipHigh = accHigh;
      let manipLow = accLow;
      let manipTime = null;
      let manipIndex = null;

      for (const ts of testSessions) {
        if (ts.priceHigh > accHigh) {
          sweptHigh = true;
          manipHigh = ts.priceHigh;
          manipTime = ts.timeStart;
          manipIndex = ts.barIndex;
        }
        if (ts.priceLow < accLow) {
          sweptLow = true;
          manipLow = ts.priceLow;
          manipTime = ts.timeStart;
          manipIndex = ts.barIndex;
        }
      }

      if (sweptHigh || sweptLow) {
        // Distribution range is the NY PM session or the rest of the day expansion
        const distHigh = nyPm ? nyPm.priceHigh : (nyAm ? nyAm.priceHigh : accHigh);
        const distLow = nyPm ? nyPm.priceLow : (nyAm ? nyAm.priceLow : accLow);

        candidates.push({
          type: 'amd',
          direction: sweptLow ? 'bullish' : 'bearish', // Sweeping low leads to bullish expansion
          time: manipTime,
          timeStart: asia.timeStart,
          timeEnd: nyPm ? nyPm.timeEnd : (nyAm ? nyAm.timeEnd : manipTime),
          priceHigh: Math.max(manipHigh, distHigh),
          priceLow: Math.min(manipLow, distLow),
          gapSize: Math.max(manipHigh, distHigh) - Math.min(manipLow, distLow),
          barIndex: manipIndex,
          properties: { date: dateStr, sweptHigh, sweptLow, accHigh, accLow }
        });
      }
    }
  }

  return candidates;
}

/**
 * 8. TIME: Premium / Discount Candidates
 * Splits dealing range (recent Swing High/Low) into Premium & Discount halves
 */
function detectPremiumDiscountCandidates(bars, preComputedSwings = null) {
  const { swingHighs, swingLows } = preComputedSwings || findSwings(bars);
  
  // Filter swings where strength >= 5 to serve as the baseline dealing range anchors
  const filteredHighs = swingHighs.filter(s => calculateSwingStrength(s, bars) >= 5);
  const filteredLows = swingLows.filter(s => calculateSwingStrength(s, bars) >= 5);
  const candidates = [];
  
  // Sort swings chronologically
  const swings = [
    ...filteredHighs.map(s => ({ ...s, swingType: 'high' })),
    ...filteredLows.map(s => ({ ...s, swingType: 'low' }))
  ].sort((a, b) => a.barIndex - b.barIndex);

  if (swings.length === 0) return [];

  let lastHigh = null;
  let lastLow = null;

  for (let i = 0; i < swings.length; i++) {
    const sw = swings[i];
    if (sw.swingType === 'high') {
      lastHigh = sw;
    } else {
      lastLow = sw;
    }

    if (lastHigh && lastLow) {
      const rangeHigh = lastHigh.priceHigh;
      const rangeLow = lastLow.priceLow;
      const equilibrium = (rangeHigh + rangeLow) / 2;

      const timeStart = Math.min(lastHigh.time, lastLow.time);
      const timeConfirm = Math.max(lastHigh.time, lastLow.time);
      const confirmBarIdx = Math.max(lastHigh.barIndex, lastLow.barIndex);

      // Trace forward to find where price closes outside the boundaries
      let breakIdx = null;
      for (let j = confirmBarIdx + 1; j < bars.length; j++) {
        if (bars[j].close > rangeHigh || bars[j].close < rangeLow) {
          breakIdx = j;
          break;
        }
      }

      const timeEnd = breakIdx !== null ? bars[breakIdx].time : null;
      const state = breakIdx !== null ? 'broken' : 'active';

      // Check if this range is nested inside any active external range
      let isInternal = false;
      for (let k = candidates.length - 1; k >= 0; k--) {
        const prev = candidates[k];
        if (prev.state === 'active' && prev.properties && prev.properties.isExternal) {
          if (rangeLow >= prev.properties.rangeLow && rangeHigh <= prev.properties.rangeHigh) {
            isInternal = true;
            break;
          }
        }
      }
      const isExternal = !isInternal;

      // Premium Candidate
      candidates.push(makeEvent({
        type: 'premium_discount',
        direction: 'premium',
        time: timeConfirm,
        timeStart: timeStart,
        timeEnd: timeEnd,
        priceHigh: rangeHigh,
        priceLow: equilibrium,
        barIndex: confirmBarIdx,
        state: state,
        properties: {
          equilibrium,
          rangeHigh,
          rangeLow,
          swingHighTime: lastHigh.time,
          swingLowTime: lastLow.time,
          isExternal,
          isInternal
        }
      }));

      // Discount Candidate
      candidates.push(makeEvent({
        type: 'premium_discount',
        direction: 'discount',
        time: timeConfirm,
        timeStart: timeStart,
        timeEnd: timeEnd,
        priceHigh: equilibrium,
        priceLow: rangeLow,
        barIndex: confirmBarIdx,
        state: state,
        properties: {
          equilibrium,
          rangeHigh,
          rangeLow,
          swingHighTime: lastHigh.time,
          swingLowTime: lastLow.time,
          isExternal,
          isInternal
        }
      }));
    }
  }

  return candidates;
}

/**
 * OB_v1: Order Block candidates.
 * Redesigned as an event-sequence detector instead of a candle pattern scanner.
 */
function detectOrderBlockCandidates(bars, preComputedSwings = null, options = {}) {
  const { swingHighs, swingLows } = preComputedSwings || findSwings(bars);
  const candidates = [];

  const {
    startBarIdx = 2,
    endBarIdx = bars.length - 1,
    priceMin = 0,
    priceMax = Infinity,
    eligibleDirection = 'both'
  } = options;

  // Index swings by their confirmation bar index for O(1) retrieval during iteration
  const swingsByConfirmIndex = {};
  for (const sh of swingHighs) {
    const idx = sh.confirmationBarIndex;
    if (!swingsByConfirmIndex[idx]) swingsByConfirmIndex[idx] = [];
    swingsByConfirmIndex[idx].push({ ...sh, swingType: 'high' });
  }
  for (const sl of swingLows) {
    const idx = sl.confirmationBarIndex;
    if (!swingsByConfirmIndex[idx]) swingsByConfirmIndex[idx] = [];
    swingsByConfirmIndex[idx].push({ ...sl, swingType: 'low' });
  }

  let activeHighs = [];
  let activeLows = [];

  const startIdx = Math.max(2, startBarIdx);
  const endIdx = Math.min(bars.length - 1, endBarIdx);

  for (let i = startIdx; i <= endIdx; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    // Add newly confirmed swings at the current index
    const newlyConfirmed = swingsByConfirmIndex[i];
    if (newlyConfirmed) {
      for (const sw of newlyConfirmed) {
        if (sw.swingType === 'high') {
          activeHighs.push(sw);
        } else {
          activeLows.push(sw);
        }
      }
    }

    // Evict active swings older than 1000 bars to prevent O(N^2) list growth
    while (activeHighs.length > 0 && i - activeHighs[0].confirmationBarIndex > 1000) {
      activeHighs.shift();
    }
    while (activeLows.length > 0 && i - activeLows[0].confirmationBarIndex > 1000) {
      activeLows.shift();
    }

    // Check breaks of active swing highs
    if (eligibleDirection === 'both' || eligibleDirection === 'bullish') {
      const nextActiveHighs = [];
      for (let hIdx = 0; hIdx < activeHighs.length; hIdx++) {
        const sh = activeHighs[hIdx];
        if (bar.close > sh.priceHigh) {
          // High is broken. If this is the first close above the high, check for Order Block
          if (prevBar.close <= sh.priceHigh) {
            const ob = detectBullishOBAtBreak(bars, sh, i, swingLows);
            if (ob && ob.priceLow >= priceMin && ob.priceHigh <= priceMax) {
              candidates.push(ob);
            }
          }
        } else {
          nextActiveHighs.push(sh);
        }
      }
      activeHighs = nextActiveHighs;
    }

    // Check breaks of active swing lows
    if (eligibleDirection === 'both' || eligibleDirection === 'bearish') {
      const nextActiveLows = [];
      for (let lIdx = 0; lIdx < activeLows.length; lIdx++) {
        const sl = activeLows[lIdx];
        if (bar.close < sl.priceLow) {
          // Low is broken. If this is the first close below the low, check for Order Block
          if (prevBar.close >= sl.priceLow) {
            const ob = detectBearishOBAtBreak(bars, sl, i, swingHighs);
            if (ob && ob.priceLow >= priceMin && ob.priceHigh <= priceMax) {
              candidates.push(ob);
            }
          }
        } else {
          nextActiveLows.push(sl);
        }
      }
      activeLows = nextActiveLows;
    }
  }

  return candidates;
}

function findLastIndexLessThan(array, targetVal, key = 'barIndex') {
  let low = 0;
  let high = array.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid][key] < targetVal) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

function findFirstIndexGreaterOrEqual(array, targetVal, key = 'barIndex') {
  let low = 0;
  let high = array.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid][key] >= targetVal) {
      ans = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return ans;
}

/**
 * Helper to detect bullish Order Block at structure break index
 */
function detectBullishOBAtBreak(bars, sh, breakIdx, swingLows) {
  const slIdx = findLastIndexLessThan(swingLows, breakIdx, 'barIndex');
  const sl = slIdx !== -1 ? swingLows[slIdx] : null;
  const searchStartIdx = Math.max(0, Math.min(sh.barIndex, sl ? sl.barIndex : breakIdx) - 2);
  
  let lowestLowIdx = searchStartIdx;
  let minLow = Infinity;
  for (let j = searchStartIdx; j <= breakIdx; j++) {
    if (bars[j].low < minLow) {
      minLow = bars[j].low;
      lowestLowIdx = j;
    }
  }

  let startObIdx = lowestLowIdx;
  while (startObIdx >= 0 && bars[startObIdx].close > bars[startObIdx].open) {
    startObIdx--;
  }
  if (startObIdx < 0 || startObIdx < searchStartIdx - 5) {
    startObIdx = lowestLowIdx;
  }

  const clusterIndices = [];
  let k = startObIdx;
  const ATR_PERIOD = 14;
  while (k >= 0 && clusterIndices.length < 4) {
    const bar = bars[k];
    const avgRange = calculateAvgRangeForIndex(bars, k - 1, ATR_PERIOD);
    const isDown = bar.close <= bar.open;
    const isSmallBody = Math.abs(bar.close - bar.open) < 0.5 * avgRange;
    if (isDown || isSmallBody || clusterIndices.length === 0) {
      clusterIndices.push(k);
      k--;
    } else {
      break;
    }
  }
  clusterIndices.reverse();

  const lastClusterIdx = clusterIndices[clusterIndices.length - 1];
  const priceLow = Math.min(...clusterIndices.map(idx => bars[idx].low));
  const priceHigh = Math.max(...clusterIndices.map(idx => bars[idx].high));

  // Verify displacement in the run [lastClusterIdx + 1, breakIdx]
  let hasDisplacement = false;
  let maxBodyAtrRatio = 0;
  let sumVolume = 0;
  let avgVolumeCount = 0;
  for (let j = Math.max(0, lastClusterIdx - 14); j < lastClusterIdx; j++) {
    sumVolume += bars[j].volume;
    avgVolumeCount++;
  }
  const avgVolume = avgVolumeCount > 0 ? sumVolume / avgVolumeCount : 1;

  let hasVolumeExpansion = false;
  for (let j = lastClusterIdx + 1; j <= breakIdx; j++) {
    const bar = bars[j];
    const avgRange = calculateAvgRangeForIndex(bars, j - 1, ATR_PERIOD);
    const body = bar.close - bar.open;
    if (body > 0) {
      const bodyRangeRatio = body / avgRange;
      if (bodyRangeRatio > maxBodyAtrRatio) maxBodyAtrRatio = bodyRangeRatio;
      if (bodyRangeRatio > 1.5) {
        hasDisplacement = true;
      }
    }
    if (bar.volume > 1.2 * avgVolume) {
      hasVolumeExpansion = true;
    }
  }

  if (!hasDisplacement) return null;

  // Verify no invalidating close before break
  for (let j = lastClusterIdx + 1; j < breakIdx; j++) {
    if (bars[j].close < priceLow) {
      return null;
    }
  }

  // Optional: check liquidity sweep
  let sweptLiquidity = false;
  let sweptSwingTime = null;
  const earliestClusterTime = bars[clusterIndices[0]].time;
  const startSearchIdx = findFirstIndexGreaterOrEqual(swingLows, clusterIndices[0] - 20, 'barIndex');
  const priorLows = [];
  if (startSearchIdx !== -1) {
    for (let j = startSearchIdx; j < swingLows.length; j++) {
      const s = swingLows[j];
      if (s.barIndex > clusterIndices[0]) break;
      if (s.time < earliestClusterTime) {
        priorLows.push(s);
      }
    }
  }
  for (const pl of priorLows) {
    for (const idx of clusterIndices) {
      if (bars[idx].low < pl.priceLow && bars[idx].close > pl.priceLow) {
        sweptLiquidity = true;
        sweptSwingTime = pl.time;
        break;
      }
    }
    if (sweptLiquidity) break;
  }

  // Optional: check FVG created
  let createdFvg = false;
  for (let j = lastClusterIdx + 2; j <= breakIdx; j++) {
    if (bars[j].low > bars[j - 2].high) {
      createdFvg = true;
      break;
    }
  }

  return makeEvent({
    type: 'ob',
    direction: 'bullish',
    time: bars[breakIdx].time,
    timeStart: bars[clusterIndices[0]].time,
    timeEnd: bars[breakIdx].time,
    priceHigh,
    priceLow,
    barIndex: breakIdx,
    properties: {
      sweptLiquidity,
      sweptSwingTime,
      createdFvg,
      displacementMultiplier: maxBodyAtrRatio,
      volumeExpansion: hasVolumeExpansion,
      clusterSize: clusterIndices.length,
      clusterIndices
    }
  });
}

/**
 * Helper to detect bearish Order Block at structure break index
 */
function detectBearishOBAtBreak(bars, sl, breakIdx, swingHighs) {
  const shIdx = findLastIndexLessThan(swingHighs, breakIdx, 'barIndex');
  const sh = shIdx !== -1 ? swingHighs[shIdx] : null;
  const searchStartIdx = Math.max(0, Math.min(sl.barIndex, sh ? sh.barIndex : breakIdx) - 2);
  
  let highestHighIdx = searchStartIdx;
  let maxHigh = -Infinity;
  for (let j = searchStartIdx; j <= breakIdx; j++) {
    if (bars[j].high > maxHigh) {
      maxHigh = bars[j].high;
      highestHighIdx = j;
    }
  }

  let startObIdx = highestHighIdx;
  while (startObIdx >= 0 && bars[startObIdx].close < bars[startObIdx].open) {
    startObIdx--;
  }
  if (startObIdx < 0 || startObIdx < searchStartIdx - 5) {
    startObIdx = highestHighIdx;
  }

  const clusterIndices = [];
  let k = startObIdx;
  const ATR_PERIOD = 14;
  while (k >= 0 && clusterIndices.length < 4) {
    const bar = bars[k];
    const avgRange = calculateAvgRangeForIndex(bars, k - 1, ATR_PERIOD);
    const isUp = bar.close >= bar.open;
    const isSmallBody = Math.abs(bar.close - bar.open) < 0.5 * avgRange;
    if (isUp || isSmallBody || clusterIndices.length === 0) {
      clusterIndices.push(k);
      k--;
    } else {
      break;
    }
  }
  clusterIndices.reverse();

  const lastClusterIdx = clusterIndices[clusterIndices.length - 1];
  const priceLow = Math.min(...clusterIndices.map(idx => bars[idx].low));
  const priceHigh = Math.max(...clusterIndices.map(idx => bars[idx].high));

  let hasDisplacement = false;
  let maxBodyAtrRatio = 0;
  let sumVolume = 0;
  let avgVolumeCount = 0;
  for (let j = Math.max(0, lastClusterIdx - 14); j < lastClusterIdx; j++) {
    sumVolume += bars[j].volume;
    avgVolumeCount++;
  }
  const avgVolume = avgVolumeCount > 0 ? sumVolume / avgVolumeCount : 1;

  let hasVolumeExpansion = false;
  for (let j = lastClusterIdx + 1; j <= breakIdx; j++) {
    const bar = bars[j];
    const avgRange = calculateAvgRangeForIndex(bars, j - 1, ATR_PERIOD);
    const body = bar.open - bar.close;
    if (body > 0) {
      const bodyRangeRatio = body / avgRange;
      if (bodyRangeRatio > maxBodyAtrRatio) maxBodyAtrRatio = bodyRangeRatio;
      if (bodyRangeRatio > 1.5) {
        hasDisplacement = true;
      }
    }
    if (bar.volume > 1.2 * avgVolume) {
      hasVolumeExpansion = true;
    }
  }

  if (!hasDisplacement) return null;

  for (let j = lastClusterIdx + 1; j < breakIdx; j++) {
    if (bars[j].close > priceHigh) {
      return null;
    }
  }

  let sweptLiquidity = false;
  let sweptSwingTime = null;
  const earliestClusterTime = bars[clusterIndices[0]].time;
  const startSearchIdx = findFirstIndexGreaterOrEqual(swingHighs, clusterIndices[0] - 20, 'barIndex');
  const priorHighs = [];
  if (startSearchIdx !== -1) {
    for (let j = startSearchIdx; j < swingHighs.length; j++) {
      const s = swingHighs[j];
      if (s.barIndex > clusterIndices[0]) break;
      if (s.time < earliestClusterTime) {
        priorHighs.push(s);
      }
    }
  }
  for (const ph of priorHighs) {
    for (const idx of clusterIndices) {
      if (bars[idx].high > ph.priceHigh && bars[idx].close < ph.priceHigh) {
        sweptLiquidity = true;
        sweptSwingTime = ph.time;
        break;
      }
    }
    if (sweptLiquidity) break;
  }

  let createdFvg = false;
  for (let j = lastClusterIdx + 2; j <= breakIdx; j++) {
    if (bars[j].high < bars[j - 2].low) {
      createdFvg = true;
      break;
    }
  }

  return makeEvent({
    type: 'ob',
    direction: 'bearish',
    time: bars[breakIdx].time,
    timeStart: bars[clusterIndices[0]].time,
    timeEnd: bars[breakIdx].time,
    priceHigh,
    priceLow,
    barIndex: breakIdx,
    properties: {
      sweptLiquidity,
      sweptSwingTime,
      createdFvg,
      displacementMultiplier: maxBodyAtrRatio,
      volumeExpansion: hasVolumeExpansion,
      clusterSize: clusterIndices.length,
      clusterIndices
    }
  });
}

/**
 * Liquidity_v1: Equal Highs, Equal Lows, Buy Side, and Sell Side Liquidity.
 * Implements persistent swing-based merging (REQH/REQL concepts).
 */
function detectLiquidityCandidates(bars, lookback = 20, preComputedSwings = null, symbol = '') {
  const swingsRaw = preComputedSwings || findSwings(bars);
  const swingHighs = (swingsRaw.swingHighs || []).filter(s => calculateSwingStrength(s, bars) >= 1);
  const swingLows = (swingsRaw.swingLows || []).filter(s => calculateSwingStrength(s, bars) >= 1);
  
  const symConfig = config.symbols[symbol] || config.symbols['default'];
  const TOLERANCE = symConfig.liquidityTolerance;
  const pools = [];

  if (bars.length === 0) return [];

  // Group and sort all swings chronologically by bar index
  const allSwings = [
    ...swingHighs.map(s => ({ ...s, swingType: 'high' })),
    ...swingLows.map(s => ({ ...s, swingType: 'low' }))
  ].sort((a, b) => a.barIndex - b.barIndex);

  for (const sw of allSwings) {
    const swPrice = sw.swingType === 'high' ? sw.priceHigh : sw.priceLow;
    const directionType = sw.swingType === 'high' ? 'bsl' : 'ssl';

    // Look for an existing active pool that is within TOLERANCE and same direction
    let matchedPool = null;
    let scanCount = 0;
    for (let k = pools.length - 1; k >= 0; k--) {
      const p = pools[k];
      if (p.isBroken) continue;
      
      scanCount++;
      if (scanCount > 200) break;
      
      if (p.directionType === directionType && Math.abs(p.levelPrice - swPrice) <= TOLERANCE) {
        const lastSwing = p.swings[p.swings.length - 1];
        if (sw.barIndex - lastSwing.barIndex > 5000) continue;
        
        // Check if price closed/breached past this pool before sw.barIndex using levelPrice breach check
        let wasTaken = false;
        const L = lastSwing.barIndex + 1;
        const R = sw.barIndex - 1;
        if (L <= R) {
          if (p.directionType === 'bsl') {
            for (let idx = L; idx <= R; idx++) {
              if (bars[idx].high > p.levelPrice) {
                wasTaken = true;
                break;
              }
            }
          } else {
            for (let idx = L; idx <= R; idx++) {
              if (bars[idx].low < p.levelPrice) {
                wasTaken = true;
                break;
              }
            }
          }
        }

        if (wasTaken) {
          p.isBroken = true;
        } else {
          matchedPool = p;
          break;
        }
      }
    }

    if (matchedPool) {
      // Merge into matched pool
      matchedPool.swings.push(sw);
      matchedPool.touchCount++;
      matchedPool.swingCount++;
      
      const prices = matchedPool.swings.map(s => s.swingType === 'high' ? s.priceHigh : s.priceLow);
      if (matchedPool.directionType === 'bsl') {
        matchedPool.levelPrice = Math.max(...prices);
      } else {
        matchedPool.levelPrice = Math.min(...prices);
      }
      matchedPool.priceHigh = matchedPool.levelPrice + TOLERANCE;
      matchedPool.priceLow = matchedPool.levelPrice - TOLERANCE;
      matchedPool.timeEnd = sw.time;
      
      if (matchedPool.touchCount >= 2) {
        matchedPool.direction = matchedPool.directionType === 'bsl' ? 'reqh' : 'reql';
      }
      
      matchedPool.properties.clusterMembers.push({
        barIndex: sw.barIndex,
        time: sw.time,
        price: swPrice,
        strength: calculateSwingStrength(sw, bars)
      });
      matchedPool.properties.touchCount = matchedPool.touchCount;
      matchedPool.properties.swingCount = matchedPool.swingCount;
      matchedPool.properties.levelPrice = matchedPool.levelPrice;
      matchedPool.properties.isMajor = matchedPool.swings.some(s => calculateSwingStrength(s, bars) >= 5);
    } else {
      // Create new pool
      pools.push({
        type: 'liquidity',
        directionType, 
        direction: directionType,
        time: sw.time,
        timeStart: sw.time,
        timeEnd: sw.time,
        priceHigh: swPrice + TOLERANCE,
        priceLow: swPrice - TOLERANCE,
        barIndex: sw.barIndex,
        levelPrice: swPrice,
        touchCount: 1,
        swingCount: 1,
        swings: [sw],
        properties: {
          levelPrice: swPrice,
          touchCount: 1,
          swingCount: 1,
          isMajor: calculateSwingStrength(sw, bars) >= 5,
          clusterMembers: [{
            barIndex: sw.barIndex,
            time: sw.time,
            price: swPrice,
            strength: calculateSwingStrength(sw, bars)
          }],
          stateHistory: [{ state: 'active', time: sw.time, barIndex: sw.barIndex }],
          interactionHistory: []
        }
      });
    }
  }

  // Precompute average range for all bars to avoid $O(14)$ overhead in the tracking loop
  const ATR_PERIOD = 14;
  const atrValues = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    atrValues[i] = calculateAvgRangeForIndex(bars, i, ATR_PERIOD);
  }

  // Simulate state lifecycle transitions for each pool using exact levelPrice crossing
  for (const p of pools) {
    let state = 'active';
    const stateHistory = [{ state: 'active', time: bars[p.barIndex].time, barIndex: p.barIndex }];
    const interactionHistory = [];

    // Trace bars chronologically from the last swing index in the pool
    const lastSwingIdx = p.swings[p.swings.length - 1].barIndex;
    for (let j = lastSwingIdx + 1; j < bars.length; j++) {
      const bar = bars[j];
      const atr = atrValues[j - 1];

      if (state === 'active' || state === 'swept') {
        if (p.directionType === 'bsl') {
          if (bar.high > p.levelPrice) {
            if (bar.close <= p.levelPrice) {
              if (state !== 'swept') {
                state = 'swept';
                stateHistory.push({ state: 'swept', time: bar.time, barIndex: j });
              }
              interactionHistory.push({ type: 'sweep', time: bar.time, price: bar.high, barIndex: j });
            } else {
              state = 'taken';
              stateHistory.push({ state: 'taken', time: bar.time, barIndex: j });
              interactionHistory.push({ type: 'taken', time: bar.time, price: bar.close, barIndex: j });
            }
          }
        } else {
          // ssl
          if (bar.low < p.levelPrice) {
            if (bar.close >= p.levelPrice) {
              if (state !== 'swept') {
                state = 'swept';
                stateHistory.push({ state: 'swept', time: bar.time, barIndex: j });
              }
              interactionHistory.push({ type: 'sweep', time: bar.time, price: bar.low, barIndex: j });
            } else {
              state = 'taken';
              stateHistory.push({ state: 'taken', time: bar.time, barIndex: j });
              interactionHistory.push({ type: 'taken', time: bar.time, price: bar.close, barIndex: j });
            }
          }
        }
      } else if (state === 'taken') {
        // Check for reclaimed or breakout archiving
        if (p.directionType === 'bsl') {
          if (bar.close <= p.levelPrice) {
            // Price closed back below the high level -> reclaimed or archived immediately
            if (bar.close < p.levelPrice - 2.0 * atr) {
              state = 'archived';
              stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
              break;
            } else {
              state = 'reclaimed';
              stateHistory.push({ state: 'reclaimed', time: bar.time, barIndex: j });
              interactionHistory.push({ type: 'reclaimed', time: bar.time, price: bar.low, barIndex: j });
            }
          } else if (bar.close > p.levelPrice + 5.0 * atr) {
            // Strong breakout -> archive
            state = 'archived';
            stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
            break;
          }
        } else {
          // ssl
          if (bar.close >= p.levelPrice) {
            // Price closed back above the low level -> reclaimed or archived immediately
            if (bar.close > p.levelPrice + 2.0 * atr) {
              state = 'archived';
              stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
              break;
            } else {
              state = 'reclaimed';
              stateHistory.push({ state: 'reclaimed', time: bar.time, barIndex: j });
              interactionHistory.push({ type: 'reclaimed', time: bar.time, price: bar.high, barIndex: j });
            }
          } else if (bar.close < p.levelPrice - 5.0 * atr) {
            // Strong breakout -> archive
            state = 'archived';
            stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
            break;
          }
        }
      } else if (state === 'reclaimed') {
        if (p.directionType === 'bsl') {
          if (bar.close < p.levelPrice - 2.0 * atr) {
            state = 'archived';
            stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
            break;
          }
        } else {
          if (bar.close > p.levelPrice + 2.0 * atr) {
            state = 'archived';
            stateHistory.push({ state: 'archived', time: bar.time, barIndex: j });
            break;
          }
        }
      }
    }

    p.state = state;
    p.properties.stateHistory = stateHistory;
    p.properties.interactionHistory = interactionHistory;
  }

  // Determine timeframe for quality scoring
  let timeframe = 1;
  if (bars.length >= 2) {
    const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
    if (diffMin > 0) {
      timeframe = diffMin;
    }
  }

  // Calculate Quality Score for each pool
  for (const p of pools) {
    const maxStrength = p.swings.reduce((max, s) => Math.max(max, calculateSwingStrength(s, bars)), 1);
    p.properties.maxStrength = maxStrength;
    
    const touchCount = p.touchCount || 1;
    let score = touchCount * 15; // weight on touchCount/consolidation
    score += maxStrength * 2.5; // weight on swing pivot strength
    
    // Timeframe weight
    const tfWeights = { 1: 5, 5: 10, 15: 20, 60: 35, 240: 50, 1440: 75 };
    score += tfWeights[timeframe] || 5;
    
    // State weight
    if (p.state === 'active') {
      score += 15;
    } else if (p.state === 'swept') {
      score += 5;
    }
    
    p.properties.qualityScore = Math.min(100, Math.round(score));
  }

  return pools.map(p => {
    const { directionType, swings, ...rest } = p;
    return makeEvent(rest);
  });
}

/**
 * IFVG_v1: Inverted Fair Value Gaps.
 */
function detectIFVGCandidates(bars) {
  const fvgs = detectFVGCandidates(bars);
  const candidates = [];

  fvgs.sort((a, b) => a.barIndex - b.barIndex);
  
  let fvgIdx = 0;
  const activeFVGs = []; 

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    
    // Evict stale active FVGs older than 1000 bars
    for (let k = activeFVGs.length - 1; k >= 0; k--) {
      if (i - activeFVGs[k].barIndex > 1000) {
        activeFVGs.splice(k, 1);
      }
    }

    while (fvgIdx < fvgs.length && fvgs[fvgIdx].barIndex + 2 <= i) {
      activeFVGs.push(fvgs[fvgIdx]);
      fvgIdx++;
    }
    
    for (let k = activeFVGs.length - 1; k >= 0; k--) {
      const f = activeFVGs[k];
      const fvgGapSize = f.gapSize || (f.properties && f.properties.gapSize) || (f.priceHigh - f.priceLow);
      if (f.direction === 'bullish' && bar.close < f.priceLow) {
        candidates.push(makeEvent({
          type: 'ifvg',
          direction: 'bearish',
          time: bar.time,
          timeStart: f.time,
          timeEnd: bar.time,
          priceHigh: f.priceHigh,
          priceLow: f.priceLow,
          gapSize: fvgGapSize,
          barIndex: i,
          originalFvgTime: f.time,
          impulseBody: f.impulseBody,
          impulseDir: f.impulseDir,
          properties: {
            gapSize: fvgGapSize,
            originalFvgTime: f.time,
            impulseBody: f.impulseBody,
            impulseDir: f.impulseDir
          }
        }));
        activeFVGs.splice(k, 1); 
      } else if (f.direction === 'bearish' && bar.close > f.priceHigh) {
        candidates.push(makeEvent({
          type: 'ifvg',
          direction: 'bullish',
          time: bar.time,
          timeStart: f.time,
          timeEnd: bar.time,
          priceHigh: f.priceHigh,
          priceLow: f.priceLow,
          gapSize: fvgGapSize,
          barIndex: i,
          originalFvgTime: f.time,
          impulseBody: f.impulseBody,
          impulseDir: f.impulseDir,
          properties: {
            gapSize: fvgGapSize,
            originalFvgTime: f.time,
            impulseBody: f.impulseBody,
            impulseDir: f.impulseDir
          }
        }));
        activeFVGs.splice(k, 1); 
      }
    }
  }

  return candidates;
}

module.exports = {
  detectDisplacementCandidates,
  calculateSwingStrength,
  findSwings,
  findSwingsWindowed,
  detectSwingCandidates,
  detectProtectedHighLowCandidates,
  detectBOSMSSCandidates,
  detectFVGCandidates,
  detectVolumeImbalanceCandidates,
  detectLiquidityVoidCandidates,
  detectSessionCandidates,
  detectMacroCandidates,
  detectAMDCandidates,
  detectPremiumDiscountCandidates,
  detectOrderBlockCandidates,
  detectLiquidityCandidates,
  detectIFVGCandidates
};

