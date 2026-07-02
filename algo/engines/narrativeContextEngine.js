/**
 * algo/engines/narrativeContextEngine.js
 * Compiles and manages the active Narrative Context for the chart.
 * Decouples rendering filters by acting as the single source of truth for delivery state.
 */

const BaseEngine = require('./BaseEngine');
const { makeEvent } = require('../eventSchema');

class NarrativeContextEngine extends BaseEngine {
  /**
   * Compiles narrative context by linking Dealing Ranges to nested PD Arrays.
   * Can be called dynamically or within the sync pipeline.
   */
  compileContext(symbol, timeframe, ranges, pdArrays) {
    if (ranges.length === 0) return null;

    // 1. Find active/developing range, fallback to most recent completed range
    const activeRange = ranges.find(r => r.state === 'developing') || ranges[0];
    if (!activeRange) return null;

    const rHigh = activeRange.priceHigh;
    const rLow = activeRange.priceLow;
    const rStart = activeRange.timeStart;
    const rEnd = activeRange.timeEnd || Infinity;

    // 2. Find nested ranges (dynamic spatial nesting check)
    const nestedRanges = ranges.filter(r => 
      r.id !== activeRange.id &&
      r.priceLow >= rLow && 
      r.priceHigh <= rHigh && 
      r.timeStart >= rStart && 
      (r.timeEnd || r.timeStart) <= rEnd
    ).map(r => r.id);

    // 3. Find active PD Arrays nested inside this Dealing Range coordinates
    const activePdArrays = pdArrays.filter(arr => 
      arr.priceLow >= rLow &&
      arr.priceHigh <= rHigh &&
      arr.time >= rStart &&
      arr.time <= rEnd &&
      (arr.state === 'active' || arr.state === 'inverted' || arr.state === 'breaker' || arr.state === 'mitigation')
    ).map(arr => arr.id);

    const properties = {
      activeRangeId: activeRange.id,
      activeRangeHigh: rHigh,
      activeRangeLow: rLow,
      equilibrium: activeRange.properties?.equilibrium || ((rHigh + rLow) / 2),
      deliveryState: activeRange.properties?.deliveryState || {},
      nestedRanges,
      activePdArrays
    };

    return makeEvent({
      id: `narrative_context_${symbol}_tf${timeframe}`,
      type: 'narrative_context',
      direction: activeRange.direction,
      time: activeRange.time,
      timeStart: rStart,
      timeEnd: activeRange.timeEnd,
      priceHigh: rHigh,
      priceLow: rLow,
      barIndex: activeRange.barIndex,
      state: activeRange.state,
      properties
    });
  }

  detect(bars, options = {}, context = {}) {
    // Compiled inside the pipeline, returns empty for raw candidate detection
    return [];
  }

  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  validate(event) {
    return { isValid: true, reason: "" };
  }

  serialize(event) {
    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: 'NARRATIVE_CONTEXT_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Price Delivery',
      concept_type: 'Narrative Context',
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

module.exports = NarrativeContextEngine;
