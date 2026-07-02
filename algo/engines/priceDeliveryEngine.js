/**
 * algo/engines/priceDeliveryEngine.js
 * Implements the Price Delivery Engine to track active price delivery legs from swept/taken source pools.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const LiquidityEngine = require('./liquidityEngine');
const LiquidityInteractionEngine = require('./liquidityInteractionEngine');
const { makeEvent } = require('../eventSchema');

class PriceDeliveryEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, symbol } = context;

    // Resolve swings
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    // Resolve liquidity pools
    const liquidityEngine = new LiquidityEngine();
    const liquidityPools = preComputedLiquidity || liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings: swings, symbol });

    // Resolve liquidity interactions
    const interactionEngine = new LiquidityInteractionEngine();
    const interactionEvents = preComputedInteractions || interactionEngine.detect(bars, {}, { preComputedSwings: swings, preComputedLiquidity: liquidityPools, symbol });

    if (bars.length === 0) return [];

    const deliveryLegs = [];

    // Filter sweep and take events to start delivery legs
    const triggers = interactionEvents.filter(e => 
      e.properties?.interactionType === 'sweep' || e.properties?.interactionType === 'take'
    );

    // Pre-map consumption times/bars for quick O(1) lookup in loop
    const consumedPoolsMap = new Map();
    for (const e of interactionEvents) {
      if (e.properties?.interactionType === 'consume') {
        consumedPoolsMap.set(e.properties.poolId, e.barIndex);
      }
    }

    for (const trig of triggers) {
      const startBarIdx = trig.barIndex;
      const poolDir = trig.direction; // bsl, ssl, eqh, eql, etc.
      const isBearish = poolDir.startsWith('bsl') || poolDir.startsWith('eqh') || poolDir.startsWith('reqh');
      const direction = isBearish ? 'bearish' : 'bullish';

      const timeStart = trig.time;
      const sourcePoolId = trig.properties?.poolId;

      // Find the source pool object
      const sourcePool = liquidityPools.find(p => p.id === sourcePoolId);
      if (!sourcePool) continue;

      // Establish the protected level
      let protectedLevel = sourcePool.levelPrice;
      if (isBearish && swings && swings.swingHighs) {
        const sh = swings.swingHighs
          .filter(s => s.barIndex <= startBarIdx && s.priceHigh >= sourcePool.levelPrice)
          .sort((a, b) => b.barIndex - a.barIndex)[0];
        if (sh) protectedLevel = sh.priceHigh;
        else protectedLevel = sourcePool.levelPrice + 5.0; // fallback
      } else if (!isBearish && swings && swings.swingLows) {
        const sl = swings.swingLows
          .filter(s => s.barIndex <= startBarIdx && s.priceLow <= sourcePool.levelPrice)
          .sort((a, b) => b.barIndex - a.barIndex)[0];
        if (sl) protectedLevel = sl.priceLow;
        else protectedLevel = sourcePool.levelPrice - 5.0; // fallback
      }

      // Find target pool: nearest active pool in opposite direction
      let targetPool = null;
      let minDistance = Infinity;

      for (const p of liquidityPools) {
        const poolDir = p.directionType || p.direction;
        const isTargetMatch = isBearish 
          ? (poolDir.startsWith('ssl') || poolDir.startsWith('eql') || poolDir.startsWith('reql'))
          : (poolDir.startsWith('bsl') || poolDir.startsWith('eqh') || poolDir.startsWith('reqh'));

        if (isTargetMatch && p.barIndex < startBarIdx) {
          // Check if this target was already fully consumed before our start
          const consumeBarIdx = consumedPoolsMap.get(p.id);
          if (consumeBarIdx !== undefined && consumeBarIdx < startBarIdx) continue;

          // Compute price distance
          const distance = isBearish 
            ? Math.abs(sourcePool.levelPrice - p.levelPrice)
            : Math.abs(p.levelPrice - sourcePool.levelPrice);

          if (distance < minDistance) {
            minDistance = distance;
            targetPool = p;
          }
        }
      }

      const targetPoolId = targetPool ? targetPool.id : null;
      const targetPrice = targetPool ? targetPool.levelPrice : null;

      let currentExtremum = sourcePool.levelPrice;
      let state = 'developing';
      let timeEnd = null;
      let completedBarIdx = -1;

      // Scan forward to determine delivery lifecycle
      for (let j = startBarIdx + 1; j < bars.length; j++) {
        const bar = bars[j];

        // 1. Invalidation Check: candle body close past protected level
        if (isBearish && bar.close > protectedLevel) {
          state = 'invalidated';
          timeEnd = bar.time;
          break;
        } else if (!isBearish && bar.close < protectedLevel) {
          state = 'invalidated';
          timeEnd = bar.time;
          break;
        }

        // 2. Track current extremum
        if (isBearish) {
          if (bar.low < currentExtremum) {
            currentExtremum = bar.low;
          }
        } else {
          if (bar.high > currentExtremum) {
            currentExtremum = bar.high;
          }
        }

        // 3. Completion Check: price intersects target pool price
        if (targetPrice !== null) {
          const reachedTarget = isBearish 
            ? bar.low <= targetPrice 
            : bar.high >= targetPrice;

          if (reachedTarget) {
            state = 'completed';
            timeEnd = bar.time;
            completedBarIdx = j;
            break;
          }
        }
      }

      const priceHigh = isBearish ? sourcePool.levelPrice : currentExtremum;
      const priceLow = isBearish ? currentExtremum : sourcePool.levelPrice;

      deliveryLegs.push(makeEvent({
        id: `delivery_${direction}_${timeStart}`,
        type: 'delivery_leg',
        direction: direction,
        time: timeStart,
        timeStart: timeStart,
        timeEnd: timeEnd,
        priceHigh,
        priceLow,
        barIndex: startBarIdx,
        symbol: symbol || '',
        timeframe: trig.timeframe || 1,
        state: state,
        createdBy: trig.id,
        validatedBy: null, // will be updated when Structure Confirmation breaks
        consumes: sourcePoolId,
        targets: targetPoolId,
        invalidatedBy: state === 'invalidated' ? `invalidation_${timeEnd}` : null,
        lifecycleState: state,
        narrativeRole: 'contextual_evidence',
        properties: {
          anchorPrice: sourcePool.levelPrice,
          expansionPrice: currentExtremum,
          protectedLevel,
          currentExtremum,
          completedBarIdx,
          targetPrice
        }
      }));
    }

    return deliveryLegs;
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
      detector_id: event.detectorId || 'PRICE_DELIVERY_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Price Delivery',
      concept_type: 'Price Delivery Leg',
      concept_state: event.state || 'active',
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify({
        createdBy: event.createdBy,
        validatedBy: event.validatedBy,
        consumes: event.consumes,
        targets: event.targets,
        invalidatedBy: event.invalidatedBy,
        lifecycleState: event.lifecycleState,
        narrativeRole: event.narrativeRole,
        renderability: event.renderability,
        researchMetadata: event.researchMetadata,
        ...event.properties
      })
    };
  }
}

module.exports = PriceDeliveryEngine;
