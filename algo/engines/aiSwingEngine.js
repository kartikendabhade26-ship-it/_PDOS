/**
 * algo/engines/aiSwingEngine.js
 * Multi-factor confluence-scored swing detector.
 * Evaluates 7 confluent indicators for each mathematical swing high/low.
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
    
    const atrs = new Float64Array(n);
    const rsis = new Float64Array(n);
    const avgVols = new Float64Array(n);
    
    // Precompute ATR-14
    let sumTr = 0;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      );
      if (i < 14) {
        sumTr += tr;
        atrs[i] = 10.0;
      } else {
        if (i === 14) {
          sumTr += tr;
          atrs[i] = sumTr / 14;
        } else {
          atrs[i] = (atrs[i - 1] * 13 + tr) / 14;
        }
      }
    }
    atrs[0] = atrs[1] || 10.0;
    for (let i = 1; i < 14; i++) atrs[i] = atrs[14];

    // Precompute Average Volume
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

    // Precompute RSI-14
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i < n; i++) {
      const change = bars[i].close - bars[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      if (i < 14) {
        avgGain += gain;
        avgLoss += loss;
        rsis[i] = 50.0;
      } else if (i === 14) {
        avgGain = (avgGain + gain) / 14;
        avgLoss = (avgLoss + loss) / 14;
        rsis[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      } else {
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
        rsis[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      }
    }
    rsis[0] = 50.0;
    for (let i = 1; i < 14; i++) rsis[i] = rsis[14];

    const results = [];
    
    // Evaluate 7 factors for each candidate swing
    for (const swing of rawSwings) {
      const idx = swing.barIndex;
      if (idx < 20 || idx >= n - 1) continue;
      
      const bar = bars[idx];
      const atr = atrs[idx] || 10.0;
      const vol = bar.volume;
      const avgVol = avgVols[idx] || 1.0;
      
      // 1. Fractal base (25%)
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
      
      // 2. Volume confirmation (15%)
      const volRatio = vol / (1.5 * avgVol);
      const volumeScore = Math.min(1.0, volRatio);
      
      // 3. Displacement (20%)
      let displacementScore = 0;
      if (swing.type === 'swing_high') {
        const bodyLow = Math.min(bar.open, bar.close);
        const wickHigh = bar.high - bodyLow;
        displacementScore = Math.min(1.0, wickHigh / atr);
      } else {
        const bodyHigh = Math.max(bar.open, bar.close);
        const wickLow = bodyHigh - bar.low;
        displacementScore = Math.min(1.0, wickLow / atr);
      }
      
      // 4. BSL/SSL Sweep (15%)
      let sweepScore = 0;
      const lookback = Math.max(0, idx - 100);
      if (swing.type === 'swing_high') {
        let prevMax = -Infinity;
        for (let j = lookback; j < idx - 1; j++) {
          if (bars[j].high > prevMax) prevMax = bars[j].high;
        }
        if (bar.high > prevMax && bar.high - prevMax <= 0.1 * atr) {
          sweepScore = 1.0;
        }
      } else {
        let prevMin = Infinity;
        for (let j = lookback; j < idx - 1; j++) {
          if (bars[j].low < prevMin) prevMin = bars[j].low;
        }
        if (bar.low < prevMin && prevMin - bar.low <= 0.1 * atr) {
          sweepScore = 1.0;
        }
      }
      
      // 5. RSI Divergence (10%)
      let rsiDivergenceScore = 0;
      const currentRsi = rsis[idx];
      if (swing.type === 'swing_high') {
        let priorHighIdx = -1;
        for (let j = idx - 1; j >= lookback; j--) {
          if (rawSwings.find(s => s.barIndex === j && s.type === 'swing_high')) {
            priorHighIdx = j;
            break;
          }
        }
        if (priorHighIdx !== -1 && bar.high > bars[priorHighIdx].high && currentRsi < rsis[priorHighIdx]) {
          rsiDivergenceScore = 1.0;
        }
      } else {
        let priorLowIdx = -1;
        for (let j = idx - 1; j >= lookback; j--) {
          if (rawSwings.find(s => s.barIndex === j && s.type === 'swing_low')) {
            priorLowIdx = j;
            break;
          }
        }
        if (priorLowIdx !== -1 && bar.low < bars[priorLowIdx].low && currentRsi > rsis[priorLowIdx]) {
          rsiDivergenceScore = 1.0;
        }
      }
      
      // 6. Session Weighting (5%)
      const date = new Date(bar.time * 1000);
      const utcHour = date.getUTCHours();
      const utcMinute = date.getUTCMinutes();
      const utcTimeDecimal = utcHour + utcMinute / 60;
      
      let sessionScore = 0;
      if ((utcTimeDecimal >= 7 && utcTimeDecimal <= 10) || (utcTimeDecimal >= 13.5 && utcTimeDecimal <= 16)) {
        sessionScore = 1.0;
      }
      
      // 7. HTF Alignment (10%)
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
      
      // Calculate final score
      const finalScore = 100 * (
        0.25 * fractalScore +
        0.15 * volumeScore +
        0.20 * displacementScore +
        0.15 * sweepScore +
        0.10 * rsiDivergenceScore +
        0.05 * sessionScore +
        0.10 * htfAlignmentScore
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
              displacement: Math.round(displacementScore * 100),
              sweep: Math.round(sweepScore * 100),
              rsi: Math.round(rsiDivergenceScore * 100),
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
