/**
 * algo/engines/swingService.js
 *
 * Swing Processing Service (frozen architecture).
 * Coordinates candidate scanning, conflict resolution, sequence alternation,
 * hierarchy building, validation, and event serialization.
 *
 * PERFORMANCE MODE:
 *   - options.degreeLimit = 1  → skip hierarchy building (degree-1 only, fast path)
 *   - options.validate = true  → run the full SwingValidator checkpoint
 */

const { calculateSwingStrength } = require('../primitives');
const { scanSwingCandidates, resolveFlatRuns } = require('./swingMath');
const { resolveSequences } = require('./swingSequenceResolver');
const SwingHierarchyBuilder = require('./swingHierarchyBuilder');
const SwingValidator = require('./swingValidator');

class SwingService {
  constructor(timeframe = 1, symbol = '') {
    this.timeframe = timeframe;
    this.symbol = symbol;
  }

  /**
   * Processes raw OHLC bars to discover, resolve, and structure swings.
   * @param {object[]} bars - Raw OHLC bars
   * @param {object}   options
   *   options.degreeLimit {number} - Max degree to build (default 3, use 1 for fast path)
   *   options.validate    {boolean} - Run SwingValidator (default false)
   * @returns {object[]} Resolved swing events
   */
  detect(bars, options = {}) {
    if (!bars || bars.length === 0) return [];
    const timeframe = this.timeframe || 1;

    if (global.profiler) {
      global.profiler.incrementCounter('barsProcessed', bars.length);
    }

    const degreeLimit = options.degreeLimit !== undefined ? options.degreeLimit : 3;

    // 1. Determine window size (always 1 neighbor for 3-bar fractal on all timeframes)
    const leftLen = 1;
    const rightLen = 1;

    // 2. Scan for raw candidates using SwingMath (typed arrays — low heap cost)
    if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'scanSwingCandidates');
    const { isHighCand, isLowCand } = scanSwingCandidates(bars, leftLen, rightLen);
    if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'scanSwingCandidates');

    // 3. Resolve flat runs (typed arrays)
    if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'resolveFlatRuns');
    const { finalIndices: finalHighs, confirmIndices: confirmHighs } = resolveFlatRuns(bars, isHighCand, isLowCand, true);
    const { finalIndices: finalLows, confirmIndices: confirmLows } = resolveFlatRuns(bars, isLowCand, isHighCand, false);
    if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'resolveFlatRuns');

    // 4. Instantiate raw degree-1 swings
    if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'instantiateSwings');
    const d1Swings = [];
    for (let idx = 0; idx < bars.length; idx++) {
      if (finalHighs[idx] === 1) {
        const curr = bars[idx];
        d1Swings.push({
          id: `swing_high_${curr.time}`,
          type: 'swing_high',
          concept: 'swing',
          direction: 'bearish',
          time: curr.time,
          timestamp: curr.time,
          price: curr.high,
          priceHigh: curr.high,
          priceLow: curr.low,
          barIndex: idx,
          confirmationBar: confirmHighs[idx] + rightLen,
          timeframe: this.timeframe,
          symbol: this.symbol,
          degree: 1
        });
      }
      if (finalLows[idx] === 1) {
        const curr = bars[idx];
        d1Swings.push({
          id: `swing_low_${curr.time}`,
          type: 'swing_low',
          concept: 'swing',
          direction: 'bullish',
          time: curr.time,
          timestamp: curr.time,
          price: curr.low,
          priceHigh: curr.high,
          priceLow: curr.low,
          barIndex: idx,
          confirmationBar: confirmLows[idx] + rightLen,
          timeframe: this.timeframe,
          symbol: this.symbol,
          degree: 1
        });
      }
    }
    if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'instantiateSwings');

    // 5. Resolve sequence conflicts (Alternation, replacement, outside bars)
    if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'resolveSequences');
    const resolvedD1 = resolveSequences(d1Swings);
    if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'resolveSequences');

    let allSwings = resolvedD1;

    // 6. Build swing hierarchy (degree 2 and 3) — skipped on fast path
    if (degreeLimit > 1) {
      if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'buildHierarchy');
      const hierarchyBuilder = new SwingHierarchyBuilder();
      const structuralD1 = resolvedD1.filter(s => s.isStructural);
      const promotedSwings = hierarchyBuilder.build(structuralD1, degreeLimit);
      
      for (const ps of promotedSwings) {
        ps.isStructural = true;
        ps.renderHint = 'normal';
      }
      
      allSwings = [...resolvedD1, ...promotedSwings];
      if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'buildHierarchy');
    }

    // 7. Validate (optional, only enabled in pipeline for sync runs)
    if (options.validate) {
      if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'validate');
      const validator = new SwingValidator();
      const valResult = validator.validate(allSwings);
      if (!valResult.isValid) {
        console.warn(`[SwingService Validation Warnings] symbol=${this.symbol} tf=${this.timeframe}:`, valResult.errors.join('; '));
      }
      if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'validate');
    }

    // 8. Inject strength score and plain properties object (no lazy getter overhead)
    if (global.profiler) global.profiler.startEnginePhase('SwingEngine', timeframe, 'postProcess');
    for (let i = 0; i < allSwings.length; i++) {
      const s = allSwings[i];
      
      // Make ID unique across timeframes to prevent database primary key collisions
      s.id = `${s.id}_tf${this.timeframe}`;
      if (s.parentSwingIds) {
        s.parentSwingIds = s.parentSwingIds.map(pid => pid.includes('_tf') ? pid : `${pid}_tf${this.timeframe}`);
      }
      if (s.childSwingIds) {
        s.childSwingIds = s.childSwingIds.map(cid => cid.includes('_tf') ? cid : `${cid}_tf${this.timeframe}`);
      }

      s.strength = calculateSwingStrength(s, bars);
      s.state = 'confirmed';
      s.properties = {
        degree: s.degree,
        state: 'confirmed',
        derivedFrom: '3_bar_fractal',
        resolution: 'flat_group_last',
        parentSwingIds: s.parentSwingIds || [],
        childSwingIds: s.childSwingIds || [],
        maxStrength: s.strength,
        qualityScore: Math.min(100, s.degree * 25 + s.strength * 5),
        isStructural: s.isStructural,
        renderHint: s.renderHint || (s.isStructural ? 'normal' : 'hidden')
      };
    }
    if (global.profiler) global.profiler.endEnginePhase('SwingEngine', timeframe, 'postProcess');

    if (global.profiler) {
      global.profiler.incrementCounter('eventsProduced', allSwings.length);
    }
    return allSwings;
  }
}

module.exports = SwingService;
