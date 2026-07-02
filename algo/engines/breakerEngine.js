/**
 * algo/engines/breakerEngine.js
 * Implements the Breaker Block Engine.
 * Detects when Order Blocks are violated/broken and transition to Breaker Blocks.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const { makeEvent } = require('../eventSchema');
const { detectOrderBlockCandidates } = require('../primitives');

class BreakerEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings } = context;

    // Resolve swings
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    // Call primitives to get raw OB candidates within the search options
    const obCandidates = detectOrderBlockCandidates(bars, swings, options);

    const breakers = [];

    for (const ob of obCandidates) {
      const isBullishOB = ob.direction === 'bullish';
      const obLow = ob.priceLow;
      const obHigh = ob.priceHigh;
      const startIdx = ob.barIndex;

      // Scan forward to see if the OB was violated
      for (let j = startIdx + 1; j < bars.length; j++) {
        const bar = bars[j];

        if (isBullishOB) {
          // Bullish OB broken by body close below its low -> Bearish Breaker
          if (bar.close < obLow) {
            breakers.push(makeEvent({
              id: `breaker_bearish_${bar.time}_idx${j}`,
              type: 'breaker',
              direction: 'bearish',
              time: bar.time,
              timeStart: ob.time,
              timeEnd: bar.time,
              priceHigh: obHigh,
              priceLow: obLow,
              barIndex: j,
              symbol: ob.symbol || '',
              timeframe: ob.timeframe || 1,
              state: 'active',
              createdBy: ob.id,
              validatedBy: `close_below_${bar.time}`,
              consumes: ob.id,
              lifecycleState: 'active',
              narrativeRole: 'contextual_evidence',
              properties: {
                originalObId: ob.id,
                breakBarIdx: j,
                breakPrice: bar.close
              }
            }));
            break; // An OB can only break once
          }
        } else {
          // Bearish OB broken by body close above its high -> Bullish Breaker
          if (bar.close > obHigh) {
            breakers.push(makeEvent({
              id: `breaker_bullish_${bar.time}_idx${j}`,
              type: 'breaker',
              direction: 'bullish',
              time: bar.time,
              timeStart: ob.time,
              timeEnd: bar.time,
              priceHigh: obHigh,
              priceLow: obLow,
              barIndex: j,
              symbol: ob.symbol || '',
              timeframe: ob.timeframe || 1,
              state: 'active',
              createdBy: ob.id,
              validatedBy: `close_above_${bar.time}`,
              consumes: ob.id,
              lifecycleState: 'active',
              narrativeRole: 'contextual_evidence',
              properties: {
                originalObId: ob.id,
                breakBarIdx: j,
                breakPrice: bar.close
              }
            }));
            break; // An OB can only break once
          }
        }
      }
    }

    return breakers;
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
      detector_id: 'BREAKER_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Order Flow',
      concept_type: 'Breaker',
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

module.exports = BreakerEngine;
