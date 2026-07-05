/**
 * algo/engines/swingEngine.js
 * Implements pure ICT 3-bar fractal swing high/low points.
 * Acts as a thin wrapper around findSwings in primitives.js.
 */

const BaseEngine = require('./BaseEngine');
const SwingService = require('./swingService');

class SwingEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, symbol } = context;
    const timeframe = this.timeframe || 1;

    if (global.profiler) {
      global.profiler.incrementCounter('barsProcessed', bars.length);
    }

    if (global.profiler) global.profiler.startEnginePhase('SwingEngineWrapper', timeframe, 'detect');
    const { rawSwings, allSwings } = preComputedSwings || this.findSwings(bars, timeframe, symbol);
    const result = rawSwings || allSwings;
    if (global.profiler) global.profiler.endEnginePhase('SwingEngineWrapper', timeframe, 'detect');

    if (global.profiler) {
      global.profiler.incrementCounter('eventsProduced', result.length);
    }
    return result;
  }

  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  validate(event) {
    if (!event.time || event.priceHigh === undefined || event.priceLow === undefined) {
      return { isValid: false, reason: "Missing coordinate variables" };
    }
    return { isValid: true, reason: "" };
  }

  serialize(event) {
    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: event.detectorId || 'SWING_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Swings',
      concept_type: 'Swing',
      concept_state: 'active',
      time_start: event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify({
        type: event.type,
        barIndex: event.barIndex,
        timestamp: event.timestamp,
        price: event.price,
        confirmationBar: event.confirmationBar,
        isStructural: event.isStructural !== false,
        renderHint: event.renderHint || (event.isStructural !== false ? 'normal' : 'hidden')
      })
    };
  }

  findSwings(bars, timeframe = 1, symbol = 'NQ_Historical_Data') {
    if (global.profiler) global.profiler.startEnginePhase('SwingEngineWrapper', timeframe, 'findSwings');
    // Fast path — degree-1 only. Hierarchy is built by the pipeline, not here.
    const service = new SwingService(timeframe, symbol);
    const swings = service.detect(bars, { degreeLimit: 1 });
    const swingHighs = swings.filter(s => s.type === 'swing_high' && s.isStructural);
    const swingLows  = swings.filter(s => s.type === 'swing_low' && s.isStructural);
    const structuralSwings = swings.filter(s => s.isStructural);
    const result = { swingHighs, swingLows, allSwings: structuralSwings, rawSwings: swings };
    if (global.profiler) global.profiler.endEnginePhase('SwingEngineWrapper', timeframe, 'findSwings');
    return result;
  }
}

module.exports = SwingEngine;
