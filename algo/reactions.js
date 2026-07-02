/**
 * algo/reactions.js
 * PURE ALGORITHMIC price reaction analyzer.
 * No ML, no APIs, no paid services — 100% free JavaScript.
 *
 * For every detected zone (FVG, OB, Liquidity), it measures:
 *  - Did price touch the zone?
 *  - Did price reach the 50% midpoint?
 *  - Did price fully mitigate (close inside)?
 *  - What was the move size after touching? (in points)
 *  - How many bars until first touch?
 *  - Session / day / hour breakdown
 */

const { getESTOffset } = require('./utils/math/time');

function getESTHour(unixTs) {
  const d = new Date((unixTs + getESTOffset(unixTs)) * 1000);
  return d.getUTCHours();
}

function getESTDay(unixTs) {
  const d = new Date((unixTs + getESTOffset(unixTs)) * 1000);
  return d.getUTCDay(); // 0=Sun...6=Sat
}

function getSession(unixTs) {
  const h = getESTHour(unixTs);
  if (h >= 2  && h < 5)  return 1; // London
  if (h >= 7  && h < 12) return 2; // NY AM
  if (h >= 13 && h < 16) return 3; // NY PM
  return 0;                         // Asia / Off
}

function getNFPInfo(unixTs) {
  const tDate = new Date((unixTs + getESTOffset(unixTs)) * 1000);
  const tYear = tDate.getUTCFullYear();
  const tMonth = tDate.getUTCMonth();
  const tDay = tDate.getUTCDate();
  const tDow = tDate.getUTCDay();

  const getFirstFriday = (y, m) => {
    const firstDay = new Date(Date.UTC(y, m, 1, 12, 0, 0));
    const dow = firstDay.getUTCDay();
    const offset = (5 - dow + 7) % 7;
    return new Date(Date.UTC(y, m, 1 + offset, 12, 0, 0));
  };

  const nfpFriday = getFirstFriday(tYear, tMonth);
  const msPerDay = 24 * 3600 * 1000;
  const nfpFridayMs = nfpFriday.getTime();
  const nfpMonMs = nfpFridayMs - 4 * msPerDay;
  const tMs = Date.UTC(tYear, tMonth, tDay, 12, 0, 0);

  const isNFPDay = (tMs === nfpFridayMs);
  const isNFPWeek = (tMs >= nfpMonMs && tMs <= nfpFridayMs && tDow >= 1 && tDow <= 5);
  const isDayBeforeNFP = (tMs === nfpFridayMs - msPerDay);

  return { isNFPDay, isNFPWeek, isDayBeforeNFP };
}

/**
 * For a single zone, analyze what happened in the NEXT `lookaheadBars` bars.
 * @param {Object} zone       - { priceHigh, priceLow, time, barIndex, direction }
 * @param {Array}  allBars    - full sorted bar array
 * @param {number} lookahead  - how many bars to look forward (default 50)
 * @returns {Object} reaction metrics
 */
function analyzeReaction(zone, allBars, lookahead = 50) {
  const { priceHigh, priceLow, barIndex, direction } = zone;
  const mid  = (priceHigh + priceLow) / 2;
  const size = priceHigh - priceLow;

  const start = barIndex + 1;
  const end   = Math.min(allBars.length - 1, barIndex + lookahead);

  let touchedZone    = false;
  let touched50Pct   = false;
  let fullyMitigated = false;
  let barsToTouch    = null;
  let maxFavorable   = 0; // max move in expected direction after touch
  let maxAdverse     = 0; // max move against expected direction after touch
  let touchPrice     = null;
  let sweepReverse   = false;

  const entryBar = allBars[barIndex];
  const entryClose = entryBar ? entryBar.close : mid;

  for (let i = start; i <= end; i++) {
    const bar = allBars[i];
    if (!bar) continue;

    // Check zone touch (price enters the zone range)
    if (!touchedZone && bar.low <= priceHigh && bar.high >= priceLow) {
      touchedZone = true;
      barsToTouch = i - barIndex;
      touchPrice  = bar.close;
    }

    // Check 50% reach
    if (!touched50Pct) {
      if (direction === 'bullish' && bar.low <= mid) touched50Pct = true;
      if (direction === 'bearish' && bar.high >= mid) touched50Pct = true;
    }

    // Check full mitigation (price closes inside/through zone)
    if (!fullyMitigated) {
      if (direction === 'bullish' && bar.close < priceLow) fullyMitigated = true;
      if (direction === 'bearish' && bar.close > priceHigh) fullyMitigated = true;
    }

    // Measure favorable vs adverse move after touch
    if (touchedZone) {
      if (direction === 'bullish') {
        maxFavorable = Math.max(maxFavorable, bar.high - touchPrice);
        maxAdverse   = Math.max(maxAdverse,   touchPrice - bar.low);
      } else {
        maxFavorable = Math.max(maxFavorable, touchPrice - bar.low);
        maxAdverse   = Math.max(maxAdverse,   bar.high - touchPrice);
      }
    }

    // Sweep + reverse: price briefly goes through zone then comes back
    if (touchedZone && fullyMitigated) {
      // Check if it came back after going through
      const afterBars = allBars.slice(i + 1, Math.min(allBars.length, i + 10));
      if (direction === 'bullish') {
        const retrace = afterBars.some(b => b.close > priceHigh);
        if (retrace) sweepReverse = true;
      } else {
        const retrace = afterBars.some(b => b.close < priceLow);
        if (retrace) sweepReverse = true;
      }
      break; // Once mitigated, stop measuring
    }
  }

  // Outcome classification
  let outcome = 'no_touch';
  if (touchedZone && !touched50Pct && !fullyMitigated) outcome = 'bounce_edge';
  if (touched50Pct && !fullyMitigated) outcome = 'bounce_50pct';
  if (fullyMitigated && !sweepReverse) outcome = 'mitigated';
  if (fullyMitigated && sweepReverse)  outcome = 'sweep_reverse';

  // Calculate Context Info
  const nfp = getNFPInfo(zone.time);
  
  // Daily High / Low sweeps check (preceding 60 bars = 1 hour)
  const preceding = allBars.slice(Math.max(0, barIndex - 60), barIndex);
  const currentBar = allBars[barIndex];
  
  const pdh = currentBar ? (currentBar.dailyHigh || priceHigh) : priceHigh;
  const pdl = currentBar ? (currentBar.dailyLow || priceLow) : priceLow;
  const sweptPDH = preceding.some(b => b.high > pdh);
  const sweptPDL = preceding.some(b => b.low < pdl);

  // HOD / LOD check (closeness to daily extremes)
  const currHigh = currentBar ? (currentBar.currHigh || priceHigh) : priceHigh;
  const currLow  = currentBar ? (currentBar.currLow || priceLow) : priceLow;
  const isHOD = (currHigh - priceHigh) <= 8.0;
  const isLOD = (priceLow - currLow) <= 8.0;

  return {
    touchedZone,
    touched50Pct,
    fullyMitigated,
    sweepReverse,
    barsToTouch,
    maxFavorablePts: parseFloat(maxFavorable.toFixed(2)),
    maxAdversePts:   parseFloat(maxAdverse.toFixed(2)),
    rr: maxAdverse > 0 ? parseFloat((maxFavorable / maxAdverse).toFixed(2)) : null,
    outcome,
    // Context at zone formation time
    session:    getSession(zone.time),
    dayOfWeek:  getESTDay(zone.time),
    hour:       getESTHour(zone.time),
    zoneSize:   parseFloat(size.toFixed(2)),
    direction:  zone.direction,
    type:       zone.type,
    time:       zone.time,
    priceHigh:  zone.priceHigh,
    priceLow:   zone.priceLow,
    // News & Sweeps flags
    isNFPWeek: nfp.isNFPWeek,
    isNFPDay: nfp.isNFPDay,
    isDayBeforeNFP: nfp.isDayBeforeNFP,
    sweptPDH,
    sweptPDL,
    isHOD,
    isLOD
  };
}

/**
 * Scan ALL candidates from a detector and compute reactions for each.
 * @param {Array} candidates  - from detector.js getCandidates()
 * @param {Array} allBars     - full bar data
 * @param {number} lookahead  - bars to look forward per setup
 * @returns {Array} results   - array of reaction objects
 */
function scanAllReactions(candidates, allBars, lookahead = 50) {
  const results = [];
  for (const zone of candidates) {
    const reaction = analyzeReaction(zone, allBars, lookahead);
    results.push(reaction);
  }
  return results;
}

/**
 * Aggregate reaction results into statistics.
 * @param {Array} results - from scanAllReactions()
 * @returns {Object} stats
 */
function aggregateStats(results) {
  if (results.length === 0) return null;

  const touched    = results.filter(r => r.touchedZone);
  const hit50      = results.filter(r => r.touched50Pct);
  const mitigated  = results.filter(r => r.fullyMitigated);

  const SESSION_NAMES = ['Asia', 'London', 'NY AM', 'NY PM'];
  const DAY_NAMES     = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // By session
  const bySession = SESSION_NAMES.map((name, idx) => {
    const sess = results.filter(r => r.session === idx);
    const t    = sess.filter(r => r.touchedZone);
    return {
      session: name,
      total:   sess.length,
      touched: t.length,
      touchRate: sess.length > 0 ? (t.length / sess.length * 100).toFixed(1) : 0,
      hit50:   sess.filter(r => r.touched50Pct).length,
      hit50Rate: sess.length > 0 ? (sess.filter(r => r.touched50Pct).length / sess.length * 100).toFixed(1) : 0,
      avgMove: t.length > 0 ? (t.reduce((s, r) => s + r.maxFavorablePts, 0) / t.length).toFixed(1) : 0,
    };
  });

  // By day of week
  const byDay = DAY_NAMES.map((name, idx) => {
    const day  = results.filter(r => r.dayOfWeek === idx);
    const t    = day.filter(r => r.touchedZone);
    return {
      day: name,
      total:   day.length,
      touched: t.length,
      touchRate: day.length > 0 ? (t.length / day.length * 100).toFixed(1) : 0,
      hit50Rate: day.length > 0 ? (day.filter(r => r.touched50Pct).length / day.length * 100).toFixed(1) : 0,
    };
  });

  // By hour (EST)
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const hr   = results.filter(r => r.hour === h);
    const t    = hr.filter(r => r.touchedZone);
    return {
      hour: h,
      total:    hr.length,
      touched:  t.length,
      touchRate: hr.length > 0 ? (t.length / hr.length * 100).toFixed(1) : 0,
    };
  }).filter(h => h.total > 0);

  // Outcome breakdown
  const outcomes = {};
  for (const r of results) {
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  }

  // Average move after touch
  const avgFavorable = touched.length > 0
    ? (touched.reduce((s, r) => s + r.maxFavorablePts, 0) / touched.length).toFixed(1)
    : 0;

  const avgBarsToTouch = touched.filter(r => r.barsToTouch).length > 0
    ? Math.round(touched.filter(r => r.barsToTouch).reduce((s, r) => s + r.barsToTouch, 0) /
      touched.filter(r => r.barsToTouch).length)
    : null;

  return {
    total:           results.length,
    touchCount:      touched.length,
    touchRate:       (touched.length / results.length * 100).toFixed(1),
    hit50Count:      hit50.length,
    hit50Rate:       (hit50.length / results.length * 100).toFixed(1),
    mitigatedCount:  mitigated.length,
    mitigatedRate:   (mitigated.length / results.length * 100).toFixed(1),
    avgFavorablePts: avgFavorable,
    avgBarsToTouch,
    outcomes,
    bySession,
    byDay,
    byHour,
  };
}

module.exports = { analyzeReaction, scanAllReactions, aggregateStats };
