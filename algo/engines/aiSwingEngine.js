/**
 * algo/engines/aiSwingEngine.js
 * Multi-factor confluence-scored swing detector (5-Factor Indicator-Free Model).
 * NO ATR, NO RSI.
 */

const BaseEngine = require('./BaseEngine');
const SwingService = require('./swingService');

class AISwingEngine extends BaseEngine {
  detect(bars, options = {}, context = {}) {
    const minScore = options.minScore !== undefined ? options.minScore : 40;
    const { preComputedSwings } = context;
    const timeframe = this.timeframe || 1;
    
    // Resolve base swing candidates (degree-1 swings)
    const swingService = new SwingService(timeframe, context.symbol || '');
    const rawSwings = preComputedSwings?.rawSwings || swingService.detect(bars, { degreeLimit: 1 });
    
    const n = bars.length;
    if (n === 0) return [];
    
    const avgVols = new Float64Array(n);

    // Precompute Average Volume (20-bar)
    let volSum = 0;
    for (let i = 0; i < n; i++) {
      volSum += bars[i].volume;
      if (i < 20) {
        avgVols[i] = volSum / (i + 1);
      } else {
        volSum -= bars[i - 20].volume;
        avgVols[i] = volSum / 20;
      }
    }

    const results = [];
    
    // Evaluate 5 factors for each candidate swing
    for (const swing of rawSwings) {
      const idx = swing.barIndex;
      if (idx < 20 || idx >= n - 1) continue;
      
      const bar = bars[idx];
      const vol = bar.volume;
      const avgVol = avgVols[idx] || 1.0;
      const pivotPrice = swing.type === 'swing_high' ? bar.high : bar.low;
      
      // 1. Fractal base (30%)
      let fractalScore = 0.5; // default 3-bar
      if (swing.type === 'swing_high') {
        const is5bar = idx >= 2 && idx < n - 2 &&
                       bars[idx - 2].high < bar.high &&
                       bars[idx - 1].high < bar.high &&
                       bars[idx + 1].high < bar.high &&
                       bars[idx + 2].high < bar.high;
        if (is5bar) fractalScore = 1.0;
      } else {
        const is5bar = idx >= 2 && idx < n - 2 &&
                       bars[idx - 2].low > bar.low &&
                       bars[idx - 1].low > bar.low &&
                       bars[idx + 1].low > bar.low &&
                       bars[idx + 2].low > bar.low;
        if (is5bar) fractalScore = 1.0;
      }
      
      // 2. Volume confirmation (20%)
      const volRatio = vol / (1.5 * avgVol);
      const volumeScore = Math.min(1.0, volRatio);
      
      // 3. Displacement (25%, percentage-based, NO ATR)
      // threshold = 0.5% of price (pivotPrice * 0.005)
      let dispScore = 0;
      const threshold = pivotPrice * 0.005;
      if (swing.type === 'swing_high') {
        const travel = bar.high - bars[idx - 2].low;
        dispScore = travel > 0 && threshold > 0 ? Math.min(1.0, travel / threshold) : 0;
      } else {
        const travel = bars[idx - 2].high - bar.low;
        dispScore = travel > 0 && threshold > 0 ? Math.min(1.0, travel / threshold) : 0;
      }
      
      // 4. BSL/SSL Sweep (15%, raw 2.0 price points, NO ATR)
      let sweepScore = 0;
      const sweepTol = 2.0;
      const lookback = Math.max(0, idx - 100);
      if (swing.type === 'swing_high') {
        let prevMax = -Infinity;
        for (let j = lookback; j < idx - 1; j++) {
          if (bars[j].high > prevMax) prevMax = bars[j].high;
        }
        if (bar.high > prevMax && bar.high - prevMax <= sweepTol) {
          sweepScore = 1.0;
        }
      } else {
        let prevMin = Infinity;
        for (let j = lookback; j < idx - 1; j++) {
          if (bars[j].low < prevMin) prevMin = bars[j].low;
        }
        if (bar.low < prevMin && prevMin - bar.low <= sweepTol) {
          sweepScore = 1.0;
        }
      }
      
      // 5. Session Weighting (5%)
      const date = new Date(bar.time * 1000);
      const utcHour = date.getUTCHours();
      const utcMinute = date.getUTCMinutes();
      const utcTimeDecimal = utcHour + utcMinute / 60;
      
      let sessionScore = 0;
      if ((utcTimeDecimal >= 7 && utcTimeDecimal <= 10) || (utcTimeDecimal >= 13.5 && utcTimeDecimal <= 16)) {
        sessionScore = 1.0;
      }
      
      // 6. HTF Alignment (5%)
      let htfAlignmentScore = 0;
      const htfSwings = context.preComputedSwingsHTF || [];
      if (htfSwings.length > 0) {
        let lastHtf = null;
        for (let j = htfSwings.length - 1; j >= 0; j--) {
          if (htfSwings[j].time <= bar.time) {
            lastHtf = htfSwings[j];
            break;
          }
        }
        if (lastHtf && lastHtf.type === swing.type) {
          htfAlignmentScore = 1.0;
        }
      }
      
      // Calculate final score using the 5-factor weights
      const finalScore = 100 * (
        0.30 * fractalScore +
        0.20 * volumeScore +
        0.25 * dispScore +
        0.15 * sweepScore +
        0.05 * sessionScore +
        0.05 * htfAlignmentScore
      );
      
      if (finalScore >= minScore) {
        const confidence = finalScore >= 80 ? 'very_high' : finalScore >= 60 ? 'high' : 'medium';
        
        results.push({
          id: swing.id || `ai_swing_${swing.type}_${bar.time}`,
          type: swing.type,
          time: bar.time,
          timeStart: bar.time,
          timeEnd: swing.timeEnd || null,
          priceHigh: swing.priceHigh || bar.high,
          priceLow: swing.priceLow || bar.low,
          direction: swing.direction,
          barIndex: idx,
          properties: {
            ...swing.properties,
            ai_score: Math.round(finalScore),
            ai_confidence: confidence,
            factors: {
              fractal: Math.round(fractalScore * 100),
              volume: Math.round(volumeScore * 100),
              displacement: Math.round(dispScore * 100),
              sweep: Math.round(sweepScore * 100),
              session: Math.round(sessionScore * 100),
              htf: Math.round(htfAlignmentScore * 100)
            }
          }
        });
      }
    }
    
    return results;
  }

  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  validate(event) {
    return { isValid: true, reason: "" };
  }

  serialize(event) {
    return {
      event_id: event.id,
      root_event_id: null,
      parent_event_id: null,
      detector_id: 'AI_SWING_v1',
      symbol: event.symbol || '',
      timeframe: event.timeframe || 1,
      concept_family: 'Swings',
      concept_type: 'AISwing',
      concept_state: 'active',
      time_start: event.time,
      time_end: event.timeEnd || null,
      price_high: event.priceHigh,
      price_low: event.priceLow,
      direction: event.direction,
      properties: JSON.stringify(event.properties || {})
    };
  }
}

module.exports = AISwingEngine;
