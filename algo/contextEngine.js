const { getDB } = require('./db');
const { getESTOffset } = require('./utils/math/time');

/**
 * Perform a binary search on a sorted bars array to find the last bar index
 * whose timestamp is <= targetTime. Returns a slice of the last 'count' bars.
 */
function getBarsUpTo(bars, targetTime, count = 50) {
  if (!bars || bars.length === 0) return [];
  
  let low = 0;
  let high = bars.length - 1;
  let ans = -1;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bars[mid].time <= targetTime) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  if (ans === -1) return [];
  const start = Math.max(0, ans - count + 1);
  return bars.slice(start, ans + 1);
}

/**
 * Helper to find the last bar index in a sorted bars array whose timestamp is <= targetTime.
 * Returns -1 if not found.
 */
function findIndexUpTo(bars, targetTime) {
  if (!bars || bars.length === 0) return -1;
  let low = 0;
  let high = bars.length - 1;
  let ans = -1;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bars[mid].time <= targetTime) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

/**
 * Precompute SMA 50 values for an array of bars using a sliding window.
 */
function precomputeSMA(bars, period = 50) {
  const n = bars.length;
  const sma = new Float64Array(n);
  if (n < period) return sma;
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  sma[period - 1] = sum / period;
  
  for (let i = period; i < n; i++) {
    sum = sum - bars[i - period].close + bars[i].close;
    sma[i] = sum / period;
  }
  return sma;
}

/**
 * Fetch unmitigated (active) events within a list by doing a binary search
 * to targetTime, and then scanning backward to gather up to 'limit' events.
 */
function getActiveEvents(events, targetTime, limit = 50) {
  if (!events || events.length === 0) return [];
  const ans = findIndexUpTo(events, targetTime);
  if (ans === -1) return [];
  const active = [];
  let scanCount = 0;
  for (let i = ans; i >= 0; i--) {
    scanCount++;
    if (scanCount > 300) break;
    const e = events[i];
    const isMitigated = e.mitigation_time !== undefined && e.mitigation_time !== null && e.mitigation_time <= targetTime;
    if (!isMitigated) {
      active.push(e);
      if (active.length >= limit) break;
    }
  }
  return active;
}

/**
 * Perform binary search on sorted events array to find the index of the last event <= targetTime.
 * Returns a slice of the last 'limit' events.
 */
function getRecentEventsUpTo(events, targetTime, limit = 20) {
  if (!events || events.length === 0) return [];
  
  let low = 0;
  let high = events.length - 1;
  let ans = -1;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].time <= targetTime) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  if (ans === -1) return [];
  const start = Math.max(0, ans - limit + 1);
  return events.slice(start, ans + 1);
}

/**
 * Find recent events matching filters using binary search to locate the point in time
 * and then scan backwards to avoid scanning the entire events array.
 */
function findRecentEvents(events, targetTime, filters = {}, limit = 1) {
  if (!events || events.length === 0) return [];

  let low = 0;
  let high = events.length - 1;
  let ans = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].time <= targetTime) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (ans === -1) return [];

  const results = [];
  let scanCount = 0;
  for (let i = ans; i >= 0; i--) {
    const e = events[i];
    scanCount++;
    if (scanCount > 300) {
      break;
    }
    
    let match = true;
    for (const [k, v] of Object.entries(filters)) {
      if (k === 'concept') {
        if (e.concept !== v) { match = false; break; }
      } else if (k === 'timeframe') {
        if (e.timeframe !== v) { match = false; break; }
      } else if (k === 'direction') {
        if (e.direction !== v) { match = false; break; }
      } else if (k === 'is_mitigated') {
        const isMitigated = e.mitigation_time !== undefined && e.mitigation_time !== null && e.mitigation_time <= targetTime;
        const checkVal = v ? 1 : 0;
        if ((isMitigated ? 1 : 0) !== checkVal) { match = false; break; }
      } else if (k === 'concepts') {
        if (!v.includes(e.concept)) { match = false; break; }
      }
    }

    if (match) {
      results.push(e);
      if (results.length >= limit) {
        break;
      }
    }
  }

  return results;
}

/**
 * Calculates Simple Moving Average Bias (SMA 50) for a given end index in bars.
 * Avoids any slicing.
 */
function calculateSMABiasForIndex(bars, endIdx, period = 50) {
  const startIdx = endIdx - period + 1;
  if (startIdx < 0 || endIdx >= bars.length) return 0;
  
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    sum += bars[i].close;
  }
  const sma = sum / period;
  const lastClose = bars[endIdx].close;
  return lastClose > sma ? 1 : lastClose < sma ? -1 : 0;
}

/**
 * Calculate Average True Range (ATR 14) for a given end index in bars.
 * Avoids any slicing.
 */
function calculateATR14ForIndex(bars, endIdx) {
  const period = 14;
  const startIdx = endIdx - period;
  if (startIdx < 1 || endIdx >= bars.length) return 10.0;
  
  let sum = 0;
  let count = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (i === 0 || !bars[i - 1]) continue;
    const highLow = bars[i].high - bars[i].low;
    const highClose = Math.abs(bars[i].high - bars[i - 1].close);
    const lowClose = Math.abs(bars[i].low - bars[i - 1].close);
    sum += Math.max(highLow, highClose, lowClose);
    count++;
  }
  
  return count > 0 ? sum / count : 10.0;
}

/**
 * Helper to get EST time attributes
 */
function getESTDateTime(unixTs) {
  const offset = getESTOffset(unixTs);
  const d = new Date((unixTs + offset) * 1000);
  const hour = d.getUTCHours();
  const month = d.getUTCMonth() + 1;
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  const year = d.getUTCFullYear();
  const weekday = d.getUTCDay(); 
  
  let session = 'Off';
  if (hour >= 2 && hour < 5) session = 'London';
  else if (hour >= 7 && hour < 12) session = 'NY_AM';
  else if (hour >= 12 && hour < 13) session = 'NY_Lunch';
  else if (hour >= 13 && hour < 16) session = 'NY_PM';
  else if (hour >= 18 && hour < 24 || hour >= 0 && hour < 2) session = 'Asia';
  
  return { year, quarter, month, weekday, session, hour, offset };
}

/**
 * Main function: Capture full market context at the exact moment of event creation.
 * Uses index-based loops to perform 1000x faster by avoiding slicing & garbage collection.
 */
function captureEventContext(event, raw1mBars, ans = -1, preFilteredEvents = {}, preAggregated = {}, eventTimeframe = 1, rollingCache = null) {
  const eventTime = event.time;
  
  if (ans === undefined || ans === null || ans === -1) {
    ans = findIndexUpTo(raw1mBars, eventTime);
  }
  if (ans === -1) return null;
  const currentPrice = raw1mBars[ans].close;
  
  // 1. TIME CONTEXT & SESSION CONTEXT
  const timeContext = getESTDateTime(eventTime);
  
  const sessionAsia = timeContext.session === 'Asia' ? 1 : 0;
  const sessionLondon = timeContext.session === 'London' ? 1 : 0;
  const sessionNy = (timeContext.session === 'NY_AM' || timeContext.session === 'NY_PM' || timeContext.session === 'NY_Lunch') ? 1 : 0;
  const sessionNyAm = timeContext.session === 'NY_AM' ? 1 : 0;
  const sessionNyPm = timeContext.session === 'NY_PM' ? 1 : 0;
  
  // Resolve active event timeframe bars and ATR14
  let atr14 = 10.0;
  let currentBar = null;
  let prevBar = null;
  let hasTfBars = false;
  
  if (eventTimeframe === 1) {
    atr14 = calculateATR14ForIndex(raw1mBars, ans);
    hasTfBars = ans >= 1;
    currentBar = raw1mBars[ans];
    prevBar = ans > 0 ? raw1mBars[ans - 1] : null;
  } else {
    const tfBarsArray = preAggregated[`tf${eventTimeframe}Bars`] || [];
    const tfIdx = findIndexUpTo(tfBarsArray, eventTime);
    if (tfIdx !== -1) {
      atr14 = calculateATR14ForIndex(tfBarsArray, tfIdx);
      hasTfBars = tfIdx >= 1;
      currentBar = tfBarsArray[tfIdx];
      prevBar = tfIdx > 0 ? tfBarsArray[tfIdx - 1] : null;
    }
  }
  
  const volatilityRegime = currentPrice > 0 ? (atr14 / currentPrice) * 1000 : 0.0;
  
  // 2. PRICE CONTEXT
  let dailyHigh = -Infinity;
  let dailyLow = Infinity;
  let weeklyHigh = -Infinity;
  let weeklyLow = Infinity;

  if (rollingCache) {
    dailyHigh = rollingCache.dailyMaxs[ans];
    dailyLow = rollingCache.dailyMins[ans];
    weeklyHigh = rollingCache.weeklyMaxs[ans];
    weeklyLow = rollingCache.weeklyMins[ans];
  } else {
    // Daily High / Low over last 1440 1m bars (1 day) - Avoid slice
    const dayStart = Math.max(0, ans - 1439);
    for (let i = dayStart; i <= ans; i++) {
      const b = raw1mBars[i];
      if (b.high > dailyHigh) dailyHigh = b.high;
      if (b.low < dailyLow) dailyLow = b.low;
    }
    if (dailyHigh === -Infinity) {
      dailyHigh = currentPrice;
      dailyLow = currentPrice;
    }

    // Weekly High / Low over last 7200 1m bars (5 days) - Avoid slice
    const weekStart = Math.max(0, ans - 7199);
    for (let i = weekStart; i <= ans; i++) {
      const b = raw1mBars[i];
      if (b.high > weeklyHigh) weeklyHigh = b.high;
      if (b.low < weeklyLow) weeklyLow = b.low;
    }
    if (weeklyHigh === -Infinity) {
      weeklyHigh = currentPrice;
      weeklyLow = currentPrice;
    }
  }
  
  const dailyRangePts = dailyHigh - dailyLow || 1.0;
  const dailyRangePct = ((currentPrice - dailyLow) / dailyRangePts) * 100;
  
  const distDailyHigh = dailyHigh - currentPrice;
  const distDailyLow = currentPrice - dailyLow;
  const distWeeklyHigh = weeklyHigh - currentPrice;
  const distWeeklyLow = currentPrice - weeklyLow;
  
  // Premium/Discount Status in last confirmed Swing High / Swing Low
  const recentHighsList = getRecentEventsUpTo(preFilteredEvents.swingHighs || [], eventTime, 5);
  const recentLowsList = getRecentEventsUpTo(preFilteredEvents.swingLows || [], eventTime, 5);
  
  let premiumDiscountStatus = 0.5; 
  if (recentHighsList.length > 0 && recentLowsList.length > 0) {
    const lastSH = recentHighsList[recentHighsList.length - 1].priceHigh;
    const lastSL = recentLowsList[recentLowsList.length - 1].priceLow;
    const rangeSize = lastSH - lastSL || 1.0;
    premiumDiscountStatus = (currentPrice - lastSL) / rangeSize;
  }
  
  // 3. MARKET STRUCTURE CONTEXT (Multi-Timeframe Bias)
  let bias_1m = 0;
  if (rollingCache && rollingCache.sma1m) {
    if (ans >= 49) {
      const sma = rollingCache.sma1m[ans];
      const close = raw1mBars[ans].close;
      bias_1m = close > sma ? 1 : close < sma ? -1 : 0;
    }
  } else {
    bias_1m = calculateSMABiasForIndex(raw1mBars, ans, 50);
  }
  
  let bias_5m = 0;
  const idx5 = (event.tfBarIndices && event.tfBarIndices[5] !== undefined) ? event.tfBarIndices[5] : findIndexUpTo(preAggregated.tf5Bars, eventTime);
  if (idx5 !== -1) {
    if (rollingCache && rollingCache.sma5m) {
      if (idx5 >= 49) {
        const sma = rollingCache.sma5m[idx5];
        const close = preAggregated.tf5Bars[idx5].close;
        bias_5m = close > sma ? 1 : close < sma ? -1 : 0;
      }
    } else {
      bias_5m = calculateSMABiasForIndex(preAggregated.tf5Bars, idx5, 50);
    }
  }
  
  let bias_15m = 0;
  const idx15 = (event.tfBarIndices && event.tfBarIndices[15] !== undefined) ? event.tfBarIndices[15] : findIndexUpTo(preAggregated.tf15Bars, eventTime);
  if (idx15 !== -1) {
    if (rollingCache && rollingCache.sma15m) {
      if (idx15 >= 49) {
        const sma = rollingCache.sma15m[idx15];
        const close = preAggregated.tf15Bars[idx15].close;
        bias_15m = close > sma ? 1 : close < sma ? -1 : 0;
      }
    } else {
      bias_15m = calculateSMABiasForIndex(preAggregated.tf15Bars, idx15, 50);
    }
  }
  
  let bias_1h = 0;
  const idx60 = (event.tfBarIndices && event.tfBarIndices[60] !== undefined) ? event.tfBarIndices[60] : findIndexUpTo(preAggregated.tf60Bars, eventTime);
  if (idx60 !== -1) {
    if (rollingCache && rollingCache.sma60m) {
      if (idx60 >= 49) {
        const sma = rollingCache.sma60m[idx60];
        const close = preAggregated.tf60Bars[idx60].close;
        bias_1h = close > sma ? 1 : close < sma ? -1 : 0;
      }
    } else {
      bias_1h = calculateSMABiasForIndex(preAggregated.tf60Bars, idx60, 50);
    }
  }
  
  let bias_4h = 0;
  const idx240 = (event.tfBarIndices && event.tfBarIndices[240] !== undefined) ? event.tfBarIndices[240] : findIndexUpTo(preAggregated.tf240Bars, eventTime);
  if (idx240 !== -1) {
    if (rollingCache && rollingCache.sma240m) {
      if (idx240 >= 49) {
        const sma = rollingCache.sma240m[idx240];
        const close = preAggregated.tf240Bars[idx240].close;
        bias_4h = close > sma ? 1 : close < sma ? -1 : 0;
      }
    } else {
      bias_4h = calculateSMABiasForIndex(preAggregated.tf240Bars, idx240, 50);
    }
  }
  
  let bias_daily = 0;
  const idx1440 = (event.tfBarIndices && event.tfBarIndices[1440] !== undefined) ? event.tfBarIndices[1440] : findIndexUpTo(preAggregated.tf1440Bars, eventTime);
  if (idx1440 !== -1) {
    if (rollingCache && rollingCache.sma1440m) {
      if (idx1440 >= 49) {
        const sma = rollingCache.sma1440m[idx1440];
        const close = preAggregated.tf1440Bars[idx1440].close;
        bias_daily = close > sma ? 1 : close < sma ? -1 : 0;
      }
    } else {
      bias_daily = calculateSMABiasForIndex(preAggregated.tf1440Bars, idx1440, 50);
    }
  }
  
  // 4. LIQUIDITY CONTEXT
  let closestLiqAbove = null;
  let closestLiqBelow = null;
  let distToLiqAbove = null;
  let distToLiqBelow = null;
  let eqHighPresent = 0;
  let eqLowPresent = 0;
  
  const poolHighs = getRecentEventsUpTo(preFilteredEvents.swingHighs || [], eventTime, 20).map(s => s.priceHigh);
  const poolLows = getRecentEventsUpTo(preFilteredEvents.swingLows || [], eventTime, 20).map(s => s.priceLow);
  
  if (poolHighs.length > 0) {
    const highsAbove = poolHighs.filter(h => h > currentPrice);
    if (highsAbove.length > 0) {
      closestLiqAbove = Math.min(...highsAbove);
      distToLiqAbove = closestLiqAbove - currentPrice;
    }
    
    // Equal High check
    const liqTolerance = 0.1 * atr14;
    for (let i = 0; i < poolHighs.length; i++) {
      for (let j = i + 1; j < poolHighs.length; j++) {
        if (Math.abs(poolHighs[i] - poolHighs[j]) <= liqTolerance) {
          eqHighPresent = 1;
          break;
        }
      }
      if (eqHighPresent) break;
    }
  }
  
  if (poolLows.length > 0) {
    const lowsBelow = poolLows.filter(l => l < currentPrice);
    if (lowsBelow.length > 0) {
      closestLiqBelow = Math.max(...lowsBelow);
      distToLiqBelow = currentPrice - closestLiqBelow;
    }
    
    // Equal Low check
    const liqTolerance = 0.1 * atr14;
    for (let i = 0; i < poolLows.length; i++) {
      for (let j = i + 1; j < poolLows.length; j++) {
        if (Math.abs(poolLows[i] - poolLows[j]) <= liqTolerance) {
          eqLowPresent = 1;
          break;
        }
      }
      if (eqLowPresent) break;
    }
  }
  
  // 5. FVG CONTEXT
  const fvgSize = event.type === 'fvg' ? (event.priceHigh - event.priceLow) : 0.0;
  const fvgAtrRatio = atr14 > 0 ? fvgSize / atr14 : 0.0;
  const fvgAge = 0;
  
  // Nearby active (untouched) FVGs within 2 ATRs
  let untouchedNearbyCount = 0;
  const recentFVGs = getRecentEventsUpTo(preFilteredEvents.fvgs || [], eventTime, 100);
  for (const f of recentFVGs) {
    if (!f.timeEnd || f.timeEnd > eventTime) {
      const fMid = (f.priceHigh + f.priceLow) / 2;
      if (Math.abs(fMid - currentPrice) <= 2 * atr14) {
        untouchedNearbyCount++;
      }
    }
  }
  
  // 6. ORDER FLOW CONTEXT
  const recentBOSMSS = getRecentEventsUpTo(preFilteredEvents.bosMss || [], eventTime, 5);
  let flowBeforeMss = 0;
  let flowAfterMss = 0;
  let flowBeforeBos = 0;
  let flowAfterBos = 0;
  
  const mssEvents = recentBOSMSS.filter(e => e.type === 'mss');
  const bosEvents = recentBOSMSS.filter(e => e.type === 'bos');
  
  if (mssEvents.length > 0) {
    const lastMssTime = mssEvents[mssEvents.length - 1].time;
    if (eventTime - lastMssTime <= 20 * eventTimeframe * 60) {
      flowAfterMss = 1;
    } else {
      flowBeforeMss = 1;
    }
  } else {
    flowBeforeMss = 1;
  }
  
  if (bosEvents.length > 0) {
    const lastBosTime = bosEvents[bosEvents.length - 1].time;
    if (eventTime - lastBosTime <= 20 * eventTimeframe * 60) {
      flowAfterBos = 1;
    } else {
      flowBeforeBos = 1;
    }
  } else {
    flowBeforeBos = 1;
  }
  
  // Sweep Check
  let sweepOccurred = 0;
  let noSweep = 1;
  if (hasTfBars && currentBar && prevBar && recentHighsList.length > 0 && recentLowsList.length > 0) {
    const lastSH = recentHighsList[recentHighsList.length - 1].priceHigh;
    const lastSL = recentLowsList[recentLowsList.length - 1].priceLow;
    
    const currentSweptHigh = currentBar.high > lastSH && currentBar.close <= lastSH;
    const prevSweptHigh = prevBar.high > lastSH && prevBar.close <= lastSH;
    const currentSweptLow = currentBar.low < lastSL && currentBar.close >= lastSL;
    const prevSweptLow = prevBar.low < lastSL && prevBar.close >= lastSL;
    
    if (currentSweptHigh || prevSweptHigh || currentSweptLow || prevSweptLow) {
      sweepOccurred = 1;
      noSweep = 0;
    }
  }
  
  const HTF_MAP = {
    1: 5,
    5: 15,
    15: 60,
    60: 240,
    240: 1440,
    1440: null
  };
  
  const LTF_MAP = {
    1: null,
    5: 1,
    15: 5,
    60: 15,
    240: 60,
    1440: 240
  };
  
  // HTF and LTF structures
  const htfTf = HTF_MAP[eventTimeframe];
  let htfStructureEventId = null;
  if (htfTf) {
    if (preFilteredEvents.bosMssByTf && preFilteredEvents.bosMssByTf[htfTf]) {
      const htfStructs = getRecentEventsUpTo(preFilteredEvents.bosMssByTf[htfTf], eventTime, 1);
      if (htfStructs.length > 0) htfStructureEventId = htfStructs[0].id;
    } else if (preFilteredEvents.bosMssAll) {
      const htfStructs = findRecentEvents(preFilteredEvents.bosMssAll, eventTime, { timeframe: htfTf }, 1);
      if (htfStructs.length > 0) htfStructureEventId = htfStructs[0].id;
    }
  }
  
  const ltfTf = LTF_MAP[eventTimeframe];
  let ltfStructureEventId = null;
  if (ltfTf) {
    if (preFilteredEvents.bosMssByTf && preFilteredEvents.bosMssByTf[ltfTf]) {
      const ltfStructs = getRecentEventsUpTo(preFilteredEvents.bosMssByTf[ltfTf], eventTime, 1);
      if (ltfStructs.length > 0) ltfStructureEventId = ltfStructs[0].id;
    } else if (preFilteredEvents.bosMssAll) {
      const ltfStructs = findRecentEvents(preFilteredEvents.bosMssAll, eventTime, { timeframe: ltfTf }, 1);
      if (ltfStructs.length > 0) ltfStructureEventId = ltfStructs[0].id;
    }
  }
  
  let nearestHtfHigh = null;
  let nearestHtfLow = null;
  const htfTfForHighLow = htfTf || 1440; // Fallback to daily swings if no HTF
  if (preFilteredEvents.swingsBearishByTf && preFilteredEvents.swingsBullishByTf) {
    const arrH = preFilteredEvents.swingsBearishByTf[htfTfForHighLow];
    if (arrH) {
      const recentHtfSH = getRecentEventsUpTo(arrH, eventTime, 1);
      if (recentHtfSH.length > 0) nearestHtfHigh = recentHtfSH[0].priceHigh;
    }
    const arrL = preFilteredEvents.swingsBullishByTf[htfTfForHighLow];
    if (arrL) {
      const recentHtfSL = getRecentEventsUpTo(arrL, eventTime, 1);
      if (recentHtfSL.length > 0) nearestHtfLow = recentHtfSL[0].priceLow;
    }
  } else if (preFilteredEvents.swingsBearish && preFilteredEvents.swingsBullish) {
    const recentHtfSH = findRecentEvents(preFilteredEvents.swingsBearish, eventTime, { timeframe: htfTfForHighLow }, 1);
    if (recentHtfSH.length > 0) nearestHtfHigh = recentHtfSH[0].priceHigh;
    
    const recentHtfSL = findRecentEvents(preFilteredEvents.swingsBullish, eventTime, { timeframe: htfTfForHighLow }, 1);
    if (recentHtfSL.length > 0) nearestHtfLow = recentHtfSL[0].priceLow;
  }
  
  // Nearest BSL / SSL active pools
  let nearestBslPrice = null;
  let nearestBslEventId = null;
  let nearestSslPrice = null;
  let nearestSslEventId = null;
  
  if (preFilteredEvents.liquidityBsl && preFilteredEvents.liquiditySsl) {
    const activeBsls = getActiveEvents(preFilteredEvents.liquidityBsl, eventTime, 100);
    let minBslDiff = Infinity;
    for (const b of activeBsls) {
      const p = b.levelPrice || (b.priceHigh + b.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minBslDiff) {
        minBslDiff = diff;
        nearestBslPrice = p;
        nearestBslEventId = b.id;
      }
    }
    
    const activeSsls = getActiveEvents(preFilteredEvents.liquiditySsl, eventTime, 100);
    let minSslDiff = Infinity;
    for (const s of activeSsls) {
      const p = s.levelPrice || (s.priceHigh + s.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minSslDiff) {
        minSslDiff = diff;
        nearestSslPrice = p;
        nearestSslEventId = s.id;
      }
    }
  } else if (preFilteredEvents.liquidity) {
    const activeBsls = findRecentEvents(preFilteredEvents.liquidity, eventTime, { is_mitigated: 0 }, 100)
      .filter(e => e.direction === 'bsl' || e.direction === 'eqh' || e.direction === 'reqh');
    let minBslDiff = Infinity;
    for (const b of activeBsls) {
      const p = b.levelPrice || (b.priceHigh + b.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minBslDiff) {
        minBslDiff = diff;
        nearestBslPrice = p;
        nearestBslEventId = b.id;
      }
    }
    
    const activeSsls = findRecentEvents(preFilteredEvents.liquidity, eventTime, { is_mitigated: 0 }, 100)
      .filter(e => e.direction === 'ssl' || e.direction === 'eql' || e.direction === 'reql');
    let minSslDiff = Infinity;
    for (const s of activeSsls) {
      const p = s.levelPrice || (s.priceHigh + s.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minSslDiff) {
        minSslDiff = diff;
        nearestSslPrice = p;
        nearestSslEventId = s.id;
      }
    }
  }
  
  // Nearest Active FVG (timeframe-specific)
  let nearestFvgPrice = null;
  let nearestFvgEventId = null;
  if (preFilteredEvents.fvgsByTf && preFilteredEvents.fvgsByTf[eventTimeframe]) {
    const activeFvgs = getActiveEvents(preFilteredEvents.fvgsByTf[eventTimeframe], eventTime, 100);
    let minFvgDiff = Infinity;
    for (const f of activeFvgs) {
      const p = (f.priceHigh + f.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minFvgDiff) {
        minFvgDiff = diff;
        nearestFvgPrice = p;
        nearestFvgEventId = f.id;
      }
    }
  } else if (preFilteredEvents.fvgsAll) {
    const activeFvgs = findRecentEvents(preFilteredEvents.fvgsAll, eventTime, { timeframe: eventTimeframe, is_mitigated: 0 }, 100);
    let minFvgDiff = Infinity;
    for (const f of activeFvgs) {
      const p = (f.priceHigh + f.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minFvgDiff) {
        minFvgDiff = diff;
        nearestFvgPrice = p;
        nearestFvgEventId = f.id;
      }
    }
  }
  
  // Nearest active Liquidity Void (timeframe-specific)
  let nearestVoidPrice = null;
  let nearestVoidEventId = null;
  if (preFilteredEvents.voidsByTf && preFilteredEvents.voidsByTf[eventTimeframe]) {
    const activeVoids = getActiveEvents(preFilteredEvents.voidsByTf[eventTimeframe], eventTime, 100);
    let minVoidDiff = Infinity;
    for (const v of activeVoids) {
      const p = (v.priceHigh + v.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minVoidDiff) {
        minVoidDiff = diff;
        nearestVoidPrice = p;
        nearestVoidEventId = v.id;
      }
    }
  } else if (preFilteredEvents.voidsAll) {
    const activeVoids = findRecentEvents(preFilteredEvents.voidsAll, eventTime, { timeframe: eventTimeframe, is_mitigated: 0 }, 100);
    let minVoidDiff = Infinity;
    for (const v of activeVoids) {
      const p = (v.priceHigh + v.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minVoidDiff) {
        minVoidDiff = diff;
        nearestVoidPrice = p;
        nearestVoidEventId = v.id;
      }
    }
  }
  
  // Nearest active Volume Imbalance (timeframe-specific)
  let nearestVolumeImbalancePrice = null;
  let nearestVolumeImbalanceEventId = null;
  if (preFilteredEvents.viByTf && preFilteredEvents.viByTf[eventTimeframe]) {
    const activeVIs = getActiveEvents(preFilteredEvents.viByTf[eventTimeframe], eventTime, 100);
    let minVIDiff = Infinity;
    for (const vi of activeVIs) {
      const p = (vi.priceHigh + vi.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minVIDiff) {
        minVIDiff = diff;
        nearestVolumeImbalancePrice = p;
        nearestVolumeImbalanceEventId = vi.id;
      }
    }
  } else if (preFilteredEvents.viAll) {
    const activeVIs = findRecentEvents(preFilteredEvents.viAll, eventTime, { timeframe: eventTimeframe, is_mitigated: 0 }, 100);
    let minVIDiff = Infinity;
    for (const vi of activeVIs) {
      const p = (vi.priceHigh + vi.priceLow) / 2;
      const diff = Math.abs(p - currentPrice);
      if (diff < minVIDiff) {
        minVIDiff = diff;
        nearestVolumeImbalancePrice = p;
        nearestVolumeImbalanceEventId = vi.id;
      }
    }
  }

  return {
    event_id: event.id,
    symbol: event.symbol,
    timeframe: eventTimeframe,
    time_year: timeContext.year,
    time_quarter: timeContext.quarter,
    time_month: timeContext.month,
    time_weekday: timeContext.weekday,
    time_session: timeContext.session,
    time_hour: timeContext.hour,
    price_daily_range_pct: dailyRangePct,
    price_atr_14: atr14,
    price_volatility_regime: volatilityRegime,
    price_premium_discount_status: premiumDiscountStatus,
    price_dist_daily_high: distDailyHigh,
    price_dist_daily_low: distDailyLow,
    price_dist_weekly_high: distWeeklyHigh,
    price_dist_weekly_low: distWeeklyLow,
    structure_bias_1m: bias_1m,
    structure_bias_5m: bias_5m,
    structure_bias_15m: bias_15m,
    structure_bias_1h: bias_1h,
    structure_bias_4h: bias_4h,
    structure_bias_daily: bias_daily,
    htf_structure_event_id: htfStructureEventId,
    ltf_structure_event_id: ltfStructureEventId,
    nearest_htf_high: nearestHtfHigh,
    nearest_htf_low: nearestHtfLow,
    liq_closest_above: closestLiqAbove,
    liq_closest_below: closestLiqBelow,
    liq_dist_to_above: distToLiqAbove,
    liq_dist_to_below: distToLiqBelow,
    liq_eq_high_present: eqHighPresent,
    liq_eq_low_present: eqLowPresent,
    nearest_bsl_price: nearestBslPrice,
    nearest_bsl_event_id: nearestBslEventId,
    nearest_ssl_price: nearestSslPrice,
    nearest_ssl_event_id: nearestSslEventId,
    fvg_size: fvgSize,
    fvg_atr_ratio: fvgAtrRatio,
    fvg_age: fvgAge,
    fvg_untouched_nearby_count: untouchedNearbyCount,
    nearest_fvg_price: nearestFvgPrice,
    nearest_fvg_event_id: nearestFvgEventId,
    nearest_void_price: nearestVoidPrice,
    nearest_void_event_id: nearestVoidEventId,
    nearest_volume_imbalance_price: nearestVolumeImbalancePrice,
    nearest_volume_imbalance_event_id: nearestVolumeImbalanceEventId,
    flow_before_mss: flowBeforeMss,
    flow_after_mss: flowAfterMss,
    flow_before_bos: flowBeforeBos,
    flow_after_bos: flowAfterBos,
    flow_sweep_occurred: sweepOccurred,
    flow_no_sweep: noSweep,
    session_asia: sessionAsia,
    session_london: sessionLondon,
    session_ny: sessionNy,
    session_ny_am: sessionNyAm,
    session_ny_pm: sessionNyPm
  };
}

function precomputeRollingMaxMin(bars, windowSize) {
  const n = bars.length;
  const maxs = new Float64Array(n);
  const mins = new Float64Array(n);
  
  const maxDeque = [];
  const minDeque = [];
  
  for (let i = 0; i < n; i++) {
    if (maxDeque.length > 0 && maxDeque[0] <= i - windowSize) {
      maxDeque.shift();
    }
    if (minDeque.length > 0 && minDeque[0] <= i - windowSize) {
      minDeque.shift();
    }
    
    const valHigh = bars[i].high;
    while (maxDeque.length > 0 && bars[maxDeque[maxDeque.length - 1]].high <= valHigh) {
      maxDeque.pop();
    }
    maxDeque.push(i);
    
    const valLow = bars[i].low;
    while (minDeque.length > 0 && bars[minDeque[minDeque.length - 1]].low >= valLow) {
      minDeque.pop();
    }
    minDeque.push(i);
    
    maxs[i] = bars[maxDeque[0]].high;
    mins[i] = bars[minDeque[0]].low;
  }
  
  return { maxs, mins };
}

module.exports = {
  captureEventContext,
  getBarsUpTo,
  getRecentEventsUpTo,
  findRecentEvents,
  findIndexUpTo,
  precomputeRollingMaxMin,
  precomputeSMA,
  getActiveEvents
};
