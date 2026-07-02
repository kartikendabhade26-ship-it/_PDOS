/**
 * algo/engines/displacementEngine.js
 * Implements displacement candle checks based on FVG-middle-candle structural imbalance.
 */

const BaseEngine = require('./BaseEngine');

class DisplacementEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
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
    const properties = {
      body: event.properties?.body,
      ...event.properties
    };

    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: event.detectorId || 'DISPLACEMENT_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Structure Breaks',
      concept_type: 'Displacement',
      concept_state: 'active',
      time_start: event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify(properties)
    };
  }
}

module.exports = DisplacementEngine;
