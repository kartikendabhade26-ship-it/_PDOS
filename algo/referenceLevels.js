/**
 * algo/referenceLevels.js
 * Detects objective reference levels: Opens (DO, WO, MO, Session Opens)
 * and previous extremes (PDH/PDL, PWH/PWL, PMH/PML)
 */

const { makeEvent } = require('./eventSchema');
const { getESTOffset } = require('./utils/math/time');

const REF_SUNDAY_MS = new Date('1970-01-04T00:00:00Z').getTime();

function getESTDateTime(unixTs) {
  const offset = getESTOffset(unixTs);
  const d = new Date((unixTs + offset) * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  const msSinceEpoch = d.getTime();
  const weekNo = Math.floor((msSinceEpoch - REF_SUNDAY_MS) / 604800000);
  
  return { hour, minute, dateStr, year, month, day, weekNo, offset };
}

function detectReferenceLevels(bars) {
  const candidates = [];
  if (!bars || bars.length === 0) return candidates;

  let currentDay = null;
  let currentWeek = null;
  let currentMonth = null;

  // Trackers for current period highs/lows
  let prevDayHigh = -Infinity, prevDayLow = Infinity, prevDayStartTime = null;
  let prevWeekHigh = -Infinity, prevWeekLow = Infinity, prevWeekStartTime = null;
  let prevMonthHigh = -Infinity, prevMonthLow = Infinity, prevMonthStartTime = null;

  // Temporary accumulators during tracking
  let tempDayHigh = -Infinity, tempDayLow = Infinity;
  let tempWeekHigh = -Infinity, tempWeekLow = Infinity;
  let tempMonthHigh = -Infinity, tempMonthLow = Infinity;

  // Session flags reset per day
  let inAsia = false;
  let inLondon = false;
  let inNY = false;

  let lastDayKey = -1;
  let cachedEst = null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    
    // Mathematically check day key in EST to avoid garbage collection pressure
    const offset = getESTOffset(bar.time);
    const dayKey = Math.floor((bar.time + offset) / 86400);
    if (dayKey !== lastDayKey) {
      cachedEst = getESTDateTime(bar.time);
      lastDayKey = dayKey;
    }
    
    const estSecs = bar.time + cachedEst.offset;
    const hour = Math.floor((estSecs % 86400) / 3600);
    const minute = Math.floor((estSecs % 3600) / 60);
    const dateStr = cachedEst.dateStr;
    const year = cachedEst.year;
    const month = cachedEst.month;
    const day = cachedEst.day;
    const weekNo = cachedEst.weekNo;
    
    const decimalHour = hour + minute / 60;

    // --- DAY TRANSITION ---
    if (dateStr !== currentDay) {
      // If we finished a day, record PDH/PDL
      if (currentDay !== null && tempDayHigh !== -Infinity) {
        prevDayHigh = tempDayHigh;
        prevDayLow = tempDayLow;
        
        candidates.push({
          type: 'reference_level',
          direction: 'pdh_pdl',
          time: bar.time,
          timeStart: prevDayStartTime,
          timeEnd: bar.time,
          priceHigh: prevDayHigh,
          priceLow: prevDayLow,
          barIndex: i,
          properties: { prevDayHigh, prevDayLow, dateStr: currentDay }
        });
      }

      currentDay = dateStr;
      prevDayStartTime = bar.time;
      tempDayHigh = bar.high;
      tempDayLow = bar.low;

      // Record DO (Daily Open)
      candidates.push({
        type: 'reference_level',
        direction: 'do',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, dateStr: currentDay }
      });

      // Reset session flags for the new day
      inAsia = false;
      inLondon = false;
      inNY = false;
    } else {
      // Accumulate daily highs/lows
      if (bar.high > tempDayHigh) tempDayHigh = bar.high;
      if (bar.low < tempDayLow) tempDayLow = bar.low;
    }

    // --- WEEK TRANSITION ---
    if (weekNo !== currentWeek) {
      if (currentWeek !== null && tempWeekHigh !== -Infinity) {
        prevWeekHigh = tempWeekHigh;
        prevWeekLow = tempWeekLow;

        candidates.push({
          type: 'reference_level',
          direction: 'pwh_pwl',
          time: bar.time,
          timeStart: prevWeekStartTime,
          timeEnd: bar.time,
          priceHigh: prevWeekHigh,
          priceLow: prevWeekLow,
          barIndex: i,
          properties: { prevWeekHigh, prevWeekLow, weekNo: currentWeek }
        });
      }

      currentWeek = weekNo;
      prevWeekStartTime = bar.time;
      tempWeekHigh = bar.high;
      tempWeekLow = bar.low;

      // Record WO (Weekly Open)
      candidates.push({
        type: 'reference_level',
        direction: 'wo',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, weekNo: currentWeek }
      });
    } else {
      if (bar.high > tempWeekHigh) tempWeekHigh = bar.high;
      if (bar.low < tempWeekLow) tempWeekLow = bar.low;
    }

    // --- MONTH TRANSITION ---
    if (month !== currentMonth) {
      if (currentMonth !== null && tempMonthHigh !== -Infinity) {
        prevMonthHigh = tempMonthHigh;
        prevMonthLow = tempMonthLow;

        candidates.push({
          type: 'reference_level',
          direction: 'pmh_pml',
          time: bar.time,
          timeStart: prevMonthStartTime,
          timeEnd: bar.time,
          priceHigh: prevMonthHigh,
          priceLow: prevMonthLow,
          barIndex: i,
          properties: { prevMonthHigh, prevMonthLow, month: currentMonth }
        });
      }

      currentMonth = month;
      prevMonthStartTime = bar.time;
      tempMonthHigh = bar.high;
      tempMonthLow = bar.low;

      // Record MO (Monthly Open)
      candidates.push({
        type: 'reference_level',
        direction: 'mo',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, month: currentMonth }
      });
    } else {
      if (bar.high > tempMonthHigh) tempMonthHigh = bar.high;
      if (bar.low < tempMonthLow) tempMonthLow = bar.low;
    }

    // --- SESSION OPENS ---
    // Asia Open (starts at 18:00 EST)
    if (decimalHour >= 18.0 && !inAsia) {
      inAsia = true;
      candidates.push({
        type: 'reference_level',
        direction: 'asia_open',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, sessionName: 'asia', dateStr: dateStr }
      });
    }

    // London Open (starts at 02:00 EST)
    if (decimalHour >= 2.0 && decimalHour < 5.0 && !inLondon) {
      inLondon = true;
      candidates.push({
        type: 'reference_level',
        direction: 'london_open',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, sessionName: 'london', dateStr: dateStr }
      });
    }

    // NY Open (starts at 07:30 EST)
    if (decimalHour >= 7.5 && decimalHour < 12.0 && !inNY) {
      inNY = true;
      candidates.push({
        type: 'reference_level',
        direction: 'ny_open',
        time: bar.time,
        timeStart: bar.time,
        timeEnd: bar.time,
        priceHigh: bar.open,
        priceLow: bar.open,
        barIndex: i,
        properties: { openPrice: bar.open, sessionName: 'ny', dateStr: dateStr }
      });
    }
  }

  return candidates;
}

module.exports = {
  detectReferenceLevels
};
