/**
 * algo/engines/imbalanceEngine.js
 * Implements FVG, IFVG, volume imbalance, and liquidity void detectors.
 */

const BaseEngine = require('./BaseEngine');
const { calculateAvgRangeForIndex } = require('../utils/math/atr');
const { makeEvent } = require('../eventSchema');

class ImbalanceEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const type = options.concept || 'fvg';

    if (type.startsWith('ifvg')) {
      return this.detectIFVGCandidates(bars, options);
    } else if (type.startsWith('fvg')) {
      return this.detectFVGCandidates(bars, options);
    } else if (type.startsWith('volume_imbalance')) {
      return this.detectVolumeImbalanceCandidates(bars, options);
    } else if (type.startsWith('liquidity_void')) {
      return this.detectLiquidityVoidCandidates(bars, options);
    }
    return [];
  }

  updateState(activeEvents, bars, context = {}) {
    // Pipeline outcome checks handle FVG fill and state updates
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
      gapSize: event.gapSize,
      ...event.properties
    };

    let family = 'Imbalances';
    let type = 'BISI';
    let state = event.state || 'active';

    if (event.type === 'fvg') {
      type = event.direction === 'bullish' ? 'BISI' : 'SIBI';
    } else if (event.type === 'ifvg') {
      type = event.direction === 'bullish' ? 'IBISI' : 'ISIBI';
      state = 'inverted';
    } else if (event.type === 'volume_imbalance') {
      type = 'Volume Imbalance';
    } else if (event.type === 'liquidity_void') {
      type = 'Liquidity Void';
    }

    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: event.detectorId || (event.type === 'volume_imbalance' ? 'VOLUME_IMBALANCE_v1' : event.type === 'liquidity_void' ? 'LIQUIDITY_VOID_v1' : event.type === 'ifvg' ? 'IFVG_v1' : 'FVG_v1'),
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: family,
      concept_type: type,
      concept_state: state,
      time_start: event.timeStart || event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify(properties)
    };
  }

  detectVolumeImbalanceCandidates(bars, options = {}) {
    const {
      startBarIdx = 1,
      endBarIdx = bars.length - 1,
      priceMin = 0,
      priceMax = Infinity,
      eligibleDirection = 'both'
    } = options;

    const candidates = [];
    const startIdx = Math.max(1, startBarIdx);
    const endIdx = Math.min(bars.length - 1, endBarIdx);

    for (let i = startIdx; i <= endIdx; i++) {
      const b0 = bars[i - 1];
      const b1 = bars[i];

      // Bullish Volume Imbalance
      if (eligibleDirection === 'both' || eligibleDirection === 'bullish') {
        if (b1.open > b0.close) {
          const gapSize = b1.open - b0.close;
          const priceLow = b0.close;
          const priceHigh = b1.open;
          if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) {
            const wickGap = Math.max(0, b1.low - b0.high);
            candidates.push({
              type: 'volume_imbalance',
              direction: 'bullish',
              time: b1.time,
              timeStart: b0.time,
              timeEnd: b1.time,
              priceHigh: priceHigh,
              priceLow: priceLow,
              barIndex: i,
              properties: {
                size: gapSize,
                bodyGap: gapSize,
                wickGap: wickGap
              }
            });
          }
        }
      }

      // Bearish Volume Imbalance
      if (eligibleDirection === 'both' || eligibleDirection === 'bearish') {
        if (b1.open < b0.close) {
          const gapSize = b0.close - b1.open;
          const priceLow = b1.open;
          const priceHigh = b0.close;
          if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) {
            const wickGap = Math.max(0, b0.low - b1.high);
            candidates.push({
              type: 'volume_imbalance',
              direction: 'bearish',
              time: b1.time,
              timeStart: b0.time,
              timeEnd: b1.time,
              priceHigh: priceHigh,
              priceLow: priceLow,
              barIndex: i,
              properties: {
                size: gapSize,
                bodyGap: gapSize,
                wickGap: wickGap
              }
            });
          }
        }
      }
    }
    return candidates;
  }

  detectLiquidityVoidCandidates(bars, options = {}) {
    const {
      startBarIdx = 16,
      endBarIdx = bars.length - 1,
      priceMin = 0,
      priceMax = Infinity,
      eligibleDirection = 'both'
    } = options;

    const candidates = [];
    const ATR_PERIOD = 14;
    const startIdx = Math.max(ATR_PERIOD + 2, startBarIdx);
    const endIdx = Math.min(bars.length - 1, endBarIdx);

    for (let i = startIdx; i <= endIdx; i++) {
      const b0 = bars[i - 2];
      const b1 = bars[i - 1];
      const b2 = bars[i];

      const avgRange = calculateAvgRangeForIndex(bars, i - 3, ATR_PERIOD);
      
      const isBullishRun = b0.close > b0.open && b1.close > b1.open && b2.close > b2.open;
      const isBearishRun = b0.close < b0.open && b1.close < b1.open && b2.close < b2.open;

      if (isBullishRun && (eligibleDirection === 'both' || eligibleDirection === 'bullish')) {
        const b0Size = b0.close - b0.open;
        const b1Size = b1.close - b1.open;
        const b2Size = b2.close - b2.open;

        if (b0Size > 1.2 * avgRange && b1Size > 1.2 * avgRange && b2Size > 1.2 * avgRange) {
          const rangeSize = b2.close - b0.open;
          const priceLow = b0.open;
          const priceHigh = b2.close;
          if (priceLow >= priceMin && priceHigh <= priceMax) {
            candidates.push(makeEvent({
              type: 'liquidity_void',
              direction: 'bullish',
              time: b2.time,
              timeStart: b0.time,
              timeEnd: b2.time,
              priceHigh: priceHigh,
              priceLow: priceLow,
              barIndex: i,
              properties: {
                impulseLength: 3,
                rangeMultiplier: 1.2,
                atrMultiplier: 1.2,
                rangeSize: rangeSize
              }
            }));
          }
        }
      } else if (isBearishRun && (eligibleDirection === 'both' || eligibleDirection === 'bearish')) {
        const b0Size = b0.open - b0.close;
        const b1Size = b1.open - b1.close;
        const b2Size = b2.open - b2.close;

        if (b0Size > 1.2 * avgRange && b1Size > 1.2 * avgRange && b2Size > 1.2 * avgRange) {
          const rangeSize = b0.open - b2.close;
          const priceLow = b2.close;
          const priceHigh = b0.open;
          if (priceLow >= priceMin && priceHigh <= priceMax) {
            candidates.push(makeEvent({
              type: 'liquidity_void',
              direction: 'bearish',
              time: b2.time,
              timeStart: b0.time,
              timeEnd: b2.time,
              priceHigh: priceHigh,
              priceLow: priceLow,
              barIndex: i,
              properties: {
                impulseLength: 3,
                rangeMultiplier: 1.2,
                atrMultiplier: 1.2,
                rangeSize: rangeSize
              }
            }));
          }
        }
      }
    }
    return candidates;
  }

  detectFVGCandidates(bars, options = {}) {
    const {
      startBarIdx = 2,
      endBarIdx = bars.length - 1,
      priceMin = 0,
      priceMax = Infinity,
      eligibleDirection = 'both'
    } = options;

    const candidates = [];
    const startIdx = Math.max(2, startBarIdx);
    const endIdx = Math.min(bars.length - 1, endBarIdx);

    for (let i = startIdx; i <= endIdx; i++) {
      const b0 = bars[i - 2]; 
      const b1 = bars[i - 1]; 
      const b2 = bars[i];     

      if (eligibleDirection === 'both' || eligibleDirection === 'bullish') {
        if (b2.low > b0.high) {
          const gapSize = b2.low - b0.high;
          const priceLow = b0.high;
          const priceHigh = b2.low;
          if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) { 
            candidates.push(makeEvent({
              type: 'fvg',
              direction: 'bullish',
              time: b1.time,         
              timeStart: b0.time,
              timeEnd: b2.time,
              priceHigh: priceHigh,     
              priceLow: priceLow,     
              barIndex: i - 1,       
              gapSize: gapSize,
              properties: {
                originBarIndex: i - 2,
                middleBarIndex: i - 1,
                confirmationBarIndex: i,
                gapSize: gapSize
              }
            }));
          }
        }
      }

      if (eligibleDirection === 'both' || eligibleDirection === 'bearish') {
        if (b2.high < b0.low) {
          const gapSize = b0.low - b2.high;
          const priceLow = b2.high;
          const priceHigh = b0.low;
          if (gapSize >= 1.0 && priceLow >= priceMin && priceHigh <= priceMax) {
            candidates.push(makeEvent({
              type: 'fvg',
              direction: 'bearish',
              time: b1.time,
              timeStart: b0.time,
              timeEnd: b2.time,
              priceHigh: priceHigh,
              priceLow: priceLow,
              barIndex: i - 1,
              gapSize: gapSize,
              properties: {
                originBarIndex: i - 2,
                middleBarIndex: i - 1,
                confirmationBarIndex: i,
                gapSize: gapSize
              }
            }));
          }
        }
      }
    }

    return candidates;
  }

  detectIFVGCandidates(bars, options = {}) {
    const fvgs = this.detectFVGCandidates(bars, options);
    const candidates = [];

    fvgs.sort((a, b) => a.barIndex - b.barIndex);
    
    let fvgIdx = 0;
    const activeFVGs = []; 

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      
      // Evict stale active FVGs older than 1000 bars
      for (let k = activeFVGs.length - 1; k >= 0; k--) {
        if (i - activeFVGs[k].barIndex > 1000) {
          activeFVGs.splice(k, 1);
        }
      }

      while (fvgIdx < fvgs.length && fvgs[fvgIdx].barIndex + 2 <= i) {
        activeFVGs.push(fvgs[fvgIdx]);
        fvgIdx++;
      }
      
      for (let k = activeFVGs.length - 1; k >= 0; k--) {
        const f = activeFVGs[k];
        const fvgGapSize = f.gapSize || (f.properties && f.properties.gapSize) || (f.priceHigh - f.priceLow);
        if (f.direction === 'bullish' && bar.close < f.priceLow) {
          candidates.push(makeEvent({
            type: 'ifvg',
            direction: 'bearish',
            time: bar.time,
            timeStart: f.time,
            timeEnd: bar.time,
            priceHigh: f.priceHigh,
            priceLow: f.priceLow,
            gapSize: fvgGapSize,
            barIndex: i,
            originalFvgTime: f.time,
            impulseBody: f.impulseBody,
            impulseDir: f.impulseDir,
            properties: {
              gapSize: fvgGapSize,
              originalFvgTime: f.time,
              impulseBody: f.impulseBody,
              impulseDir: f.impulseDir
            }
          }));
          activeFVGs.splice(k, 1); 
        } else if (f.direction === 'bearish' && bar.close > f.priceHigh) {
          candidates.push(makeEvent({
            type: 'ifvg',
            direction: 'bullish',
            time: bar.time,
            timeStart: f.time,
            timeEnd: bar.time,
            priceHigh: f.priceHigh,
            priceLow: f.priceLow,
            gapSize: fvgGapSize,
            barIndex: i,
            originalFvgTime: f.time,
            impulseBody: f.impulseBody,
            impulseDir: f.impulseDir,
            properties: {
              gapSize: fvgGapSize,
              originalFvgTime: f.time,
              impulseBody: f.impulseBody,
              impulseDir: f.impulseDir
            }
          }));
          activeFVGs.splice(k, 1); 
        }
      }
    }

    return candidates;
  }
}

module.exports = ImbalanceEngine;
