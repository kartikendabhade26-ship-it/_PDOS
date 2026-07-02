/**
 * algo/engines/dealingRangeEngine.js
 * Refactored Dealing Range Engine.
 * Central coordinator of the Price Delivery Engine ecosystem.
 * Manages active/developing and completed Dealing Ranges with delivery state context,
 * tied to validated Market Intent and confirmed by Structure Confirmation.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const LiquidityEngine = require('./liquidityEngine');
const LiquidityInteractionEngine = require('./liquidityInteractionEngine');
const StructureConfirmationEngine = require('./structureConfirmationEngine');
const PriceDeliveryEngine = require('./priceDeliveryEngine');
const { makeEvent } = require('../eventSchema');

class DealingRangeEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, preComputedDelivery, preComputedStructureConfirm, symbol } = context;

    // Resolve swings
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    // Resolve liquidity pools
    const liquidityEngine = new LiquidityEngine();
    const liquidityPools = preComputedLiquidity || liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings: swings, symbol });

    // Resolve interactions
    const interactionEngine = new LiquidityInteractionEngine();
    const interactionEvents = preComputedInteractions || interactionEngine.detect(bars, {}, { preComputedSwings: swings, preComputedLiquidity: liquidityPools, symbol });

    // Resolve delivery legs
    const deliveryEngine = new PriceDeliveryEngine();
    const deliveryLegs = preComputedDelivery || deliveryEngine.detect(bars, {}, {
      preComputedSwings: swings,
      preComputedLiquidity: liquidityPools,
      preComputedInteractions: interactionEvents,
      symbol
    });

    // Resolve structure confirmations
    const confirmationEngine = new StructureConfirmationEngine();
    const confirmations = preComputedStructureConfirm || confirmationEngine.detect(bars, {}, {
      preComputedSwings: swings,
      preComputedLiquidity: liquidityPools,
      preComputedInteractions: interactionEvents,
      preComputedDelivery: deliveryLegs,
      symbol
    });

    if (bars.length === 0) return [];

    let timeframe = 1;
    if (bars.length >= 2) {
      const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
      if (diffMin > 0) timeframe = diffMin;
    }

    const ranges = [];

    // Filter sweep and take interaction events to start dealing ranges
    const triggers = interactionEvents.filter(e => 
      e.properties?.interactionType === 'sweep' || e.properties?.interactionType === 'take'
    );

    for (const trig of triggers) {
      const startBarIdx = trig.barIndex;
      const poolDir = trig.direction;
      const isBearish = poolDir.startsWith('bsl') || poolDir.startsWith('eqh') || poolDir.startsWith('reqh');
      const direction = isBearish ? 'bearish' : 'bullish';

      const sourcePoolId = trig.properties?.poolId;
      const sourcePool = liquidityPools.find(p => p.id === sourcePoolId);
      if (!sourcePool) continue;

      const anchorPrice = sourcePool.levelPrice;
      const timeStart = trig.time;

      // Find delivery leg and confirmations associated with this trigger
      const deliveryLeg = deliveryLegs.find(d => d.createdBy === trig.id);
      const legConfirmations = confirmations.filter(c => c.createdBy === (deliveryLeg ? deliveryLeg.id : ''));

      // Establish protected level
      let protectedLevel = anchorPrice;
      if (isBearish && swings && swings.swingHighs) {
        const sh = swings.swingHighs
          .filter(s => s.barIndex <= startBarIdx && s.priceHigh >= anchorPrice)
          .sort((a, b) => b.barIndex - a.barIndex)[0];
        if (sh) protectedLevel = sh.priceHigh;
        else protectedLevel = anchorPrice + 5.0; // fallback
      } else if (!isBearish && swings && swings.swingLows) {
        const sl = swings.swingLows
          .filter(s => s.barIndex <= startBarIdx && s.priceLow <= anchorPrice)
          .sort((a, b) => b.barIndex - a.barIndex)[0];
        if (sl) protectedLevel = sl.priceLow;
        else protectedLevel = anchorPrice - 5.0; // fallback
      }

      // Track target pool
      let targetPool = null;
      if (deliveryLeg) {
        targetPool = liquidityPools.find(p => p.id === deliveryLeg.targets);
      }

      const targetPoolId = targetPool ? targetPool.id : null;
      const targetPrice = targetPool ? targetPool.levelPrice : null;

      let currentExtremum = anchorPrice;
      let state = 'developing';
      let timeEnd = null;
      let completedBarIdx = -1;

      // Scan forward to determine dealing range lifecycle
      for (let j = startBarIdx + 1; j < bars.length; j++) {
        const bar = bars[j];

        // 1. Invalidation Check (body close past protected level)
        if (isBearish && bar.close > protectedLevel) {
          state = 'invalidated';
          timeEnd = bar.time;
          break;
        } else if (!isBearish && bar.close < protectedLevel) {
          state = 'invalidated';
          timeEnd = bar.time;
          break;
        }

        // 2. Track Extremum
        if (isBearish) {
          if (bar.low < currentExtremum) {
            currentExtremum = bar.low;
          }
        } else {
          if (bar.high > currentExtremum) {
            currentExtremum = bar.high;
          }
        }

        // 3. Completion Check (opposing target swept/taken)
        if (targetPrice !== null) {
          const reachedTarget = isBearish 
            ? bar.low <= targetPrice 
            : bar.high >= targetPrice;

          if (reachedTarget) {
            state = 'completed';
            timeEnd = bar.time;
            completedBarIdx = j;
            
            // Align completion extremum using the extreme swing inside the target zone
            let completedPrice = targetPrice;
            if (isBearish && swings && swings.swingLows) {
              const sl = swings.swingLows
                .filter(s => s.barIndex <= j && s.priceLow >= targetPool.priceLow && s.priceLow <= targetPool.priceHigh)
                .sort((a, b) => a.priceLow - b.priceLow)[0]; // Sort by lowest low to get the extreme boundary
              if (sl) {
                completedPrice = sl.priceLow;
              }
            } else if (!isBearish && swings && swings.swingHighs) {
              const sh = swings.swingHighs
                .filter(s => s.barIndex <= j && s.priceHigh >= targetPool.priceLow && s.priceHigh <= targetPool.priceHigh)
                .sort((a, b) => b.priceHigh - a.priceHigh)[0]; // Sort by highest high to get the extreme boundary
              if (sh) {
                completedPrice = sh.priceHigh;
              }
            }
            currentExtremum = completedPrice;
            break;
          }
        }
      }

      const rangeHigh = isBearish ? anchorPrice : currentExtremum;
      const rangeLow = isBearish ? currentExtremum : anchorPrice;
      const equilibrium = (rangeHigh + rangeLow) / 2;

      ranges.push(makeEvent({
        id: `dealing_range_${direction}_${timeStart}_tf${timeframe}`,
        type: 'dealing_range',
        direction: direction,
        time: timeStart,
        timeStart: timeStart,
        timeEnd: timeEnd,
        priceHigh: rangeHigh,
        priceLow: rangeLow,
        barIndex: startBarIdx,
        symbol: symbol || '',
        timeframe,
        state: state,
        createdBy: trig.id,
        validatedBy: legConfirmations.length > 0 ? legConfirmations[0].id : null,
        consumes: sourcePoolId,
        targets: targetPoolId,
        invalidatedBy: state === 'invalidated' ? `invalidation_${timeEnd}` : null,
        lifecycleState: state,
        narrativeRole: 'container',
        properties: {
          anchorPrice,
          expansionPrice: currentExtremum,
          equilibrium,
          deliveryState: {
            direction,
            anchor_liquidity_id: sourcePoolId,
            target_liquidity_id: targetPoolId,
            protected_level: protectedLevel,
            current_extremum: currentExtremum
          },
          premium: {
            high: rangeHigh,
            low: equilibrium
          },
          discount: {
            high: equilibrium,
            low: rangeLow
          }
        }
      }));
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
      detector_id: event.detectorId || 'DEALING_RANGE_v2',
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

module.exports = DealingRangeEngine;
