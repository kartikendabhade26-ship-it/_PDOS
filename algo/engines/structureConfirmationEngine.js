/**
 * algo/engines/structureConfirmationEngine.js
 * Implements the Structure Confirmation Engine.
 * Confirms price delivery legs when candle body closes past swing pivots.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const PriceDeliveryEngine = require('./priceDeliveryEngine');
const { makeEvent } = require('../eventSchema');

class StructureConfirmationEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, preComputedDelivery, symbol } = context;

    // Resolve swings
    const swingEngine = new SwingEngine();
    const swings = preComputedSwings || swingEngine.findSwings(bars);

    // Resolve delivery legs
    const deliveryEngine = new PriceDeliveryEngine();
    const deliveryLegs = preComputedDelivery || deliveryEngine.detect(bars, {}, {
      preComputedSwings: swings,
      preComputedLiquidity,
      preComputedInteractions,
      symbol
    });

    if (bars.length === 0) return [];

    const confirmations = [];

    // Extract swing highs and lows
    const swingHighs = (swings.swingHighs || []).filter(s => s.state === undefined || s.state === 'Confirmed' || s.state === 'active');
    const swingLows = (swings.swingLows || []).filter(s => s.state === undefined || s.state === 'Confirmed' || s.state === 'active');

    for (const leg of deliveryLegs) {
      // Structure confirmation only checks active/developing or completed delivery legs
      if (leg.state === 'invalidated') continue;

      const isBearish = leg.direction === 'bearish';
      const startBarIdx = leg.barIndex;
      const endBarIdx = leg.properties?.completedBarIdx !== -1 && leg.properties?.completedBarIdx !== undefined
        ? leg.properties.completedBarIdx
        : bars.length - 1;

      // Track which swings we have already confirmed breaks for to avoid duplicate confirm events per swing
      const confirmedSwingIds = new Set();

      // Prepare active and pending swing lists
      const activeSwings = [];
      const pendingSwings = [];

      const relevantLows = isBearish 
        ? swingLows.filter(s => s.barIndex >= startBarIdx - 500 && s.barIndex <= endBarIdx)
        : [];
      const relevantHighs = !isBearish
        ? swingHighs.filter(s => s.barIndex >= startBarIdx - 500 && s.barIndex <= endBarIdx)
        : [];

      const swingsToPartition = isBearish ? relevantLows : relevantHighs;
      for (const swing of swingsToPartition) {
        if (swing.barIndex < startBarIdx + 1) {
          activeSwings.push(swing);
        } else {
          pendingSwings.push(swing);
        }
      }
      pendingSwings.sort((a, b) => a.barIndex - b.barIndex);

      let pendingPtr = 0;

      for (let j = startBarIdx + 1; j <= endBarIdx; j++) {
        if (j >= bars.length) break;
        const bar = bars[j];

        // Activate pending swings up to current index j
        while (pendingPtr < pendingSwings.length && pendingSwings[pendingPtr].barIndex < j) {
          activeSwings.push(pendingSwings[pendingPtr]);
          pendingPtr++;
        }

        // Check active swings for breaks
        for (let k = activeSwings.length - 1; k >= 0; k--) {
          const swing = activeSwings[k];
          if (isBearish) {
            const swingLowPrice = swing.priceLow || swing.price;
            if (bar.close < swingLowPrice) {
              confirmations.push(makeEvent({
                id: `struct_confirm_bearish_${bar.time}_idx${j}`,
                type: 'structure_confirm',
                direction: 'bearish',
                time: bar.time,
                timeStart: bar.time,
                timeEnd: null,
                priceHigh: swingLowPrice,
                priceLow: bar.low,
                barIndex: j,
                symbol: symbol || '',
                timeframe: leg.timeframe || 1,
                state: 'confirmed',
                createdBy: leg.id,
                validatedBy: null,
                consumes: swing.id,
                targets: null,
                invalidatedBy: null,
                lifecycleState: 'confirmed',
                narrativeRole: 'contextual_evidence',
                properties: {
                  delivery_leg_id: leg.id,
                  swing_pivot_id: swing.id,
                  breakPrice: swingLowPrice
                }
              }));
              activeSwings.splice(k, 1);
            }
          } else {
            const swingHighPrice = swing.priceHigh || swing.price;
            if (bar.close > swingHighPrice) {
              confirmations.push(makeEvent({
                id: `struct_confirm_bullish_${bar.time}_idx${j}`,
                type: 'structure_confirm',
                direction: 'bullish',
                time: bar.time,
                timeStart: bar.time,
                timeEnd: null,
                priceHigh: bar.high,
                priceLow: swingHighPrice,
                barIndex: j,
                symbol: symbol || '',
                timeframe: leg.timeframe || 1,
                state: 'confirmed',
                createdBy: leg.id,
                validatedBy: null,
                consumes: swing.id,
                targets: null,
                invalidatedBy: null,
                lifecycleState: 'confirmed',
                narrativeRole: 'contextual_evidence',
                properties: {
                  delivery_leg_id: leg.id,
                  swing_pivot_id: swing.id,
                  breakPrice: swingHighPrice
                }
              }));
              activeSwings.splice(k, 1);
            }
          }
        }
      }
    }

    return confirmations;
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
      detector_id: event.detectorId || 'STRUCTURE_CONFIRMATION_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Structure Breaks',
      concept_type: 'Structure Confirmation',
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

module.exports = StructureConfirmationEngine;
