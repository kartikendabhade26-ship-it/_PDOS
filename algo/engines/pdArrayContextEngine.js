/**
 * algo/engines/pdArrayContextEngine.js
 * Implements the PD Array Context Engine.
 * Sits between Dealing Range and individual array detectors.
 * Coordinates constrained detection of OBs, FVGs, and Breakers.
 */

const BaseEngine = require('./BaseEngine');
const { makeEvent } = require('../eventSchema');

class PDArrayContextEngine extends BaseEngine {
  /**
   * Evaluates active Dealing Range and constructs search parameters for downstream detectors.
   * @param {Object} activeRange - Active Dealing Range event
   * @param {Array} bars - Raw price bars
   * @returns {Object|null} Context search request containing bounds and eligibility
   */
  determineSearchRequest(activeRange, bars) {
    if (!activeRange) return null;
    if (bars.length === 0) return null;

    const lastBar = bars[bars.length - 1];
    const currentPrice = lastBar.close;
    const direction = activeRange.direction; // 'bullish' | 'bearish'
    const isBullish = direction === 'bullish';

    const rHigh = activeRange.priceHigh;
    const rLow = activeRange.priceLow;
    const equilibrium = activeRange.properties?.equilibrium || ((rHigh + rLow) / 2);

    let activeQuadrant = 'equilibrium';
    let narrativeState = 'undetermined';
    let priceMin = rLow;
    let priceMax = rHigh;
    let eligibleDirection = 'both';

    if (isBullish) {
      if (currentPrice <= equilibrium) {
        activeQuadrant = 'discount';
        narrativeState = 'discount_retracement';
        // Focus search strictly inside the Discount quadrant for buy setups
        priceMin = rLow;
        priceMax = equilibrium;
        eligibleDirection = 'bullish';
      } else {
        activeQuadrant = 'premium';
        narrativeState = 'premium_expansion';
        // Focus search inside Premium quadrant for targets/resistances
        priceMin = equilibrium;
        priceMax = rHigh;
        eligibleDirection = 'bullish'; // still looking for bullish continuations or bearish mitigations
      }
    } else {
      if (currentPrice >= equilibrium) {
        activeQuadrant = 'premium';
        narrativeState = 'premium_retracement';
        // Focus search strictly inside the Premium quadrant for sell setups
        priceMin = equilibrium;
        priceMax = rHigh;
        eligibleDirection = 'bearish';
      } else {
        activeQuadrant = 'discount';
        narrativeState = 'discount_expansion';
        // Focus search inside Discount quadrant for targets/supports
        priceMin = rLow;
        priceMax = equilibrium;
        eligibleDirection = 'bearish';
      }
    }

    return {
      activeRangeId: activeRange.id,
      direction,
      startBarIdx: activeRange.barIndex,
      endBarIdx: bars.length - 1,
      priceMin,
      priceMax,
      eligibleDirection,
      equilibrium,
      activeQuadrant,
      narrativeState,
      currentPrice
    };
  }

  /**
   * Ranks detected candidate arrays and filters them by significance and proximity.
   * @param {Array<Object>} candidates - List of candidate array events
   * @param {Object} searchReq - Context parameters returned by determineSearchRequest
   * @returns {Array<Object>} Sorted and ranked events with updated opacities
   */
  rankAndFilterArrays(candidates, searchReq) {
    if (!searchReq) return [];

    const { priceMin, priceMax, equilibrium, direction } = searchReq;
    const isBullishRange = direction === 'bullish';

    return candidates.map(arr => {
      // 1. Calculate proximity score:
      // In bullish range (discount search), arrays closer to the extreme low are higher quality
      // In bearish range (premium search), arrays closer to the extreme high are higher quality
      const arrMid = (arr.priceHigh + arr.priceLow) / 2;
      let proximity = 0.0;

      if (isBullishRange) {
        // Distance from equilibrium to the array mid price, scaled
        const totalDistance = equilibrium - priceMin || 1.0;
        proximity = Math.max(0, Math.min(1.0, (equilibrium - arrMid) / totalDistance));
      } else {
        // Distance from equilibrium to the array mid price, scaled
        const totalDistance = priceMax - equilibrium || 1.0;
        proximity = Math.max(0, Math.min(1.0, (arrMid - equilibrium) / totalDistance));
      }

      // 2. Age decay: older arrays are slightly deprioritized
      const barDistance = searchReq.endBarIdx - arr.barIndex;
      const ageFactor = Math.max(0.2, 1.0 - (barDistance / 1000));

      // 3. Size factor
      const rangeSize = priceMax - priceMin || 1.0;
      const arrSize = arr.priceHigh - arr.priceLow;
      const sizeFactor = Math.min(1.0, arrSize / (rangeSize * 0.2) || 0.1);

      // Composite quality score
      const qualityScore = Math.round((proximity * 0.5 + ageFactor * 0.3 + sizeFactor * 0.2) * 100);

      // Opacity based on quality
      const opacity = parseFloat((0.4 + (qualityScore / 100) * 0.55).toFixed(2));

      return {
        ...arr,
        state: arr.state || 'active',
        renderability: {
          visibleInMode: 'narrative',
          opacity
        },
        properties: {
          ...arr.properties,
          qualityScore,
          proximity,
          ageFactor
        }
      };
    }).sort((a, b) => b.properties.qualityScore - a.properties.qualityScore);
  }

  detect(bars, options = {}, context = {}) {
    // Return empty for raw candidates since it coordinates dynamically
    return [];
  }

  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  validate(event) {
    if (!event.time || event.priceHigh === undefined || event.priceLow === undefined) {
      return { isValid: false, reason: "Missing coordinates" };
    }
    return { isValid: true, reason: "" };
  }

  serialize(event) {
    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: 'PD_ARRAY_CONTEXT_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Price Delivery',
      concept_type: 'PD Array Matrix',
      concept_state: event.state || 'active',
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify(event.properties || {})
    };
  }
}

module.exports = PDArrayContextEngine;
