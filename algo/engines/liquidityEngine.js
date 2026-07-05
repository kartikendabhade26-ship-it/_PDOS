/**
 * algo/engines/liquidityEngine.js
 * Implements Equal Highs, Equal Lows, Buy Side, and Sell Side Liquidity pools from swings.
 * Simple, static, purely structural clustering without active state-tracking.
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const config = require('../config');
const { calculateSwingStrength } = require('../primitives');

const getStrength = (s, bars) => s.strength !== undefined ? s.strength : calculateSwingStrength(s, bars);

class LiquidityEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, symbol } = context;
    const timeframeObj = this.timeframe || 1;

    if (global.profiler) {
      global.profiler.incrementCounter('barsProcessed', bars.length);
    }

    if (global.profiler) global.profiler.startEnginePhase('LiquidityEngine', timeframeObj, 'resolveSwings');
    const swingEngine = new SwingEngine();
    const swingsRaw = preComputedSwings || swingEngine.findSwings(bars);
    
    const swingHighs = (swingsRaw.swingHighs || []).filter(s => getStrength(s, bars) >= 1);
    const swingLows = (swingsRaw.swingLows || []).filter(s => getStrength(s, bars) >= 1);
    if (global.profiler) global.profiler.endEnginePhase('LiquidityEngine', timeframeObj, 'resolveSwings');
    
    if (global.profiler) global.profiler.startEnginePhase('LiquidityEngine', timeframeObj, 'clustering');
    const symConfig = config.symbols[symbol] || config.symbols['default'];
    const TOLERANCE = symConfig.liquidityTolerance;
    const pools = [];

    if (bars.length === 0) return [];

    // Group and sort all swings chronologically by bar index
    const allSwings = [
      ...swingHighs.map(s => ({ ...s, swingType: 'high' })),
      ...swingLows.map(s => ({ ...s, swingType: 'low' }))
    ].sort((a, b) => a.barIndex - b.barIndex);

    for (const sw of allSwings) {
      const swPrice = sw.swingType === 'high' ? sw.priceHigh : sw.priceLow;
      const directionType = sw.swingType === 'high' ? 'bsl' : 'ssl';

      // Look for an existing pool that is within TOLERANCE and same direction
      let matchedPool = null;
      let scanCount = 0;
      for (let k = pools.length - 1; k >= 0; k--) {
        const p = pools[k];
        scanCount++;
        if (scanCount > 200) break;
        
        if (p.directionType === directionType && Math.abs(p.levelPrice - swPrice) <= TOLERANCE) {
          const lastSwing = p.swings[p.swings.length - 1];
          if (sw.barIndex - lastSwing.barIndex > 5000) continue;
          matchedPool = p;
          break;
        }
      }

      if (matchedPool) {
        // Merge into matched pool
        matchedPool.swings.push(sw);
        matchedPool.touchCount++;
        matchedPool.swingCount++;
        
        const prices = matchedPool.swings.map(s => s.swingType === 'high' ? s.priceHigh : s.priceLow);
        if (matchedPool.directionType === 'bsl') {
          matchedPool.levelPrice = Math.max(...prices);
        } else {
          matchedPool.levelPrice = Math.min(...prices);
        }
        matchedPool.priceHigh = matchedPool.levelPrice + TOLERANCE;
        matchedPool.priceLow = matchedPool.levelPrice - TOLERANCE;
        matchedPool.timeEnd = sw.time;
        
        // Keep base direction (bsl/ssl) matching schema definitions
        // (sub-classifications like reqh/reql can be stored as metadata if needed)
        
        matchedPool.properties.clusterMembers.push({
          barIndex: sw.barIndex,
          time: sw.time,
          price: swPrice,
          strength: getStrength(sw, bars)
        });
        matchedPool.properties.touchCount = matchedPool.touchCount;
        matchedPool.properties.swingCount = matchedPool.swingCount;
        matchedPool.properties.levelPrice = matchedPool.levelPrice;
        matchedPool.properties.isMajor = matchedPool.swings.some(s => getStrength(s, bars) >= 5);
      } else {
        // Create new pool
        pools.push({
          id: `liquidity_${directionType}_${sw.time}`,
          type: 'liquidity',
          directionType, 
          direction: directionType,
          time: sw.time,
          timeStart: sw.time,
          timeEnd: sw.time,
          priceHigh: swPrice + TOLERANCE,
          priceLow: swPrice - TOLERANCE,
          barIndex: sw.barIndex,
          levelPrice: swPrice,
          touchCount: 1,
          swingCount: 1,
          swings: [sw],
          properties: {
            levelPrice: swPrice,
            touchCount: 1,
            swingCount: 1,
            isMajor: getStrength(sw, bars) >= 5,
            clusterMembers: [{
              barIndex: sw.barIndex,
              time: sw.time,
              price: swPrice,
              strength: getStrength(sw, bars)
            }]
          }
        });
      }
    }

    // Determine timeframe for quality scoring
    let timeframe = 1;
    if (bars.length >= 2) {
      const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
      if (diffMin > 0) {
        timeframe = diffMin;
      }
    }
    if (global.profiler) global.profiler.endEnginePhase('LiquidityEngine', timeframeObj, 'clustering');

    if (global.profiler) global.profiler.startEnginePhase('LiquidityEngine', timeframeObj, 'qualityScoring');
    // Calculate Quality Score & finalize contributingSwingIds
    for (const p of pools) {
      const maxStrength = p.swings.reduce((max, s) => Math.max(max, getStrength(s, bars)), 1);
      p.properties.maxStrength = maxStrength;
      
      const touchCount = p.touchCount || 1;
      let score = touchCount * 15;
      score += maxStrength * 2.5;
      
      const tfWeights = { 1: 5, 5: 10, 15: 20, 60: 35, 240: 50, 1440: 75 };
      score += tfWeights[timeframe] || 5;
      
      p.properties.qualityScore = Math.min(100, Math.round(score));
      p.properties.contributingSwingIds = p.swings.map(s => `${s.id}_tf${timeframe}`);
    }
    if (global.profiler) global.profiler.endEnginePhase('LiquidityEngine', timeframeObj, 'qualityScoring');

    if (global.profiler) {
      global.profiler.incrementCounter('eventsProduced', pools.length);
    }
    return pools;
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
      levelPrice: event.properties?.levelPrice,
      touchCount: event.properties?.touchCount,
      swingCount: event.properties?.swingCount,
      isMajor: event.properties?.isMajor,
      clusterMembers: event.properties?.clusterMembers,
      contributingSwingIds: event.properties?.contributingSwingIds,
      maxStrength: event.properties?.maxStrength,
      qualityScore: event.properties?.qualityScore,
      ...event.properties
    };

    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: event.detectorId || 'LIQUIDITY_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Liquidity',
      concept_type: event.direction.toUpperCase(), // BSL, SSL, EQH, EQL
      concept_state: 'active',
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify(properties)
    };
  }
}

module.exports = LiquidityEngine;
