/**
 * algo/engines/dealingRangeEngine.js
 * PDOS Dealing Range Engine v1 (Geometry Only)
 * Constructs deterministic dealing ranges strictly from completed price delivery legs.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const LiquidityEngine = require('./liquidityEngine');
const LiquidityInteractionEngine = require('./liquidityInteractionEngine');

class DealingRangeEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, symbol } = context;

    // Resolve swings
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    // Resolve liquidity pools
    const liquidityEngine = new LiquidityEngine();
    const liquidityPools = preComputedLiquidity || liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings: swings, symbol });

    // Resolve interactions
    const interactionEngine = new LiquidityInteractionEngine();
    const interactionEvents = preComputedInteractions || interactionEngine.detect(bars, {}, { preComputedSwings: swings, preComputedLiquidity: liquidityPools, symbol });

    if (bars.length === 0) return [];

    let timeframe = 1;
    if (bars.length >= 2) {
      const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
      if (diffMin > 0) timeframe = diffMin;
    }

    const ranges = [];

    // Filter confirmed sweeps only and sort chronologically
    const sweeps = interactionEvents
      .filter(e => e.properties?.interactionType === 'sweep')
      .sort((a, b) => a.barIndex - b.barIndex);

    for (let i = 0; i < sweeps.length; i++) {
      const originSweep = sweeps[i];
      const originDir = originSweep.direction; // 'bsl' or 'ssl'
      const originPrice = originSweep.properties?.levelPrice || originSweep.priceHigh;

      if (originDir === 'ssl') {
        // Bullish Dealing Range: SSL swept first, then look forward for the first subsequent BSL sweep
        const destSweep = sweeps.find(e => e.barIndex > originSweep.barIndex && e.direction === 'bsl');
        if (destSweep) {
          const destPrice = destSweep.properties?.levelPrice || destSweep.priceHigh;
          const rangeHigh = destPrice;
          const rangeLow = originPrice;
          const timeStart = originSweep.time;
          const timeEnd = destSweep.time;
          
          if (rangeHigh > rangeLow) {
            const level_100 = rangeHigh;
            const level_75 = rangeLow + 0.75 * (rangeHigh - rangeLow);
            const level_50 = rangeLow + 0.50 * (rangeHigh - rangeLow);
            const level_25 = rangeLow + 0.25 * (rangeHigh - rangeLow);
            const level_0 = rangeLow;

            ranges.push({
              id: `dealing_range_bullish_${timeStart}_tf${timeframe}`,
              type: 'dealing_range',
              direction: 'bullish',
              time: timeStart,
              timeStart: timeStart,
              timeEnd: timeEnd,
              priceHigh: rangeHigh,
              priceLow: rangeLow,
              barIndex: originSweep.barIndex,
              symbol: symbol || '',
              timeframe,
              state: 'completed',
              createdBy: originSweep.id,
              targets: destSweep.properties?.poolId,
              consumes: originSweep.properties?.poolId,
              properties: {
                range_id: `dealing_range_bullish_${timeStart}_tf${timeframe}`,
                symbol: symbol || '',
                timeframe,
                direction: 'bullish',
                start_time: timeStart,
                end_time: timeEnd,
                origin_liquidity: originSweep.properties?.poolId,
                destination_liquidity: destSweep.properties?.poolId,
                high: rangeHigh,
                low: rangeLow,
                level_100,
                level_75,
                level_50,
                level_25,
                level_0
              }
            });
          }
        }
      } else if (originDir === 'bsl') {
        // Bearish Dealing Range: BSL swept first, then look forward for the first subsequent SSL sweep
        const destSweep = sweeps.find(e => e.barIndex > originSweep.barIndex && e.direction === 'ssl');
        if (destSweep) {
          const destPrice = destSweep.properties?.levelPrice || destSweep.priceLow;
          const rangeHigh = originPrice;
          const rangeLow = destPrice;
          const timeStart = originSweep.time;
          const timeEnd = destSweep.time;

          if (rangeHigh > rangeLow) {
            const level_100 = rangeHigh;
            const level_75 = rangeLow + 0.75 * (rangeHigh - rangeLow);
            const level_50 = rangeLow + 0.50 * (rangeHigh - rangeLow);
            const level_25 = rangeLow + 0.25 * (rangeHigh - rangeLow);
            const level_0 = rangeLow;

            ranges.push({
              id: `dealing_range_bearish_${timeStart}_tf${timeframe}`,
              type: 'dealing_range',
              direction: 'bearish',
              time: timeStart,
              timeStart: timeStart,
              timeEnd: timeEnd,
              priceHigh: rangeHigh,
              priceLow: rangeLow,
              barIndex: originSweep.barIndex,
              symbol: symbol || '',
              timeframe,
              state: 'completed',
              createdBy: originSweep.id,
              targets: destSweep.properties?.poolId,
              consumes: originSweep.properties?.poolId,
              properties: {
                range_id: `dealing_range_bearish_${timeStart}_tf${timeframe}`,
                symbol: symbol || '',
                timeframe,
                direction: 'bearish',
                start_time: timeStart,
                end_time: timeEnd,
                origin_liquidity: originSweep.properties?.poolId,
                destination_liquidity: destSweep.properties?.poolId,
                high: rangeHigh,
                low: rangeLow,
                level_100,
                level_75,
                level_50,
                level_25,
                level_0
              }
            });
          }
        }
      }
    }

    return ranges;
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
      detector_id: event.detectorId || 'DEALING_RANGE_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Price Delivery',
      concept_type: 'Dealing Range',
      concept_state: event.state || 'active',
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify({
        createdBy: event.createdBy,
        targets: event.targets,
        consumes: event.consumes,
        ...event.properties
      })
    };
  }
}

module.exports = DealingRangeEngine;
