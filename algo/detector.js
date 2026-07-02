/**
 * algo/detector.js
 * Generates CANDIDATE zones/events for each concept type.
 * Acts as a routing layer routing calls to high-precision primitives in primitives.js.
 */

const {
  detectProtectedHighLowCandidates,
  detectBOSMSSCandidates,
  detectSessionCandidates,
  detectMacroCandidates,
  detectAMDCandidates,
  detectOrderBlockCandidates
} = require('./primitives');
const SwingEngine = require('./engines/swingEngine');
const DealingRangeEngine = require('./engines/dealingRangeEngine');
const LiquidityEngine = require('./engines/liquidityEngine');
const ImbalanceEngine = require('./engines/imbalanceEngine');
const DisplacementEngine = require('./engines/displacementEngine');
const LiquidityInteractionEngine = require('./engines/liquidityInteractionEngine');
const PriceDeliveryEngine = require('./engines/priceDeliveryEngine');
const StructureConfirmationEngine = require('./engines/structureConfirmationEngine');
const PDArrayContextEngine = require('./engines/pdArrayContextEngine');
const BreakerEngine = require('./engines/breakerEngine');

const swingEngine = new SwingEngine();
const dealingRangeEngine = new DealingRangeEngine();
const liquidityEngine = new LiquidityEngine();
const imbalanceEngine = new ImbalanceEngine();
const displacementEngine = new DisplacementEngine();
const liquidityInteractionEngine = new LiquidityInteractionEngine();
const priceDeliveryEngine = new PriceDeliveryEngine();
const structureConfirmationEngine = new StructureConfirmationEngine();
const pdArrayContextEngine = new PDArrayContextEngine();
const breakerEngine = new BreakerEngine();

const { makeEvent } = require('./eventSchema');

/**
 * Main: get candidates for a given concept type
 */
function getCandidates(conceptType, bars, limit = 100, preComputedSwings = null, symbol = '', cacheObj = null, options = {}) {
  // Resolve base concept and cache key
  let baseType = conceptType;
  let isRefLevel = false;
  if (conceptType.startsWith('reference_level_')) {
    baseType = 'reference_level';
    isRefLevel = true;
  } else if (conceptType.endsWith('_bullish') || conceptType.endsWith('_bearish')) {
    baseType = conceptType.substring(0, conceptType.lastIndexOf('_'));
  } else if (conceptType.endsWith('_premium') || conceptType.endsWith('_discount')) {
    baseType = conceptType.substring(0, conceptType.lastIndexOf('_'));
  } else if (conceptType.startsWith('liquidity_interaction')) {
    baseType = 'liquidity_interaction';
  } else if (conceptType.startsWith('liquidity_') && !conceptType.startsWith('liquidity_void')) {
    baseType = 'liquidity';
  }

  const cacheKey = `${baseType}_tf_${bars.length}`;
  let all = [];

  if (cacheObj && cacheObj.has(cacheKey) && Object.keys(options).length === 0) {
    all = cacheObj.get(cacheKey);
  } else {
    // Run detection
    if (conceptType.startsWith('ifvg')) {
      all = imbalanceEngine.detect(bars, { concept: 'ifvg', ...options });
    } else if (conceptType.startsWith('fvg')) {
      all = imbalanceEngine.detect(bars, { concept: 'fvg', ...options });
    } else if (conceptType.startsWith('ob')) {
      all = detectOrderBlockCandidates(bars, preComputedSwings, options);
    } else if (conceptType.startsWith('breaker')) {
      all = breakerEngine.detect(bars, options, { preComputedSwings });
    } else if (conceptType.startsWith('liquidity_void')) {
      all = imbalanceEngine.detect(bars, { concept: 'liquidity_void', ...options });
    } else if (conceptType.startsWith('liquidity_interaction')) {
      const preSwings = preComputedSwings;
      const preLiq = cacheObj ? cacheObj.get(`liquidity_tf_${bars.length}`) : null;
      all = liquidityInteractionEngine.detect(bars, {}, { preComputedSwings: preSwings, preComputedLiquidity: preLiq, symbol });
    } else if (conceptType.startsWith('liquidity')) {
      all = liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings, symbol });
    } else if (conceptType.startsWith('swing')) {
      all = swingEngine.detect(bars, { concept: 'swing' }, { preComputedSwings });
    } else if (conceptType.startsWith('mss') || conceptType.startsWith('bos')) {
      all = detectBOSMSSCandidates(bars, preComputedSwings);
    } else if (conceptType.startsWith('displacement')) {
      all = displacementEngine.detect(bars, { concept: 'displacement' });
    } else if (conceptType.startsWith('protected_high_low')) {
      all = detectProtectedHighLowCandidates(bars, preComputedSwings);
    } else if (conceptType.startsWith('volume_imbalance')) {
      all = imbalanceEngine.detect(bars, { concept: 'volume_imbalance', ...options });
    } else if (conceptType.startsWith('session')) {
      all = detectSessionCandidates(bars);
    } else if (conceptType.startsWith('macro')) {
      all = detectMacroCandidates(bars);
    } else if (conceptType.startsWith('amd')) {
      all = detectAMDCandidates(bars);
    } else if (conceptType.startsWith('price_delivery')) {
      const preSwings = preComputedSwings;
      const preLiq = cacheObj ? cacheObj.get(`liquidity_tf_${bars.length}`) : null;
      const preComputedInteractions = cacheObj ? cacheObj.get(`liquidity_interaction_tf_${bars.length}`) : null;
      all = priceDeliveryEngine.detect(bars, {}, { preComputedSwings: preSwings, preComputedLiquidity: preLiq, preComputedInteractions, symbol });
    } else if (conceptType.startsWith('structure_confirm')) {
      const preSwings = preComputedSwings;
      const preLiq = cacheObj ? cacheObj.get(`liquidity_tf_${bars.length}`) : null;
      const preComputedInteractions = cacheObj ? cacheObj.get(`liquidity_interaction_tf_${bars.length}`) : null;
      const preDelivery = cacheObj ? cacheObj.get(`price_delivery_tf_${bars.length}`) : null;
      all = structureConfirmationEngine.detect(bars, {}, {
        preComputedSwings: preSwings,
        preComputedLiquidity: preLiq,
        preComputedInteractions,
        preComputedDelivery: preDelivery,
        symbol
      });
    } else if (conceptType.startsWith('premium_discount')) {
      const preSwings = preComputedSwings;
      const preLiq = cacheObj ? cacheObj.get(`liquidity_tf_${bars.length}`) : null;
      const preComputedInteractions = cacheObj ? cacheObj.get(`liquidity_interaction_tf_${bars.length}`) : null;
      const preDelivery = cacheObj ? cacheObj.get(`price_delivery_tf_${bars.length}`) : null;
      const preStructureConfirm = cacheObj ? cacheObj.get(`structure_confirm_tf_${bars.length}`) : null;
      all = dealingRangeEngine.detect(bars, {}, {
        preComputedSwings: preSwings,
        preComputedLiquidity: preLiq,
        preComputedInteractions,
        preComputedDelivery: preDelivery,
        preComputedStructureConfirm: preStructureConfirm,
        symbol
      });
    } else if (conceptType.startsWith('dealing_range')) {
      const preSwings = preComputedSwings;
      const preLiq = cacheObj ? cacheObj.get(`liquidity_tf_${bars.length}`) : null;
      const preComputedInteractions = cacheObj ? cacheObj.get(`liquidity_interaction_tf_${bars.length}`) : null;
      const preDelivery = cacheObj ? cacheObj.get(`price_delivery_tf_${bars.length}`) : null;
      const preStructureConfirm = cacheObj ? cacheObj.get(`structure_confirm_tf_${bars.length}`) : null;
      all = dealingRangeEngine.detect(bars, {}, {
        preComputedSwings: preSwings,
        preComputedLiquidity: preLiq,
        preComputedInteractions,
        preComputedDelivery: preDelivery,
        preComputedStructureConfirm: preStructureConfirm,
        symbol
      });
    } else if (conceptType.startsWith('reference_level')) {
      const { detectReferenceLevels } = require('./referenceLevels');
      all = detectReferenceLevels(bars);
    }

    if (cacheObj) {
      all = all.map(c => {
        if (c.conceptFamily) return c;
        try {
          return makeEvent({
            type: c.type,
            direction: c.direction,
            time: c.time,
            timeStart: c.timeStart !== undefined ? c.timeStart : c.time,
            timeEnd: c.timeEnd !== undefined ? c.timeEnd : null,
            priceHigh: c.priceHigh,
            priceLow: c.priceLow,
            barIndex: c.barIndex !== undefined ? c.barIndex : 0,
            properties: c.properties || {},
            ...c
          });
        } catch (err) {
          console.warn(`[detector] Failed to wrap candidate through makeEvent:`, err.message, c);
          return c;
        }
      });
      cacheObj.set(cacheKey, all);
    }
  }

  // Filter based on conceptType
  let filtered = [];
  if (isRefLevel) {
    const subType = conceptType.replace('reference_level_', '');
    filtered = all.filter(c => c.direction === subType);
  } else if (conceptType.startsWith('liquidity_interaction_')) {
    const isBullish = conceptType.includes('bullish');
    filtered = all.filter(c => {
      const dir = c.direction.toLowerCase();
      const isSsl = dir.startsWith('ssl') || dir.startsWith('eql') || dir.startsWith('reql');
      return isBullish ? isSsl : !isSsl;
    });
  } else if (conceptType.startsWith('liquidity_')) {
    if (conceptType.includes('bsl')) {
      filtered = all.filter(c => c.direction === 'bsl' || c.direction === 'eqh' || c.direction === 'reqh');
    } else if (conceptType.includes('ssl')) {
      filtered = all.filter(c => c.direction === 'ssl' || c.direction === 'eql' || c.direction === 'reql');
    }
  } else if (conceptType.startsWith('mss')) {
    const dir = conceptType.includes('bullish') ? 'bullish' : 'bearish';
    filtered = all.filter(c => c.type === 'mss' && c.direction === dir);
  } else if (conceptType.startsWith('bos')) {
    const dir = conceptType.includes('bullish') ? 'bullish' : 'bearish';
    filtered = all.filter(c => c.type === 'bos' && c.direction === dir);
  } else if (conceptType.startsWith('session') || conceptType.startsWith('macro')) {
    filtered = all.filter(c => conceptType.includes(c.direction));
  } else if (conceptType.endsWith('_bullish') || conceptType.endsWith('_bearish')) {
    const dir = conceptType.includes('bullish') ? 'bullish' : 'bearish';
    filtered = all.filter(c => c.direction === dir);
  } else if (conceptType.endsWith('_premium') || conceptType.endsWith('_discount')) {
    const dir = conceptType.endsWith('discount') ? 'discount' : 'premium';
    filtered = all.filter(c => c.direction === dir);
  } else {
    filtered = all;
  }

  // Sort most recent first and slice to limit
  filtered.sort((a, b) => b.time - a.time);
  const sliced = filtered.slice(0, limit);

  // Wrap ONLY the final sliced result if they are not already wrapped
  return sliced.map(c => {
    if (c.conceptFamily) return c;
    try {
      return makeEvent({
        type: c.type,
        direction: c.direction,
        time: c.time,
        timeStart: c.timeStart !== undefined ? c.timeStart : c.time,
        timeEnd: c.timeEnd !== undefined ? c.timeEnd : null,
        priceHigh: c.priceHigh,
        priceLow: c.priceLow,
        barIndex: c.barIndex !== undefined ? c.barIndex : 0,
        properties: c.properties || {},
        ...c
      });
    } catch (err) {
      console.warn(`[detector] Failed to wrap candidate through makeEvent:`, err.message, c);
      return c;
    }
  });
}

module.exports = {
  getCandidates
};
