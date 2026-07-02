/**
 * algo/engines/swingHierarchyEngine.js
 *
 * Pure ICT Fractal Hierarchy Engine
 * ─────────────────────────────────
 * Consumes degree=1 swings (STH/STL) and promotes them recursively:
 *
 *   STH (degree=1)  → ITH (degree=2)  → LTH (degree=3)
 *   STL (degree=1)  → ITL (degree=2)  → LTL (degree=3)
 *
 * Promotion rule (same as Pine Script ta.pivothigh applied to swing prices):
 *
 *   For HIGHS: window[1].price > window[0].price  AND  window[1].price > window[2].price
 *   For LOWS:  window[1].price < window[0].price  AND  window[1].price < window[2].price
 *
 * Output: array of promoted swing events with degree=2 or degree=3 stored
 * in properties.degree.  The promoted event also records parent_swing_ids
 * (the three degree-1 or degree-2 source swings).
 *
 * Architecture rules obeyed:
 *   - NO ATR                  (renderer only)
 *   - NO rendering             (renderer only)
 *   - NO fixed bar lengths     (renderer decides)
 *   - NO liquidity logic       (LiquidityEngine only)
 *   - NO BOS / MSS logic       (StructureEngine only)
 */

class SwingHierarchyEngine {
  /**
   * @param {object[]} degree1Swings - Sorted array of degree=1 swing events (barIndex ascending).
   *   Each swing must have: { id, type:'swing_high'|'swing_low', price, time, barIndex, timeframe, symbol, direction, priceHigh, priceLow }
   * @param {number} maxDegree - How many promotion levels to compute (default 3 = STH→ITH→LTH)
   * @returns {object[]} promoted - Newly created degree=2 and degree=3 swing events
   */
  promote(degree1Swings, maxDegree = 3) {
    if (!degree1Swings || degree1Swings.length < 3) return [];

    // Separate highs and lows
    const highs = degree1Swings
      .filter(s => s.type === 'swing_high')
      .sort((a, b) => a.barIndex - b.barIndex);

    const lows = degree1Swings
      .filter(s => s.type === 'swing_low')
      .sort((a, b) => a.barIndex - b.barIndex);

    const allPromoted = [];

    // Run promotion passes: degree 1→2, then 2→3
    let currentHighs = highs;
    let currentLows  = lows;

    for (let targetDegree = 2; targetDegree <= maxDegree; targetDegree++) {
      const promotedHighs = this._promoteOneSide(currentHighs, 'swing_high', targetDegree);
      const promotedLows  = this._promoteOneSide(currentLows,  'swing_low',  targetDegree);

      allPromoted.push(...promotedHighs, ...promotedLows);

      // Feed promoted events into the next pass
      currentHighs = promotedHighs;
      currentLows  = promotedLows;

      // Stop early if no events were promoted (nothing left to promote)
      if (promotedHighs.length === 0 && promotedLows.length === 0) break;
    }

    return allPromoted;
  }

  /**
   * Walk a sorted list of swings looking for 3-bar pivot patterns in their PRICES.
   * Middle pivot qualifies if its price is the extreme of the 3.
   *
   * @param {object[]} swings - Sorted degree-N swings (barIndex ascending)
   * @param {'swing_high'|'swing_low'} type
   * @param {number} targetDegree - Degree label to assign to promoted events
   * @returns {object[]} promoted events
   */
  _promoteOneSide(swings, type, targetDegree) {
    const promoted = [];
    const isHigh = type === 'swing_high';

    // Need at least 3 pivots to find a middle promotion
    for (let i = 1; i < swings.length - 1; i++) {
      const prev   = swings[i - 1];
      const middle = swings[i];
      const next   = swings[i + 1];

      const prevPrice   = prev.price;
      const middlePrice = middle.price;
      const nextPrice   = next.price;

      const qualifies = isHigh
        ? (middlePrice > prevPrice && middlePrice > nextPrice)
        : (middlePrice < prevPrice && middlePrice < nextPrice);

      if (qualifies) {
        const id = `swing_${isHigh ? 'high' : 'low'}_d${targetDegree}_${middle.time}`;
        promoted.push({
          id,
          type,                          // keep same type (swing_high / swing_low)
          concept: 'swing',
          direction: middle.direction,    // bearish for highs, bullish for lows
          time: middle.time,
          timestamp: middle.time,
          price: middlePrice,
          priceHigh: middle.priceHigh,
          priceLow:  middle.priceLow,
          barIndex: middle.barIndex,
          confirmationBar: middle.confirmationBar || (middle.barIndex + 1),
          timeframe: middle.timeframe,
          symbol: middle.symbol,
          // Hierarchy metadata (stored in properties column)
          properties: {
            degree: targetDegree,
            parent_swing_ids: [prev.id, middle.id, next.id],
            source_price_prev:   prevPrice,
            source_price_middle: middlePrice,
            source_price_next:   nextPrice
          }
        });
      }
    }

    return promoted;
  }
}

module.exports = SwingHierarchyEngine;
