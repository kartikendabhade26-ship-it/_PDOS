/**
 * algo/engines/liquidityInteractionEngine.js
 * Decoupled Liquidity Interaction Engine.
 * Traces candles against static Liquidity Pools to emit Touch, Test, Sweep, Take, Reclaim, Consume, and Archive events.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const LiquidityEngine = require('./liquidityEngine');

class LiquidityInteractionEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, symbol } = context;
    const timeframe = this.timeframe || 1;

    if (global.profiler) {
      global.profiler.incrementCounter('barsProcessed', bars.length);
    }

    if (global.profiler) global.profiler.startEnginePhase('LiquidityInteractionEngine', timeframe, 'dependencyResolution');
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    const liquidityEngine = new LiquidityEngine();
    const pools = preComputedLiquidity || liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings: swings, symbol });
    if (global.profiler) global.profiler.endEnginePhase('LiquidityInteractionEngine', timeframe, 'dependencyResolution');

    if (bars.length === 0) return [];

    if (global.profiler) global.profiler.startEnginePhase('LiquidityInteractionEngine', timeframe, 'interactionTracking');
    const interactions = [];

    for (const p of pools) {
      const lastSwingIdx = p.swings[p.swings.length - 1].barIndex;
      let state = 'active';
      const tolerance = (p.priceHigh - p.priceLow) / 2.0;
      let lastTouchIdx = -10;

      // Print debug for the first 3 pools
      const debugPool = pools.indexOf(p) < 3;
      if (debugPool) {
        console.log(`[InteractionEngine Debug] Pool: ${p.id}, directionType: ${p.directionType}, levelPrice: ${p.levelPrice}, lastSwingIdx: ${lastSwingIdx}, bars: ${bars.length}`);
      }

      for (let j = lastSwingIdx + 1; j < bars.length; j++) {
        const bar = bars[j];
        let eventType = null;
        let eventDirection = p.direction;

        if (state === 'active' || state === 'swept' || state === 'reclaimed') {
          if (p.directionType === 'bsl') {
            if (bar.high > p.levelPrice) {
              if (bar.close <= p.levelPrice) {
                state = 'swept';
                eventType = 'sweep';
              } else {
                state = 'taken';
                eventType = 'take';
              }
            } else if (bar.high >= p.levelPrice - tolerance && bar.high <= p.levelPrice) {
              if (j - lastTouchIdx > 1) {
                eventType = 'touch';
                lastTouchIdx = j;
              }
            }
          } else {
            // ssl
            if (bar.low < p.levelPrice) {
              if (bar.close >= p.levelPrice) {
                state = 'swept';
                eventType = 'sweep';
              } else {
                state = 'taken';
                eventType = 'take';
              }
            } else if (bar.low <= p.levelPrice + tolerance && bar.low >= p.levelPrice) {
              if (j - lastTouchIdx > 1) {
                eventType = 'touch';
                lastTouchIdx = j;
              }
            }
          }
        } else if (state === 'taken') {
          if (p.directionType === 'bsl') {
            if (bar.close <= p.levelPrice) {
              state = 'reclaimed';
              eventType = 'reclaim';
            } else if (bar.low > p.levelPrice) {
              state = 'consumed';
              eventType = 'consume';
            }
          } else {
            // ssl
            if (bar.close >= p.levelPrice) {
              state = 'reclaimed';
              eventType = 'reclaim';
            } else if (bar.high < p.levelPrice) {
              state = 'consumed';
              eventType = 'consume';
            }
          }
        }

        if (eventType) {
          if (debugPool) {
            console.log(`  -> Detected eventType: ${eventType} at barIndex: ${j}, state now: ${state}`);
          }
          interactions.push({
            id: `interaction_${eventType}_${p.directionType}_${bar.time}`,
            type: 'liquidity_interaction',
            direction: eventDirection,
            time: bar.time,
            timeStart: bar.time,
            timeEnd: bar.time,
            priceHigh: bar.high,
            priceLow: bar.low,
            barIndex: j,
            properties: {
              poolId: p.id,
              interactionType: eventType,
              levelPrice: p.levelPrice,
              barIndex: j,
              stateBefore: state
            }
          });

          if (state === 'consumed') {
            if (debugPool) {
              console.log(`  -> Pool consumed and archived.`);
            }
            // Emit final archive event
            interactions.push({
              id: `interaction_archive_${p.directionType}_${bar.time}`,
              type: 'liquidity_interaction',
              direction: eventDirection,
              time: bar.time,
              timeStart: bar.time,
              timeEnd: bar.time,
              priceHigh: bar.high,
              priceLow: bar.low,
              barIndex: j,
              properties: {
                poolId: p.id,
                interactionType: 'archive',
                levelPrice: p.levelPrice,
                barIndex: j,
                stateBefore: 'consumed'
              }
            });
            break; // Retires this pool from further checking
          }
        }
      }
    }

    const sorted = interactions.sort((a, b) => a.barIndex - b.barIndex);
    if (global.profiler) global.profiler.endEnginePhase('LiquidityInteractionEngine', timeframe, 'interactionTracking');

    if (global.profiler) {
      global.profiler.incrementCounter('eventsProduced', sorted.length);
    }
    return sorted;
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
      detector_id: event.detectorId || 'LIQUIDITY_INTERACTION_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Liquidity',
      concept_type: event.properties?.interactionType?.toUpperCase() || 'INTERACTION',
      concept_state: event.properties?.stateBefore || 'active',
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify({
        poolId: event.properties?.poolId,
        interactionType: event.properties?.interactionType,
        levelPrice: event.properties?.levelPrice,
        barIndex: event.properties?.barIndex,
        ...event.properties
      })
    };
  }
}

module.exports = LiquidityInteractionEngine;
