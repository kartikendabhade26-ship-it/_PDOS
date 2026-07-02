const RegistryService = require('./RegistryService');
const { getDB } = require('./db');
const logger = require('./logger');
const { getCandidates } = require('./detector');
const { captureEventContext, findIndexUpTo, precomputeRollingMaxMin, precomputeSMA } = require('./contextEngine');
const { findSwings } = require('./primitives');
const NarrativeContextEngine = require('./engines/narrativeContextEngine');
const PDArrayContextEngine = require('./engines/pdArrayContextEngine');
const SwingService = require('./engines/swingService');
const { makeEvent } = require('./eventSchema');
const { getESTOffset } = require('./utils/math/time');

const pdArrayContextEngine = new PDArrayContextEngine();


/**
 * Standard bar aggregation helper (1m -> higher timeframes)
 */
function aggregate(rawBars, tfMinutes) {
  if (tfMinutes <= 1) return rawBars;
  const stepSeconds = tfMinutes * 60;
  const aggregated = [];
  if (rawBars.length === 0) return aggregated;

  let currentAgg = null;
  let currentBucket = -1;

  for (let i = 0; i < rawBars.length; i++) {
    const bar = rawBars[i];
    const bucket = Math.floor(bar.time / stepSeconds) * stepSeconds;

    if (bucket !== currentBucket) {
      if (currentAgg) {
        aggregated.push(currentAgg);
      }
      currentBucket = bucket;
      currentAgg = {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      };
    } else {
      if (bar.high > currentAgg.high) currentAgg.high = bar.high;
      if (bar.low < currentAgg.low) currentAgg.low = bar.low;
      currentAgg.close = bar.close;
      currentAgg.volume += bar.volume;
    }
  }
  if (currentAgg) {
    aggregated.push(currentAgg);
  }
  return aggregated;
}

/**
 * Computes high-precision outcomes for a structure event.
 * Measures: MFE, MAE, Time to target, Time to failure, Mitigation, and FVG Fill status.
 * Evaluates everything on high-resolution 1m bars by resolving time start index.
 */
function analyzeEventOutcome(event, bars, start1mIdx, lookahead = 1000) {
  const { type, direction, priceHigh, priceLow, time } = event;
  
  if (start1mIdx === undefined || start1mIdx === null || start1mIdx === -1) {
    start1mIdx = findIndexUpTo(bars, time);
  }
  if (start1mIdx === -1) {
    return {
      is_mitigated: 0,
      mitigation_time: null,
      mitigation_price: null,
      time_to_mitigation: null,
      mfe: 0.0,
      mae: 0.0,
      time_to_target: null,
      time_to_failure: null,
      fvg_fill_percent: 0.0,
      is_valid: 1
    };
  }

  const startIdx = start1mIdx + 1;
  const endIdx = Math.min(bars.length - 1, start1mIdx + lookahead);
  
  const midPrice = (priceHigh + priceLow) / 2;
  const zoneSize = priceHigh - priceLow || 1.0;
  
  let isMitigated = 0;
  let mitigationTime = null;
  let mitigationPrice = null;
  let timeToMitigation = null;
  
  let mfe = 0.0;
  let mae = 0.0;
  let timeToTarget = null;
  let timeToFailure = null;
  let isValid = 1;
  let fvgFillPercent = 0.0;
  
  const entryPrice = midPrice;
  const targetPrice = direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh'
    ? entryPrice + 3 * zoneSize 
    : entryPrice - 3 * zoneSize;
  const invalidationLevel = direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh'
    ? priceLow 
    : priceHigh;

  let maxFavorablePrice = entryPrice;
  let maxAdversePrice = entryPrice;

  for (let i = startIdx; i <= endIdx; i++) {
    const bar = bars[i];
    if (!bar) continue;

    // Check invalidation / failure
    if (isValid === 1) {
      if ((direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh') && bar.close < invalidationLevel) {
        isValid = 0;
        timeToFailure = i - start1mIdx;
      } else if ((direction === 'bearish' || direction === 'ssl' || direction === 'eql' || direction === 'reql') && bar.close > invalidationLevel) {
        isValid = 0;
        timeToFailure = i - start1mIdx;
      }
    }

    // Check mitigation / touch
    if (isMitigated === 0) {
      const touched = bar.low <= priceHigh && bar.high >= priceLow;
      if (touched) {
        isMitigated = 1;
        mitigationTime = bar.time;
        mitigationPrice = bar.close;
        timeToMitigation = i - start1mIdx;
      }
    }

    // Track MFE & MAE before invalidation
    if (isValid === 1) {
      if (direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh') {
        if (bar.high > maxFavorablePrice) {
          maxFavorablePrice = bar.high;
        }
        if (bar.low < maxAdversePrice) {
          maxAdversePrice = bar.low;
        }
        const fill = ((priceHigh - bar.low) / zoneSize) * 100;
        if (fill > fvgFillPercent) fvgFillPercent = Math.min(100.0, fill);
      } else {
        if (bar.low < maxFavorablePrice) {
          maxFavorablePrice = bar.low;
        }
        if (bar.high > maxAdversePrice) {
          maxAdversePrice = bar.high;
        }
        const fill = ((bar.high - priceLow) / zoneSize) * 100;
        if (fill > fvgFillPercent) fvgFillPercent = Math.min(100.0, fill);
      }

      // Check target hit
      if (timeToTarget === null) {
        const targetHit = direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh'
          ? bar.high >= targetPrice
          : bar.low <= targetPrice;
        if (targetHit) {
          timeToTarget = i - start1mIdx;
        }
      }
    }

    if (isValid === 0) {
      break;
    }
  }

  if (direction === 'bullish' || direction === 'bsl' || direction === 'eqh' || direction === 'reqh') {
    mfe = maxFavorablePrice - entryPrice;
    mae = entryPrice - maxAdversePrice;
  } else {
    mfe = entryPrice - maxFavorablePrice;
    mae = maxAdversePrice - entryPrice;
  }

  return {
    is_mitigated: isMitigated,
    mitigation_time: mitigationTime,
    mitigation_price: mitigationPrice,
    time_to_mitigation: timeToMitigation,
    mfe: Math.max(0, mfe),
    mae: Math.max(0, mae),
    time_to_target: timeToTarget,
    time_to_failure: timeToFailure,
    fvg_fill_percent: type === 'fvg' ? Math.max(0, fvgFillPercent) : 0.0,
    is_valid: isValid
  };
}

function getEmptyOutcome() {
  return {
    is_mitigated: 0,
    mitigation_time: null,
    mitigation_price: null,
    time_to_mitigation: null,
    mfe: 0.0,
    mae: 0.0,
    time_to_target: null,
    time_to_failure: null,
    fvg_fill_percent: 0.0,
    is_valid: 1
  };
}

/**
 * Runs the sync pipeline for a given symbol.
 * Detects events across multiple timeframes, runs the Market Context Engine, runs outcomes,
 * establishes parent-child nesting chains, and saves to DB in transactions.
 */
async function syncSymbolPipeline(symbol, rawBars, runId = 'run_legacy', chunkInfo = null, progressCallback = null) {
  const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
  logger.info('PIPELINE', `Starting sync pipeline for symbol: ${symbol} (${rawBars.length} bars) (Run: ${runId})`);
  const t0 = Date.now();

  // Clear existing run data to prevent duplication on restart
  if (!chunkInfo) {
    RegistryService.clearRunData(dbName, runId);
    RegistryService.deleteBars(dbName, symbol);
  }

  const stageTimings = {
    aggregation: 0,
    detection: 0,
    filtering: 0,
    processing: 0,
    dbWrite: 0
  };
  const stageCounts = {
    eventsCreated: 0,
    outcomesComputed: 0,
    contextsCaptured: 0,
    relationshipsBuilt: 0
  };
  
  // 1. Pre-aggregate bars
  const tAggregationStart = Date.now();
  logger.info('PIPELINE', `Pre-aggregating bars...`);
  const preAggregated = {
    tf5Bars: aggregate(rawBars, 5),
    tf15Bars: aggregate(rawBars, 15),
    tf60Bars: aggregate(rawBars, 60),
    tf240Bars: aggregate(rawBars, 240),
    tf1440Bars: aggregate(rawBars, 1440)
  };
  logger.info('PIPELINE', `Pre-aggregation completed. 5m=${preAggregated.tf5Bars.length}, 15m=${preAggregated.tf15Bars.length}, 1H=${preAggregated.tf60Bars.length}, 4H=${preAggregated.tf240Bars.length}, 1D=${preAggregated.tf1440Bars.length}`);
  stageTimings.aggregation = Date.now() - tAggregationStart;

  // Insert bars into SQLite market_bars table
  logger.info('PIPELINE', 'Writing market bars to database...');
  const tBarsWriteStart = Date.now();

  RegistryService.executeInTransaction((tx) => {
    // 1. Insert 1m bars
    const filtered1m = [];
    for (let j = 0; j < rawBars.length; j++) {
      const b = rawBars[j];
      const absIdx = chunkInfo ? (j + chunkInfo.primeStart) : j;
      if (chunkInfo && (absIdx < chunkInfo.idxStart || absIdx > chunkInfo.idxEnd)) {
        continue; // Skip carry-over priming buffer
      }
      filtered1m.push(b);
    }
    RegistryService.insertBars(dbName, symbol, 1, filtered1m);

    // 2. Insert HTF bars
    const timeframesList = [
      { tf: 5, bars: preAggregated.tf5Bars },
      { tf: 15, bars: preAggregated.tf15Bars },
      { tf: 60, bars: preAggregated.tf60Bars },
      { tf: 240, bars: preAggregated.tf240Bars },
      { tf: 1440, bars: preAggregated.tf1440Bars }
    ];

    let tStart = 0;
    let tEnd = Infinity;
    if (chunkInfo) {
      tStart = rawBars[chunkInfo.idxStart - chunkInfo.primeStart].time;
      tEnd = rawBars[chunkInfo.idxEnd - chunkInfo.primeStart].time;
    }

    for (const tfObj of timeframesList) {
      const filteredHtf = [];
      for (let j = 0; j < tfObj.bars.length; j++) {
        const b = tfObj.bars[j];
        if (chunkInfo && (b.time < tStart || b.time > tEnd)) {
          continue; // Skip HTF bars outside chunk boundaries
        }
        filteredHtf.push(b);
      }
      RegistryService.insertBars(dbName, symbol, tfObj.tf, filteredHtf);
    }
  }, dbName);
  logger.info('PIPELINE', `Finished writing market bars to database in ${((Date.now() - tBarsWriteStart) / 1000).toFixed(2)}s.`);

  const concepts = [
    'swing_bullish', 'swing_bearish',
    'liquidity_bsl', 'liquidity_ssl',
    'liquidity_interaction',
    'price_delivery',
    'structure_confirm',
    'dealing_range'
  ];

  // Timeframes list to run candidate detectors on
  const timeframes = [
    { tf: 1, bars: rawBars },
    { tf: 5, bars: preAggregated.tf5Bars },
    { tf: 15, bars: preAggregated.tf15Bars },
    { tf: 60, bars: preAggregated.tf60Bars },
    { tf: 240, bars: preAggregated.tf240Bars },
    { tf: 1440, bars: preAggregated.tf1440Bars }
  ];

  // 2. Detect all events across timeframes
  const tDetectionStart = Date.now();
  logger.info('PIPELINE', `Running candidate detectors across 6 timeframes...`);
  const allEvents = [];
  const cacheObj = new Map();
  
  const baseConcepts = concepts.filter(c => 
    !c.startsWith('fvg') &&
    !c.startsWith('ifvg') &&
    !c.startsWith('ob') &&
    !c.startsWith('breaker') &&
    !c.startsWith('volume_imbalance') &&
    !c.startsWith('liquidity_void')
  );

  // Window sizes per timeframe for findSwingsWindowed.
  // 1m uses the original 3-bar fractal (leftLen=1, rightLen=1) for maximum granularity —
  // every local pivot visible to the eye is captured.
  // Higher timeframes use progressively wider windows for cleaner structural pivots.
  for (const t of timeframes) {
    const swingService = new SwingService(t.tf, symbol);
    const resolvedSwings = swingService.detect(t.bars, { validate: true });
    const structuralHighs = resolvedSwings.filter(s => s.type === 'swing_high' && s.isStructural);
    const structuralLows = resolvedSwings.filter(s => s.type === 'swing_low' && s.isStructural);
    const structuralSwings = resolvedSwings.filter(s => s.isStructural);
    const preSwings = {
      swingHighs: structuralHighs,
      swingLows: structuralLows,
      allSwings: structuralSwings,
      rawSwings: resolvedSwings
    };
    
    // First pass: Detect base structural events
    for (const concept of baseConcepts) {
      const limit = 50000; // Large enough to keep all events in 35MB window, small enough to prevent database bloating
      const candidates = getCandidates(concept, t.bars, limit, preSwings, symbol, cacheObj); 
      for (const c of candidates) {
        let conceptName = concept.split('_')[0];
        if (concept.startsWith('liquidity_interaction')) {
          conceptName = 'liquidity_interaction';
        } else if (concept.startsWith('dealing_range')) {
          conceptName = 'dealing_range';
        } else if (concept.startsWith('price_delivery')) {
          conceptName = 'price_delivery';
        } else if (concept.startsWith('structure_confirm')) {
          conceptName = 'structure_confirm';
        }

        const eventId = c.id || `${conceptName}_${c.direction}_${c.time}_tf${t.tf}`;
        let detectorId = conceptName.toUpperCase() + '_v1';
        if (concept.startsWith('liquidity_interaction')) {
          detectorId = 'LIQUIDITY_INTERACTION_v1';
        } else if (concept.startsWith('dealing_range')) {
          detectorId = 'DEALING_RANGE_v2';
        } else if (concept.startsWith('price_delivery')) {
          detectorId = 'PRICE_DELIVERY_v1';
        } else if (concept.startsWith('structure_confirm')) {
          detectorId = 'STRUCTURE_CONFIRMATION_v1';
        } else if (conceptName === 'swing' && c.degree > 1) {
          detectorId = 'SWING_HIERARCHY_v1';
        }
        
        allEvents.push({
          ...c,
          id: eventId,
          detectorId,
          concept: conceptName,
          timeframe: t.tf,
          symbol
        });
      }
    }

    // Second pass: Context-driven downstream array detection
    const tfRanges = allEvents.filter(e => e.timeframe === t.tf && e.concept === 'dealing_range');
    tfRanges.sort((a, b) => b.time - a.time);
    const activeRange = tfRanges.find(r => r.state === 'developing') || tfRanges[0];

    if (activeRange) {
      const searchReq = pdArrayContextEngine.determineSearchRequest(activeRange, t.bars);
      if (searchReq) {
        const constrainedConcepts = [
          'fvg_bullish', 'fvg_bearish',
          'ob_bullish', 'ob_bearish',
          'breaker_bullish', 'breaker_bearish'
        ];
        const detectedArrays = [];
        for (const concept of constrainedConcepts) {
          const limit = 50000; // Large enough to keep all events in 35MB window, small enough to prevent database bloating
          const candidates = getCandidates(concept, t.bars, limit, preSwings, symbol, cacheObj, searchReq);
          
          for (const c of candidates) {
            let conceptName = concept.split('_')[0];
            if (concept.startsWith('volume_imbalance')) {
              conceptName = 'volume';
            } else if (concept.startsWith('liquidity_void')) {
              conceptName = 'liquidity';
            }
            
            const eventId = c.id || `${conceptName}_${c.direction}_${c.time}_tf${t.tf}`;
            let detectorId = conceptName.toUpperCase() + '_v1';
            if (concept.startsWith('volume_imbalance')) {
              detectorId = 'VOLUME_IMBALANCE_v1';
            } else if (concept.startsWith('liquidity_void')) {
              detectorId = 'LIQUIDITY_VOID_v1';
            } else if (concept.startsWith('breaker')) {
              detectorId = 'BREAKER_v1';
            }
            
            detectedArrays.push({
              ...c,
              id: eventId,
              detectorId,
              concept: conceptName,
              timeframe: t.tf,
              symbol
            });
          }
        }

        const rankedArrays = pdArrayContextEngine.rankAndFilterArrays(detectedArrays, searchReq);
        allEvents.push(...rankedArrays);

        // Compile the PD_ARRAY_MATRIX event
        const activePdArrayIds = rankedArrays.map(arr => arr.id);
        const matrixProperties = {
          activeRangeId: activeRange.id,
          activeQuadrant: searchReq.activeQuadrant,
          narrativeState: searchReq.narrativeState,
          activePdArrays: activePdArrayIds,
          equilibrium: searchReq.equilibrium,
          currentPrice: searchReq.currentPrice
        };

        const matrixEvent = makeEvent({
          id: `pd_matrix_${activeRange.id}`,
          type: 'pd_array_matrix',
          direction: activeRange.direction,
          time: activeRange.time,
          timeStart: activeRange.timeStart,
          timeEnd: activeRange.timeEnd,
          priceHigh: activeRange.priceHigh,
          priceLow: activeRange.priceLow,
          barIndex: activeRange.barIndex,
          symbol,
          timeframe: t.tf,
          state: activeRange.state,
          createdBy: activeRange.id,
          validatedBy: activeRange.validatedBy,
          lifecycleState: activeRange.state,
          narrativeRole: 'container',
          properties: matrixProperties
        });

        allEvents.push({
          ...matrixEvent,
          detectorId: 'PD_ARRAY_CONTEXT_v1',
          concept: 'pd_array_matrix',
          timeframe: t.tf,
          symbol
        });
      }
    }
  }

  stageTimings.detection = Date.now() - tDetectionStart;

  const tFilteringStart = Date.now();
  // Sort events chronologically so the Context Engine and MTF nesting search can look backward.
  // For identical timestamps, process Swings first, then Liquidity, then others.
  allEvents.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    const getPriority = (concept) => {
      if (concept === 'swing' || concept === 'strong_swing') return 1;
      if (concept === 'liquidity') return 2;
      if (concept === 'fvg' || concept === 'ifvg' || concept === 'ob' || concept === 'volume' || concept === 'liquidity_void') return 3;
      return 4;
    };
    return getPriority(a.concept) - getPriority(b.concept);
  });

  // Pre-resolve bar indices for all events to avoid O(E log N) binary searches in loops
  logger.info('PIPELINE', 'Pre-resolving 1m and HTF bar indices for all events...');
  const tfBars = {
    5: preAggregated.tf5Bars,
    15: preAggregated.tf15Bars,
    60: preAggregated.tf60Bars,
    240: preAggregated.tf240Bars,
    1440: preAggregated.tf1440Bars
  };
  const tfPointers = { 5: 0, 15: 0, 60: 0, 240: 0, 1440: 0 };
  let barIdx = 0;
  for (let k = 0; k < allEvents.length; k++) {
    const e = allEvents[k];
    
    // Resolve 1m index
    while (barIdx < rawBars.length && rawBars[barIdx].time <= e.time) {
      barIdx++;
    }
    e.barIndex1m = barIdx - 1;
    
    // Resolve HTF indices
    e.tfBarIndices = {};
    for (const tf of [5, 15, 60, 240, 1440]) {
      const barsList = tfBars[tf];
      let p = tfPointers[tf];
      while (p < barsList.length && barsList[p].time <= e.time) {
        p++;
      }
      e.tfBarIndices[tf] = p - 1;
      tfPointers[tf] = Math.max(0, p - 1);
    }
  }
  logger.info('PIPELINE', 'Finished pre-resolving bar indices.');
  
  // 3. Pre-filter events by type for O(log E) binary searches in Context Engine
  // Note: These searches are resolved on 1m timeframe events for context lookups
  const oneMinEvents = allEvents.filter(e => e.timeframe === 1);
  const preFilteredEvents = {
    allEvents: allEvents,
    swingHighs: oneMinEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.isStructural !== false),
    swingLows: oneMinEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.isStructural !== false),
    fvgs: oneMinEvents.filter(e => e.concept === 'fvg'),
    bosMss: oneMinEvents.filter(e => e.concept === 'bos' || e.concept === 'mss'),
    swingsBearish: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.isStructural !== false),
    swingsBullish: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.isStructural !== false),
    liquidity: allEvents.filter(e => e.concept === 'liquidity'),
    fvgsAll: allEvents.filter(e => e.concept === 'fvg'),
    bosMssAll: allEvents.filter(e => e.concept === 'bos' || e.concept === 'mss'),
    voidsAll: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1'),
    viAll: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1'),
    
    // Timeframe-specific groups
    bosMssByTf: {
      1: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 1),
      5: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 5),
      15: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 15),
      60: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 60),
      240: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 240),
      1440: allEvents.filter(e => (e.concept === 'bos' || e.concept === 'mss') && e.timeframe === 1440)
    },
    swingsBearishByTf: {
      1: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 1 && e.isStructural !== false),
      5: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 5 && e.isStructural !== false),
      15: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 15 && e.isStructural !== false),
      60: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 60 && e.isStructural !== false),
      240: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 240 && e.isStructural !== false),
      1440: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bearish' && e.timeframe === 1440 && e.isStructural !== false)
    },
    swingsBullishByTf: {
      1: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 1 && e.isStructural !== false),
      5: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 5 && e.isStructural !== false),
      15: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 15 && e.isStructural !== false),
      60: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 60 && e.isStructural !== false),
      240: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 240 && e.isStructural !== false),
      1440: allEvents.filter(e => e.concept === 'swing' && e.direction === 'bullish' && e.timeframe === 1440 && e.isStructural !== false)
    },
    fvgsByTf: {
      1: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 1),
      5: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 5),
      15: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 15),
      60: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 60),
      240: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 240),
      1440: allEvents.filter(e => e.concept === 'fvg' && e.timeframe === 1440)
    },
    voidsByTf: {
      1: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 1),
      5: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 5),
      15: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 15),
      60: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 60),
      240: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 240),
      1440: allEvents.filter(e => e.detectorId === 'LIQUIDITY_VOID_v1' && e.timeframe === 1440)
    },
    viByTf: {
      1: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 1),
      5: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 5),
      15: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 15),
      60: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 60),
      240: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 240),
      1440: allEvents.filter(e => e.detectorId === 'VOLUME_IMBALANCE_v1' && e.timeframe === 1440)
    },
    
    // Liquidity grouped by direction
    liquidityBsl: allEvents.filter(e => e.concept === 'liquidity' && (e.direction === 'bsl' || e.direction === 'eqh' || e.direction === 'reqh')),
    liquiditySsl: allEvents.filter(e => e.concept === 'liquidity' && (e.direction === 'ssl' || e.direction === 'eql' || e.direction === 'reql'))
  };
  
  console.log(`[Pipeline] Pre-filtered events for search optimization.`);
  console.log(`[Pipeline] Precomputing rolling daily/weekly max/min...`);
  const dailyRolling = precomputeRollingMaxMin(rawBars, 1440);
  const weeklyRolling = precomputeRollingMaxMin(rawBars, 7200);
  const rollingCache = {
    dailyMaxs: dailyRolling.maxs,
    dailyMins: dailyRolling.mins,
    weeklyMaxs: weeklyRolling.maxs,
    weeklyMins: weeklyRolling.mins,
    
    // Precompute SMA 50 arrays for all timeframes
    sma1m: precomputeSMA(rawBars, 50),
    sma5m: precomputeSMA(preAggregated.tf5Bars, 50),
    sma15m: precomputeSMA(preAggregated.tf15Bars, 50),
    sma60m: precomputeSMA(preAggregated.tf60Bars, 50),
    sma240m: precomputeSMA(preAggregated.tf240Bars, 50),
    sma1440m: precomputeSMA(preAggregated.tf1440Bars, 50)
  };
  stageTimings.filtering = Date.now() - tFilteringStart;

  const tProcessingStart = Date.now();
  let totalDbWriteTime = 0;
  console.log(`[Pipeline] Processing ${allEvents.length} total events. Running Context Engine & Outcomes...`);

  const insertEvent = {
    run: (...args) => {
      const e = {
        event_id: args[1],
        root_event_id: args[2],
        parent_event_id: args[3],
        detector_id: args[4],
        symbol: args[5],
        timeframe: args[6],
        concept_family: args[7],
        concept_type: args[8],
        concept_state: args[9],
        time_start: args[10],
        time_end: args[11],
        price_high: args[12],
        price_low: args[13],
        direction: args[14],
        properties: args[15]
      };
      RegistryService.insertEvents(dbName, args[0], [e]);
    }
  };

  const insertOutcome = {
    run: (...args) => {
      const o = {
        event_id: args[1],
        is_mitigated: args[2],
        mitigation_time: args[3],
        mitigation_price: args[4],
        mfe: args[5],
        mae: args[6],
        time_to_mitigation: args[7],
        time_to_failure: args[8],
        time_to_target: args[9],
        fvg_fill_percent: args[10],
        is_valid: args[11]
      };
      RegistryService.insertOutcomes(dbName, args[0], [o]);
    }
  };

  const insertContext = {
    run: (...args) => {
      const c = {
        event_id: args[1],
        symbol: args[2],
        timeframe: args[3],
        time_year: args[4],
        time_quarter: args[5],
        time_month: args[6],
        time_weekday: args[7],
        time_session: args[8],
        time_hour: args[9],
        price_daily_range_pct: args[10],
        price_atr_14: args[11],
        price_volatility_regime: args[12],
        price_premium_discount_status: args[13],
        price_dist_daily_high: args[14],
        price_dist_daily_low: args[15],
        price_dist_weekly_high: args[16],
        price_dist_weekly_low: args[17],
        structure_bias_1m: args[18],
        structure_bias_5m: args[19],
        structure_bias_15m: args[20],
        structure_bias_1h: args[21],
        structure_bias_4h: args[22],
        structure_bias_daily: args[23],
        htf_structure_event_id: args[24],
        ltf_structure_event_id: args[25],
        nearest_htf_high: args[26],
        nearest_htf_low: args[27],
        liq_closest_above: args[28],
        liq_closest_below: args[29],
        liq_dist_to_above: args[30],
        liq_dist_to_below: args[31],
        liq_eq_high_present: args[32],
        liq_eq_low_present: args[33],
        nearest_bsl_price: args[34],
        nearest_bsl_event_id: args[35],
        nearest_ssl_price: args[36],
        nearest_ssl_event_id: args[37],
        fvg_size: args[38],
        fvg_atr_ratio: args[39],
        fvg_age: args[40],
        fvg_untouched_nearby_count: args[41],
        nearest_fvg_price: args[42],
        nearest_fvg_event_id: args[43],
        nearest_void_price: args[44],
        nearest_void_event_id: args[45],
        nearest_volume_imbalance_price: args[46],
        nearest_volume_imbalance_event_id: args[47],
        flow_before_mss: args[48],
        flow_after_mss: args[49],
        flow_before_bos: args[50],
        flow_after_bos: args[51],
        flow_sweep_occurred: args[52],
        flow_no_sweep: args[53],
        session_asia: args[54],
        session_london: args[55],
        session_ny: args[56],
        session_ny_am: args[57],
        session_ny_pm: args[58],
        outcome_mfe: args[59],
        outcome_mae: args[60],
        outcome_time_to_mitigation: args[61],
        outcome_time_to_failure: args[62],
        outcome_time_to_target: args[63]
      };
      RegistryService.insertContexts(dbName, args[0], [c]);
    }
  };

  const updateParentState = {
    run: (...args) => {
      RegistryService.updateEventState(dbName, args[1], args[2], 'failed', args[0]);
    }
  };

  const insertRelationship = {
    run: (...args) => {
      const r = {
        parent_event_id: args[1],
        child_event_id: args[2],
        relationship_type: args[3]
      };
      RegistryService.insertRelationships(dbName, args[0], [r]);
    }
  };

  const insertLiquidity = {
    run: (...args) => {
      const l = {
        liquidity_id: args[1],
        parent_swing_id: args[2],
        price: args[3],
        parent_swing_type: args[4],
        liquidity_side: args[5],
        swing_degree: args[6],
        timeframe: args[7],
        symbol: args[8],
        origin_bar_index: args[9],
        confirmation_bar_index: args[10],
        origin_timestamp: args[11],
        metadata: args[12]
      };
      RegistryService.insertLiquidityObjects(dbName, args[0], [l]);
    }
  };

  // Rolling queue of events to check spatial nesting grouped by timeframe
  const recentEventsByTf = {
    1: [],
    5: [],
    15: [],
    60: [],
    240: [],
    1440: []
  };
  const insertedEventIds = new Set();
  let processedCount = 0;
  const CHUNK_SIZE = 5000;
  const totalEvents = allEvents.length;

  for (let i = 0; i < totalEvents; i += CHUNK_SIZE) {
    const chunk = allEvents.slice(i, i + CHUNK_SIZE);

    const tChunkDbStart = Date.now();
    RegistryService.executeInTransaction(() => {
      for (const e of chunk) {
        if (chunkInfo) {
          const absIdx = e.barIndex + chunkInfo.primeStart;
          if (absIdx < chunkInfo.idxStart || absIdx > chunkInfo.idxEnd) {
            continue; // Skip priming buffer events
          }

          // Shift relative indices to absolute database coordinates
          if (e.barIndex !== undefined && e.barIndex !== null) {
            e.barIndex += chunkInfo.primeStart;
          }
          if (e.properties && e.properties.confirmationBar !== undefined && e.properties.confirmationBar !== null) {
            e.properties.confirmationBar += chunkInfo.primeStart;
          }
          if (e.confirmationBarIndex !== undefined && e.confirmationBarIndex !== null) {
            e.confirmationBarIndex += chunkInfo.primeStart;
          }
        }

        const needsContext = e.concept === 'fvg' || e.concept === 'ifvg' || e.concept === 'ob' ||
                             e.concept === 'mss' || e.concept === 'bos' || e.concept === 'liquidity' ||
                             e.concept === 'protected';

        // Map to new ICT ontology concept family and type
        let concept_family = 'Imbalances';
        let concept_type = 'BISI';
        let concept_state = 'active';

        if (e.concept === 'fvg') {
          concept_family = 'Imbalances';
          concept_type = e.direction === 'bullish' ? 'BISI' : 'SIBI';
        } else if (e.concept === 'ifvg') {
          concept_family = 'Imbalances';
          concept_type = e.direction === 'bullish' ? 'IBISI' : 'ISIBI';
          concept_state = 'inverted';
        } else if (e.concept === 'swing') {
          concept_family = 'Swings';
          const degree = e.properties?.degree || 1;
          if (degree === 3) {
            concept_type = e.type === 'swing_high' ? 'LTH' : 'LTL';
          } else if (degree === 2) {
            concept_type = e.type === 'swing_high' ? 'ITH' : 'ITL';
          } else {
            // degree=1: use direction to determine STH/STL
            concept_type = e.direction === 'bearish' ? 'STH' : 'STL';
          }
        } else if (e.concept === 'strong_swing') {
          concept_family = 'Swings';
          concept_type = 'Strong Swing';
        } else if (e.concept === 'liquidity') {
          if (e.type === 'liquidity_void') {
            concept_family = 'Imbalances';
            concept_type = 'Liquidity Void';
          } else {
            concept_family = 'Liquidity';
            concept_type = e.direction.toUpperCase(); // 'BSL' / 'SSL'
          }
        } else if (e.concept === 'ob') {
          concept_family = 'Order Flow';
          concept_type = 'OB';
        } else if (e.concept === 'mss') {
          concept_family = 'Structure Breaks';
          concept_type = 'MSS';
        } else if (e.concept === 'bos') {
          concept_family = 'Structure Breaks';
          concept_type = 'BOS';
        } else if (e.concept === 'displacement') {
          concept_family = 'Structure Breaks';
          concept_type = 'Displacement';
        } else if (e.concept === 'protected') {
          concept_family = 'Structure Breaks';
          concept_type = e.direction === 'bullish' ? 'Protected Low' : 'Protected High';
        } else if (e.concept === 'volume') {
          concept_family = 'Imbalances';
          concept_type = 'Volume Imbalance';
        } else if (e.concept === 'session') {
          concept_family = 'Time';
          concept_type = 'Session';
        } else if (e.concept === 'macro') {
          concept_family = 'Time';
          concept_type = 'Macro';
        } else if (e.concept === 'amd') {
          concept_family = 'Time';
          concept_type = 'AMD';
        } else if (e.concept === 'premium') {
          concept_family = 'Time';
          concept_type = e.direction === 'premium' ? 'Premium' : 'Discount';
        } else if (e.concept === 'reference') {
          concept_family = 'Time';
          concept_type = e.direction.toUpperCase();
        } else if (e.concept === 'dealing_range') {
          concept_family = 'Price Delivery';
          concept_type = 'Dealing Range';
          concept_state = e.state || 'active';
        } else if (e.concept === 'liquidity_interaction') {
          concept_family = 'Liquidity';
          concept_type = e.properties?.interactionType?.toUpperCase() || 'INTERACTION';
          concept_state = e.state || 'active';
        } else if (e.concept === 'price_delivery') {
          concept_family = 'Price Delivery';
          concept_type = 'Price Delivery Leg';
          concept_state = e.state || 'active';
        } else if (e.concept === 'structure_confirm') {
          concept_family = 'Structure Breaks';
          concept_type = 'Structure Confirmation';
          concept_state = e.state || 'active';
        } else if (e.concept === 'breaker') {
          concept_family = 'Order Flow';
          concept_type = 'Breaker';
          concept_state = e.state || 'active';
        } else if (e.concept === 'pd_array_matrix') {
          concept_family = 'Price Delivery';
          concept_type = 'PD Array Matrix';
          concept_state = e.state || 'active';
        }

        // 1. Run Outcome Analysis
        const needsOutcome = e.concept === 'fvg' || e.concept === 'ifvg' || e.concept === 'ob' ||
                             e.concept === 'mss' || e.concept === 'bos' || e.concept === 'liquidity' ||
                             e.concept === 'displacement' || e.concept === 'protected' || e.concept === 'breaker';
        const outcome = needsOutcome ? analyzeEventOutcome(e, rawBars, e.barIndex1m, 1000) : getEmptyOutcome();
        e.mitigation_time = outcome.mitigation_time || null; 

        // Update state for active events based on outcome
        if (e.concept === 'liquidity') {
          concept_state = e.state || 'active';
        } else if (e.concept !== 'ifvg' && e.concept !== 'dealing_range' && e.concept !== 'liquidity_interaction' && e.concept !== 'price_delivery' && e.concept !== 'structure_confirm' && e.concept !== 'pd_array_matrix') {
          if (outcome.is_valid === 0) {
            concept_state = 'failed';
          } else if (outcome.is_mitigated === 1) {
            concept_state = 'mitigated';
          }
        }
        e.state = concept_state;


        // 2. Multi-Timeframe Nesting & Stateful Inversion Updates
        let parentId = null;
        let rootId = null;

        if (e.concept === 'ifvg') {
          // Stateful inversion from original FVG
          const parentConcept = e.direction === 'bullish' ? 'fvg_bearish' : 'fvg_bullish';
          const parentEventId = `${parentConcept}_${e.originalFvgTime}_tf${e.timeframe}`;
          
          if (insertedEventIds.has(parentEventId)) {
            // Update parent FVG to 'failed' at the inversion timestamp
            updateParentState.run(e.time.toString(), runId, parentEventId);
            parentId = parentEventId;
            rootId = parentEventId;
          }
        } else if (needsContext) {
          // Scan higher timeframe arrays backwards
          const timeframesToScan = [5, 15, 60, 240, 1440];
          for (const tf of timeframesToScan) {
            if (tf <= e.timeframe) continue;
            const prevList = recentEventsByTf[tf];
            if (!prevList) continue;
            for (let k = prevList.length - 1; k >= 0; k--) {
              const prev = prevList[k];
              
              // Limit search to 5 days ago (432,000 seconds)
              if (e.time - prev.time > 432000) {
                break;
              }
              
              const prevEnd = prev.mitigation_time || prev.time + prev.timeframe * 60 * 50;
              if (e.priceLow >= prev.priceLow &&
                  e.priceHigh <= prev.priceHigh &&
                  e.time >= prev.time &&
                  e.time <= prevEnd) {
                if (insertedEventIds.has(prev.id)) {
                  parentId = prev.id;
                  rootId = prev.rootId || prev.id;
                  break;
                }
              }
            }
            if (parentId) break; // found parent nesting zone
          }
        }

        // Link Swept Liquidity
        let sweptLiquidityEventId = null;
        if (e.concept === 'ob' || e.concept === 'mss' || e.concept === 'bos') {
          const list = recentEventsByTf[e.timeframe];
          const tfCandleSeconds = e.timeframe * 60;
          for (let k = list.length - 1; k >= 0; k--) {
            const prev = list[k];
            if ((e.time - prev.time) > 5 * tfCandleSeconds) {
              break;
            }
            if (prev.concept === 'liquidity') {
              if (prev.state === 'swept' || prev.state === 'taken') {
                sweptLiquidityEventId = prev.id;
                break;
              }
            }
          }
        }

        let confirmingBreakEventId = null;
        if (e.concept === 'ob') {
          const list = recentEventsByTf[e.timeframe];
          for (let k = list.length - 1; k >= 0; k--) {
            const prev = list[k];
            if (prev.time < e.time) {
              break;
            }
            if ((prev.concept === 'mss' || prev.concept === 'bos') && prev.time === e.time) {
              confirmingBreakEventId = prev.id;
              break;
            }
          }
        }

        // 3. Capture Context Snapshot
        // Context Engine is resolved on raw 1m bars for precision
        let ctx = null;
        if (needsContext) {
          try {
            ctx = captureEventContext(e, rawBars, e.barIndex1m, preFilteredEvents, preAggregated, e.timeframe, rollingCache);
          } catch (ctxErr) {
            logger.warn('PIPELINE', `captureEventContext failed for event ${e.id}`, ctxErr);
          }
          // ctx may still be null — outcome and DB write still proceed, context row is simply omitted
        }

        // Add to rolling search queue by timeframe
        const prevList = recentEventsByTf[e.timeframe];
        if (needsContext && prevList) {
          prevList.push({
            id: e.id,
            concept: e.concept,
            state: concept_state,
            timeframe: e.timeframe,
            priceLow: e.priceLow,
            priceHigh: e.priceHigh,
            time: e.time,
            rootId,
            mitigation_time: outcome.mitigation_time
          });
          // Evict events older than 5 days
          while (prevList.length > 0 && e.time - prevList[0].time > 432000) {
            prevList.shift();
          }
        }

        // 4. Save/Update records in SQLite database
        const coreKeys = new Set([
          'id', 'event_id', 'root_event_id', 'parent_event_id', 'detectorId', 'detector_id',
          'symbol', 'timeframe', 'conceptFamily', 'concept_family', 'conceptType', 'concept_type',
          'state', 'concept_state', 'time', 'timeStart', 'time_start', 'timeEnd', 'time_end',
          'priceHigh', 'price_high', 'priceLow', 'price_low', 'direction', 'barIndex', 'createdAt'
        ]);
        const customProps = {};
        for (const [k, v] of Object.entries(e)) {
          if (!coreKeys.has(k)) {
            customProps[k] = v;
          }
        }
        if (e.properties) {
          Object.assign(customProps, e.properties);
        }

        try {
          insertEvent.run(
            runId,
            e.id,
            rootId,
            parentId,
            e.detectorId,
            symbol,
            e.timeframe,
            concept_family,
            concept_type,
            concept_state,
            e.time,
            outcome.mitigation_time || null,
            e.priceHigh,
            e.priceLow,
            e.direction,
            JSON.stringify(customProps)
          );

          // Record Liquidity Object if this is a swing event
          if (e.concept === 'swing') {
            try {
              const parentSwingType = e.type === 'swing_high' ? 'high' : 'low';
              const liquiditySide = parentSwingType === 'high' ? 'buy_side' : 'sell_side';
              const price = parentSwingType === 'high' ? e.priceHigh : e.priceLow;
              const degree = e.properties?.degree || e.degree || 1;
              const confirmIdx = e.properties?.confirmationBar !== undefined ? e.properties.confirmationBar : e.barIndex + 1;
              
              const getSessionName = (unixTs) => {
                const d = new Date((unixTs + getESTOffset(unixTs)) * 1000);
                const h = d.getUTCHours();
                if (h >= 2  && h < 5)  return 'London';
                if (h >= 7  && h < 12) return 'NY AM';
                if (h >= 13 && h < 16) return 'NY PM';
                return 'Asia';
              };
              const sessionName = getSessionName(e.time);
              const liqId = `liquidity_${e.id}`;
              const metadata = JSON.stringify({ session: sessionName });

              insertLiquidity.run(
                runId,
                liqId,
                e.id,
                price,
                parentSwingType,
                liquiditySide,
                degree,
                e.timeframe,
                symbol,
                e.barIndex,
                confirmIdx,
                e.time,
                metadata
              );
            } catch (liqErr) {
              logger.warn('PIPELINE', `Liquidity insert failed for swing ${e.id} — skipping`, liqErr);
            }
          }
        } catch (dbErr) {
          // Log and skip this single event — do NOT rethrow; that would abort the entire chunk transaction
          logger.warn('PIPELINE', `DB insert failed for event ${e.id} (${concept_type}) — skipping`, dbErr);
          continue;
        }

        insertOutcome.run(
          runId,
          e.id,
          outcome.is_mitigated,
          outcome.mitigation_time,
          outcome.mitigation_price,
          outcome.mfe,
          outcome.mae,
          outcome.time_to_mitigation,
          outcome.time_to_failure,
          outcome.time_to_target,
          outcome.fvg_fill_percent,
          outcome.is_valid
        );

        if (ctx) {
          insertContext.run(
            runId,
            e.id,
            ctx.symbol,
            ctx.timeframe,
            ctx.time_year,
            ctx.time_quarter,
            ctx.time_month,
            ctx.time_weekday,
            ctx.time_session,
            ctx.time_hour,
            ctx.price_daily_range_pct,
            ctx.price_atr_14,
            ctx.price_volatility_regime,
            ctx.price_premium_discount_status,
            ctx.price_dist_daily_high,
            ctx.price_dist_daily_low,
            ctx.price_dist_weekly_high,
            ctx.price_dist_weekly_low,
            ctx.structure_bias_1m,
            ctx.structure_bias_5m,
            ctx.structure_bias_15m,
            ctx.structure_bias_1h,
            ctx.structure_bias_4h,
            ctx.structure_bias_daily,
            ctx.htf_structure_event_id,
            ctx.ltf_structure_event_id,
            ctx.nearest_htf_high,
            ctx.nearest_htf_low,
            ctx.liq_closest_above,
            ctx.liq_closest_below,
            ctx.liq_dist_to_above,
            ctx.liq_dist_to_below,
            ctx.liq_eq_high_present,
            ctx.liq_eq_low_present,
            ctx.nearest_bsl_price,
            ctx.nearest_bsl_event_id,
            ctx.nearest_ssl_price,
            ctx.nearest_ssl_event_id,
            ctx.fvg_size,
            ctx.fvg_atr_ratio,
            ctx.fvg_age,
            ctx.fvg_untouched_nearby_count,
            ctx.nearest_fvg_price,
            ctx.nearest_fvg_event_id,
            ctx.nearest_void_price,
            ctx.nearest_void_event_id,
            ctx.nearest_volume_imbalance_price,
            ctx.nearest_volume_imbalance_event_id,
            ctx.flow_before_mss,
            ctx.flow_after_mss,
            ctx.flow_before_bos,
            ctx.flow_after_bos,
            ctx.flow_sweep_occurred,
            ctx.flow_no_sweep,
            ctx.session_asia,
            ctx.session_london,
            ctx.session_ny,
            ctx.session_ny_am,
            ctx.session_ny_pm,
            outcome.mfe,
            outcome.mae,
            outcome.time_to_mitigation,
            outcome.time_to_failure,
            outcome.time_to_target
          );
        }

        insertedEventIds.add(e.id);

        if (parentId && insertedEventIds.has(parentId)) {
          const relType = e.concept === 'ifvg' ? 'inverted_from' : 'nested_inside';
          insertRelationship.run(runId, parentId, e.id, relType);
          stageCounts.relationshipsBuilt++;
        }
        if (sweptLiquidityEventId && insertedEventIds.has(sweptLiquidityEventId)) {
          insertRelationship.run(runId, sweptLiquidityEventId, e.id, 'swept_by');
          stageCounts.relationshipsBuilt++;
        }
        if (confirmingBreakEventId && insertedEventIds.has(confirmingBreakEventId)) {
          insertRelationship.run(runId, confirmingBreakEventId, e.id, 'triggered_by');
          stageCounts.relationshipsBuilt++;
        }

        // Generic Relationship mapping for contributing swings to liquidity pool
        if (e.concept === 'liquidity' && customProps.contributingSwingIds) {
          for (const swingId of customProps.contributingSwingIds) {
            let cleanSwingId = swingId;
            if (!insertedEventIds.has(cleanSwingId) && cleanSwingId.includes('_tf')) {
              cleanSwingId = cleanSwingId.substring(0, cleanSwingId.lastIndexOf('_tf'));
            }
            if (insertedEventIds.has(cleanSwingId)) {
              insertRelationship.run(runId, e.id, cleanSwingId, 'contributed_to');
              stageCounts.relationshipsBuilt++;
            }
          }
        }

        // Generic Relationship mapping for structure confirmation
        if (e.concept === 'structure_confirm') {
          if (customProps.swing_pivot_id && insertedEventIds.has(customProps.swing_pivot_id)) {
            insertRelationship.run(runId, customProps.swing_pivot_id, e.id, 'broken_by');
            stageCounts.relationshipsBuilt++;
          }
          if (customProps.delivery_leg_id && insertedEventIds.has(customProps.delivery_leg_id)) {
            insertRelationship.run(runId, customProps.delivery_leg_id, e.id, 'confirmed_by');
            stageCounts.relationshipsBuilt++;
          }
        }

        stageCounts.eventsCreated++;
        if (needsOutcome) stageCounts.outcomesComputed++;
        if (ctx) stageCounts.contextsCaptured++;
        processedCount++;
      }
    }, dbName);
    totalDbWriteTime += (Date.now() - tChunkDbStart);

    if (processedCount % 5000 === 0 || processedCount === totalEvents) {
      logger.info('PIPELINE', `Sync progress: ${processedCount} / ${totalEvents} events processed.`);
      if (progressCallback) {
        progressCallback((processedCount / totalEvents) * 100, stageCounts);
      }
    }
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // 5. Compile and save Narrative Context for each timeframe
  logger.info('PIPELINE', 'Compiling Narrative Context events...');
  const narrativeContexts = [];
  const narrativeEngine = new NarrativeContextEngine();
  
  for (const t of timeframes) {
    const tfRanges = allEvents.filter(e => e.timeframe === t.tf && e.concept === 'dealing_range');
    const tfPdArrays = allEvents.filter(e => e.timeframe === t.tf && (e.concept === 'fvg' || e.concept === 'ifvg' || e.concept === 'ob' || e.concept === 'breaker' || e.concept === 'pd_array_matrix'));
    
    // Sort ranges descending by time so the most recent is first
    tfRanges.sort((a, b) => b.time - a.time);
    
    const contextEvent = narrativeEngine.compileContext(symbol, t.tf, tfRanges, tfPdArrays);
    if (contextEvent) {
      contextEvent.symbol = symbol;
      contextEvent.timeframe = t.tf;
      narrativeContexts.push(contextEvent);
    }
  }

  // Relate Dealing Ranges and nested objects
  logger.info('PIPELINE', 'Building Dealing Range relationships...');
  const tRelDbStart = Date.now();
  RegistryService.executeInTransaction(() => {
    const allRanges = allEvents.filter(e => e.concept === 'dealing_range');
    const allPdArrays = allEvents.filter(e => e.concept === 'fvg' || e.concept === 'ifvg' || e.concept === 'ob' || e.concept === 'breaker' || e.concept === 'pd_array_matrix');

    for (const range of allRanges) {
      // 1. Targets Relationship
      const targetLiqId = range.properties?.deliveryState?.target_liquidity_id;
      if (targetLiqId) {
        insertRelationship.run(runId, range.id, targetLiqId, 'targets');
        stageCounts.relationshipsBuilt++;
      }

      // 2. Contains and Nested Inside Relationships
      const rHigh = range.priceHigh;
      const rLow = range.priceLow;
      const rStart = range.timeStart;
      const rEnd = range.timeEnd || Infinity;

      // Find nested child ranges (lower timeframes or chronologically inside)
      for (const childRange of allRanges) {
        if (childRange.id === range.id) continue;
        if (childRange.timeframe >= range.timeframe) continue; // Must be lower timeframe to nest inside HTF range

        if (childRange.priceLow >= rLow &&
            childRange.priceHigh <= rHigh &&
            childRange.timeStart >= rStart &&
            (childRange.timeEnd || childRange.timeStart) <= rEnd) {
          // range contains childRange
          insertRelationship.run(runId, range.id, childRange.id, 'contains');
          // childRange nested_inside range
          insertRelationship.run(runId, range.id, childRange.id, 'nested_inside');
          stageCounts.relationshipsBuilt += 2;
        }
      }

      // Find active PD arrays inside this Dealing Range
      for (const arr of allPdArrays) {
        if (arr.timeframe !== range.timeframe) continue; // Same timeframe matrix nesting
        if (arr.priceLow >= rLow &&
            arr.priceHigh <= rHigh &&
            arr.time >= rStart &&
            arr.time <= rEnd) {
          insertRelationship.run(runId, range.id, arr.id, 'contains');
          stageCounts.relationshipsBuilt++;
        }
      }
    }

    // Save compiled Narrative Contexts
    for (const ctx of narrativeContexts) {
      const serialized = narrativeEngine.serialize(ctx);
      insertEvent.run(
        runId,
        serialized.event_id,
        serialized.root_event_id,
        serialized.parent_event_id,
        serialized.detector_id,
        serialized.symbol,
        serialized.timeframe,
        serialized.concept_family,
        serialized.concept_type,
        serialized.concept_state,
        serialized.time_start,
        serialized.time_end,
        serialized.price_high,
        serialized.price_low,
        serialized.direction,
        serialized.properties
      );
      stageCounts.eventsCreated++;
    }
  }, dbName);
  totalDbWriteTime += (Date.now() - tRelDbStart);


  stageTimings.processing = Math.max(0, Date.now() - tProcessingStart - totalDbWriteTime);
  stageTimings.dbWrite = totalDbWriteTime;

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  logger.info('PIPELINE', `Sync pipeline finished in ${elapsed}s.`);

  global.syncTelemetry = {
    symbol,
    barsCount: rawBars.length,
    totalTime: Date.now() - t0,
    timings: stageTimings,
    counts: {
      totalEvents: allEvents.length,
      processed: processedCount,
      eventsCreated: stageCounts.eventsCreated,
      outcomesComputed: stageCounts.outcomesComputed,
      contextsCaptured: stageCounts.contextsCaptured,
      relationshipsBuilt: stageCounts.relationshipsBuilt
    },
    lastUpdated: new Date().toISOString()
  };
}

module.exports = {
  syncSymbolPipeline
};
