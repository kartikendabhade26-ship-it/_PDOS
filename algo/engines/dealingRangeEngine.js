/**
 * algo/engines/dealingRangeEngine.js
 * PDOS Dealing Range Engine — Swept Liquidity Strategy
 *
 * ICT Principle:
 *   When SSL is swept (price wicked below a swing low, taking sell stops) →
 *     that swept level becomes the FLOOR of the dealing range.
 *   When BSL is swept (price wicked above a swing high, taking buy stops) →
 *     that swept level becomes the CEILING of the dealing range.
 *
 *   The Dealing Range is the distance between the most recent swept SSL and
 *   the most recent swept BSL. Price delivers between them (premium ↔ discount).
 */

const BaseEngine = require('./BaseEngine');
const SwingEngine = require('./swingEngine');
const { makeEvent } = require('../eventSchema');

function getSwingConfirmTime(sw, bars) {
  const confIdx = sw.confirmationBar ?? sw.properties?.confirmationBar ?? (sw.barIndex + 2);
  if (confIdx >= 0 && confIdx < bars.length) {
    return bars[confIdx].time;
  }
  return sw.time;
}

// ─── Strategy 1: Swept Swing Pairing ─────────────────────────────────────────
// Consumes LiquidityInteraction 'sweep' events.
// BSL sweep  → uses the confirmed Swing High from the swept pool as range High
// SSL sweep  → uses the confirmed Swing Low from the swept pool as range Low
class SweptSwingPairStrategy {
  name = 'swept_swing_v1';

  pair(interactions, pools, swings, bars) {
    const ranges = [];
    let lastSweptHigh = null; // swing_high object
    let lastSweptLow = null;  // swing_low object

    const poolMap = new Map();
    if (Array.isArray(pools)) {
      for (const p of pools) {
        poolMap.set(p.id, p);
      }
    }

    for (const evt of interactions) {
      const props = evt.properties || {};
      const itype = props.interactionType;
      if (itype !== 'sweep') continue;

      const isBSL = evt.direction === 'bullish' || evt.direction === 'bsl' || props.directionType === 'bsl';
      const isSSL = evt.direction === 'bearish' || evt.direction === 'ssl' || props.directionType === 'ssl';
      
      const poolId = props.poolId;
      const pool = poolMap.get(poolId);
      if (!pool || !pool.swings || pool.swings.length === 0) continue;

      // The swept swing is the most recent swing in the pool
      const sweptSwing = pool.swings[pool.swings.length - 1];

      if (isSSL) {
        lastSweptLow = sweptSwing;
      } else if (isBSL) {
        lastSweptHigh = sweptSwing;
      }

      if (lastSweptHigh && lastSweptLow) {
        const priceHigh = lastSweptHigh.priceHigh ?? lastSweptHigh.price ?? lastSweptHigh.price_high;
        const priceLow = lastSweptLow.priceLow ?? lastSweptLow.price ?? lastSweptLow.price_low;

        if (priceHigh > priceLow) {
          ranges.push({
            highSwing: lastSweptHigh,
            lowSwing: lastSweptLow,
            startBarIdx: Math.max(evt.barIndex, lastSweptHigh.barIndex, lastSweptLow.barIndex),
            startTime: Math.max(evt.time, lastSweptHigh.time, lastSweptLow.time),
            lastSweptSide: isSSL ? 'ssl' : 'bsl'
          });
        }
      }
    }
    return ranges;
  }
}

// ─── Strategy 1b: BSL/SSL Alternating Pairing ────────────────────────────────
// Reads BSL and SSL pool events directly (as stored in the DB / passed at runtime).
// Rule:
//   BSL swept → ceiling = pool price_high of that BSL
//   SSL swept → floor   = pool price_low  of that SSL
//   A new range state is emitted after EVERY sweep, but only when the side
//   alternates (bsl→ssl or ssl→bsl) is a CHANGE flagged.
//   This produces one canonical range per alternation, matching the user's
//   manually-drawn boxes.
class BslSslAlternatingStrategy {
  name = 'bsl_ssl_alternating_v1';

  /**
   * @param {Array} pools  - BSL/SSL pool objects from LiquidityEngine
   *                         Each pool has: { id, directionType:'bsl'|'ssl', priceHigh, priceLow, time, ... }
   * @param {Array} bars   - 1m bars array
   *
   * Rule:
   *   - BSL swept → ceiling = pool.priceHigh
   *   - SSL swept → floor   = pool.priceLow
   *   - A new RANGE is emitted ONLY when the swept side ALTERNATES (ssl→bsl or bsl→ssl)
   *   - When the same side is swept again, boundary updates silently (no new range yet)
   *   - After both sides have been seen, also emit on the very first alternation
   *
   * This produces exactly one canonical dealing range per structural alternation,
   * matching ICT methodology and the user's manually-drawn boxes.
   */
  pair(pools, bars) {
    if (!Array.isArray(pools) || pools.length === 0) return [];

    // Sort all pools by time so we process them chronologically
    const sorted = [...pools].sort((a, b) => (a.time ?? a.timeStart ?? 0) - (b.time ?? b.timeStart ?? 0));

    const ranges = [];
    let lastBSL = null;          // most recently swept BSL pool
    let lastSSL = null;          // most recently swept SSL pool
    let lastEmittedSide = null;  // 'bsl' | 'ssl' — side of the last emitted range

    for (const pool of sorted) {
      const dir = (pool.directionType || '').toLowerCase();
      if (dir !== 'bsl' && dir !== 'ssl') continue;

      const isBSL = dir === 'bsl';

      // Update the relevant boundary
      if (isBSL) {
        lastBSL = pool;
      } else {
        lastSSL = pool;
      }

      // Need both sides before we can form a range
      if (!lastBSL || !lastSSL) continue;

      // Only emit a range when the side HAS ALTERNATED
      // (first emission is when we first have both sides after never having emitted,
      //  subsequent emissions only when side changes from the last emitted range)
      const sideChanged = lastEmittedSide === null
        ? true                                  // first time both sides known
        : (isBSL && lastEmittedSide === 'ssl')  // was ssl, now bsl
          || (!isBSL && lastEmittedSide === 'bsl'); // was bsl, now ssl

      if (!sideChanged) continue;

      const priceHigh = lastBSL.priceHigh ?? lastBSL.price_high;
      const priceLow  = lastSSL.priceLow  ?? lastSSL.price_low;

      if (!priceHigh || !priceLow || priceHigh <= priceLow) continue;

      const confTime = Math.max(
        lastBSL.time ?? lastBSL.timeStart ?? 0,
        lastSSL.time ?? lastSSL.timeStart ?? 0
      );

      lastEmittedSide = isBSL ? 'bsl' : 'ssl';

      ranges.push({
        highPool:      lastBSL,
        lowPool:       lastSSL,
        startTime:     confTime,
        confirmTime:   confTime,
        lastSweptSide: isBSL ? 'bsl' : 'ssl',
        state:         'active',
        timeEnd:       null
      });
    }

    return ranges;
  }
}

// ─── Strategy 2: Swing Pair fallback (original, degree-filtered) ──────────────
class SwingPairStrategyV1 {
  name = 'swing_pair_v1';

  pair(swings, bars) {
    const ranges = [];
    let lastHigh = null;
    let lastLow = null;

    for (let i = 0; i < swings.length; i++) {
      const sw = swings[i];
      // Only pair structural swings of degree >= 2
      const degree = sw.degree ?? sw.properties?.degree ?? 1;
      if (degree < 2) continue;

      const isHigh = sw.type === 'swing_high' || sw.swingType === 'high' ||
                     sw.concept_type?.toLowerCase().includes('high') ||
                     sw.properties?.type === 'swing_high';
      if (isHigh) {
        lastHigh = sw;
      } else {
        lastLow = sw;
      }

      if (lastHigh && lastLow) {
        ranges.push({
          highSwing: lastHigh,
          lowSwing: lastLow,
          lastArrived: sw
        });
      }
    }
    return ranges;
  }
}

class LiquidityStateMachineStrategy {
  name = 'liquidity_state_machine_v1';

  pair(swings, bars, symbol, timeframe) {
    let swingHighs = swings?.swingHighs || [];
    let swingLows = swings?.swingLows || [];

    if (swingHighs.length === 0 || swingLows.length === 0) {
      const swingEngine = new SwingEngine();
      const resolved = swingEngine.findSwings(bars);
      swingHighs = resolved.swingHighs || [];
      swingLows = resolved.swingLows || [];
    }

    const swingsByConfirmBar = new Map();
    const getConfirmIdx = (sw) => {
      return sw.confirmationBar ?? sw.properties?.confirmationBar ?? (sw.barIndex + 2);
    };

    for (const sw of swingHighs) {
      const conf = getConfirmIdx(sw);
      if (!swingsByConfirmBar.has(conf)) swingsByConfirmBar.set(conf, []);
      swingsByConfirmBar.get(conf).push({ ...sw, swingType: 'high' });
    }
    for (const sw of swingLows) {
      const conf = getConfirmIdx(sw);
      if (!swingsByConfirmBar.has(conf)) swingsByConfirmBar.set(conf, []);
      swingsByConfirmBar.get(conf).push({ ...sw, swingType: 'low' });
    }

    const ranges = [];
    let activeHigh = null;
    let activeLow = null;
    let highState = 'active'; // 'active' | 'swept'
    let lowState = 'active';  // 'active' | 'swept'
    let sweepHighBarIdx = -1;
    let sweepLowBarIdx = -1;
    let currentRange = null;
    let rangeEstablished = false;

    for (let j = 0; j < bars.length; j++) {
      const bar = bars[j];

      // 1. Check if the current active range is broken by a sweep of its boundaries
      if (currentRange) {
        const priceHigh = currentRange.priceHigh;
        const priceLow = currentRange.priceLow;
        if (bar.high > priceHigh || bar.low < priceLow) {
          currentRange.timeEnd = bar.time;
          currentRange.state = 'completed';
          currentRange = null;
          rangeEstablished = false;
        }
      }

      // 2. Check if the active boundaries themselves are swept by price
      if (highState === 'active' && activeHigh) {
        const ph = activeHigh.priceHigh ?? activeHigh.price ?? activeHigh.price_high;
        if (bar.high > ph) {
          highState = 'swept';
          sweepHighBarIdx = j;
          rangeEstablished = false;
          if (currentRange) {
            currentRange.timeEnd = bar.time;
            currentRange.state = 'completed';
            currentRange = null;
          }
        }
      }

      if (lowState === 'active' && activeLow) {
        const pl = activeLow.priceLow ?? activeLow.price ?? activeLow.price_low;
        if (bar.low < pl) {
          lowState = 'swept';
          sweepLowBarIdx = j;
          rangeEstablished = false;
          if (currentRange) {
            currentRange.timeEnd = bar.time;
            currentRange.state = 'completed';
            currentRange = null;
          }
        }
      }

      // 3. Process new swings confirmed at bar j
      const newSwings = swingsByConfirmBar.get(j) || [];
      for (const sw of newSwings) {
        if (sw.swingType === 'high') {
          if (!activeHigh) {
            activeHigh = sw;
            highState = 'active';
            if (activeLow && !currentRange) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'high');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          } else if (highState === 'swept' && sw.barIndex > sweepHighBarIdx) {
            activeHigh = sw;
            highState = 'active';
            if (activeLow) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'high');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          } else if (highState === 'active' && !rangeEstablished) {
            activeHigh = sw;
            if (activeLow) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'high');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          }
        } else {
          // low
          if (!activeLow) {
            activeLow = sw;
            lowState = 'active';
            if (activeHigh && !currentRange) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'low');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          } else if (lowState === 'swept' && sw.barIndex > sweepLowBarIdx) {
            activeLow = sw;
            lowState = 'active';
            if (activeHigh) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'low');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          } else if (lowState === 'active' && !rangeEstablished) {
            activeLow = sw;
            if (activeHigh) {
              currentRange = createRange(activeHigh, activeLow, j, bar.time, 'low');
              ranges.push(currentRange);
              rangeEstablished = true;
            }
          }
        }
      }
    }

    function createRange(highSw, lowSw, confirmBarIdx, confirmTime, lastSweptSide) {
      const priceHigh = highSw.priceHigh ?? highSw.price ?? highSw.price_high;
      const priceLow = lowSw.priceLow ?? lowSw.price ?? lowSw.price_low;
      const timeStart = Math.min(highSw.time, lowSw.time);
      const startBarIdx = Math.min(highSw.barIndex, lowSw.barIndex);

      return {
        highSwing: highSw,
        lowSwing: lowSw,
        priceHigh,
        priceLow,
        startBarIdx,
        startTime: timeStart,
        confirmBarIdx,
        confirmTime,
        lastSweptSide,
        timeEnd: null,
        state: 'active'
      };
    }

    return ranges;
  }
}

class FirstConfirmedSwingStrategy {
  build(swings, bars) {
    const relationships = [];
    const highs = swings.filter(s => s.type === 'swing_high');
    const lows = swings.filter(s => s.type === 'swing_low');

    // 1. Process Highs
    for (let i = 0; i < highs.length; i++) {
      const s1 = highs[i];
      const p1 = s1.priceHigh;

      let targetSwing = null;
      for (let j = i + 1; j < highs.length; j++) {
        const s2 = highs[j];
        if (s2.priceHigh > p1) {
          targetSwing = s2;
          break;
        }
      }

      if (targetSwing) {
        let breachBarIdx = null;
        for (let b = s1.barIndex + 1; b <= targetSwing.barIndex; b++) {
          if (bars[b] && bars[b].high > p1) {
            breachBarIdx = b;
            break;
          }
        }
        if (breachBarIdx === null) breachBarIdx = targetSwing.barIndex;

        let hasWick = false;
        let hasBody = false;
        const scanEnd = Math.min(bars.length - 1, targetSwing.barIndex + 2);
        for (let k = breachBarIdx; k <= scanEnd; k++) {
          if (bars[k]) {
            if (bars[k].high > p1) {
              if (bars[k].close > p1) {
                hasBody = true;
              } else {
                hasWick = true;
              }
            }
          }
        }

        const penetration = (hasBody && hasWick) ? 'both' : (hasBody ? 'body' : 'wick');
        const distanceTicks = Math.round((targetSwing.priceHigh - p1) / 0.25);
        const confirmationDelay = (targetSwing.properties?.confirmationBar ?? (targetSwing.barIndex + 2)) - breachBarIdx;

        relationships.push({
          source_swing_id: s1.id,
          target_swing_id: targetSwing.id,
          taken_time: bars[breachBarIdx].time,
          taken_price: bars[breachBarIdx].high,
          properties: {
            penetration,
            distance_ticks: distanceTicks,
            confirmation_delay_bars: confirmationDelay
          }
        });
      }
    }

    // 2. Process Lows
    for (let i = 0; i < lows.length; i++) {
      const s1 = lows[i];
      const p1 = s1.priceLow;

      let targetSwing = null;
      for (let j = i + 1; j < lows.length; j++) {
        const s2 = lows[j];
        if (s2.priceLow < p1) {
          targetSwing = s2;
          break;
        }
      }

      if (targetSwing) {
        let breachBarIdx = null;
        for (let b = s1.barIndex + 1; b <= targetSwing.barIndex; b++) {
          if (bars[b] && bars[b].low < p1) {
            breachBarIdx = b;
            break;
          }
        }
        if (breachBarIdx === null) breachBarIdx = targetSwing.barIndex;

        let hasWick = false;
        let hasBody = false;
        const scanEnd = Math.min(bars.length - 1, targetSwing.barIndex + 2);
        for (let k = breachBarIdx; k <= scanEnd; k++) {
          if (bars[k]) {
            if (bars[k].low < p1) {
              if (bars[k].close < p1) {
                hasBody = true;
              } else {
                hasWick = true;
              }
            }
          }
        }

        const penetration = (hasBody && hasWick) ? 'both' : (hasBody ? 'body' : 'wick');
        const distanceTicks = Math.round((p1 - targetSwing.priceLow) / 0.25);
        const confirmationDelay = (targetSwing.properties?.confirmationBar ?? (targetSwing.barIndex + 2)) - breachBarIdx;

        relationships.push({
          source_swing_id: s1.id,
          target_swing_id: targetSwing.id,
          taken_time: bars[breachBarIdx].time,
          taken_price: bars[breachBarIdx].low,
          properties: {
            penetration,
            distance_ticks: distanceTicks,
            confirmation_delay_bars: confirmationDelay
          }
        });
      }
    }

    return relationships;
  }
}

class InducementSweepPairStrategy {
  name = 'inducement_sweep_v1';

  pair(swings, bars, symbol, timeframe, options = {}, pools = [], interactions = []) {
    const groupedSwings = [];
    const seenTimes = new Set();
    const sortedSwings = [...swings].sort((a, b) => a.barIndex - b.barIndex);
    
    sortedSwings.forEach(s => {
      if (!seenTimes.has(s.time)) {
        seenTimes.add(s.time);
        const matches = sortedSwings.filter(x => x.time === s.time);
        const concepts = matches.map(x => x.concept_label || x.concept);
        const hasHigh = matches.some(x => x.type === 'swing_high' || x.concept_type?.toLowerCase().includes('high'));
        
        groupedSwings.push({
          id: matches[0].id || matches[0].event_id,
          type: hasHigh ? 'swing_high' : 'swing_low',
          concepts,
          time: s.time,
          price: matches[0].price || (hasHigh ? matches[0].priceHigh : matches[0].priceLow),
          priceHigh: matches[0].priceHigh,
          priceLow: matches[0].priceLow,
          barIndex: s.barIndex,
          properties: matches[0].properties || {}
        });
      }
    });

    const relStrategy = new FirstConfirmedSwingStrategy();
    const relationships = relStrategy.build(groupedSwings, bars);

    const boundaries = [];
    const targetById = new Map();
    groupedSwings.forEach(s => targetById.set(s.id, s));

    const relsByTarget = new Map();
    relationships.forEach(rel => {
      if (!relsByTarget.has(rel.target_swing_id)) {
        relsByTarget.set(rel.target_swing_id, []);
      }
      relsByTarget.get(rel.target_swing_id).push(rel);
    });

    relsByTarget.forEach((rels, targetId) => {
      const targetSwing = targetById.get(targetId);
      if (targetSwing) {
        boundaries.push({
          swing: targetSwing,
          relationships: rels
        });
      }
    });

    // 1. Assign timeEnd based on Liquidity Engine's pools and interactions (instead of candle scanning)
    boundaries.forEach(b => {
      const isHigh = b.swing.type === 'swing_high';
      const dirType = isHigh ? 'bsl' : 'ssl';
      const pool = pools.find(p => p.directionType === dirType && p.swings.some(ps => ps.time === b.swing.time));
      
      let takenTime = null;
      if (pool) {
        const matchEvt = interactions.find(evt => 
          evt.properties?.poolId === pool.id && 
          (evt.properties?.interactionType === 'sweep' || evt.properties?.interactionType === 'take') && 
          evt.time > b.swing.time
        );
        if (matchEvt) {
          takenTime = matchEvt.time;
        }
      }
      b.swing.timeEnd = takenTime;
      b.state = 'ACTIVE';
      b.replacedTime = null;
    });

    // 2. Lifecycle State Tracking (ACTIVE -> REPLACED) using replacement confirmation time
    const highs = boundaries.filter(b => b.swing.type === 'swing_high');
    const lows = boundaries.filter(b => b.swing.type === 'swing_low');

    highs.forEach((h1, i) => {
      const p1 = h1.swing.priceHigh ?? h1.swing.price;
      for (let j = i + 1; j < highs.length; j++) {
        const h2 = highs[j];
        const p2 = h2.swing.priceHigh ?? h2.swing.price;
        if (p2 >= p1) {
          h1.state = 'REPLACED';
          h1.replacedTime = getSwingConfirmTime(h2.swing, bars);
          break;
        }
      }
    });

    lows.forEach((l1, i) => {
      const p1 = l1.swing.priceLow ?? l1.swing.price;
      for (let j = i + 1; j < lows.length; j++) {
        const l2 = lows[j];
        const p2 = l2.swing.priceLow ?? l2.swing.price;
        if (p2 <= p1) {
          l1.state = 'REPLACED';
          l1.replacedTime = getSwingConfirmTime(l2.swing, bars);
          break;
        }
      }
    });

    boundaries.sort((a, b) => a.swing.time - b.swing.time);

    const researchMode = process.env.PDOS_RESEARCH_MODE === 'true' || options.researchMode === true;
    if (researchMode) {
      this.logResearchGraph(boundaries, groupedSwings, options);
    }

    // 3. Evaluate pairs using Hypothesis Rules Engine
    const ranges = [];
    const activeHighs = boundaries.filter(b => b.swing.type === 'swing_high');
    const activeLows = boundaries.filter(b => b.swing.type === 'swing_low');

    const hypotheses = [
      {
        name: 'both_active',
        evaluate: (h, l) => {
          const hEnd = h.swing.timeEnd || Infinity;
          const lEnd = l.swing.timeEnd || Infinity;
          return hEnd > l.swing.time && lEnd > h.swing.time;
        }
      },
      {
        name: 'time_overlap',
        evaluate: (h, l) => {
          const hEnd = h.swing.timeEnd || Infinity;
          const lEnd = l.swing.timeEnd || Infinity;
          return Math.max(h.swing.time, l.swing.time) <= Math.min(hEnd, lEnd);
        }
      },
      {
        name: 'rule_03',
        evaluate: (h, l) => true // Placeholder structural rule
      }
    ];

    activeHighs.forEach(h => {
      activeLows.forEach(l => {
        const results = hypotheses.map(hyp => ({ name: hyp.name, passed: hyp.evaluate(h, l) }));
        const score = Math.round((results.filter(r => r.passed).length / hypotheses.length) * 100);
        const engineAccepted = score === 100;

        if (engineAccepted || researchMode) {
          const rangeEnd = Math.min(
            h.swing.timeEnd || Infinity, 
            h.replacedTime || Infinity,
            l.swing.timeEnd || Infinity,
            l.replacedTime || Infinity
          );
          const confirmTime = Math.max(getSwingConfirmTime(h.swing, bars), getSwingConfirmTime(l.swing, bars));
          const isCompleted = rangeEnd !== Infinity;

          ranges.push({
            highSwing: h.swing,
            lowSwing: l.swing,
            time: confirmTime,
            timeStart: confirmTime,
            timeEnd: isCompleted ? rangeEnd : null,
            startTime: confirmTime,
            confirmTime: confirmTime,
            lastSweptSide: h.swing.time > l.swing.time ? 'bsl' : 'ssl',
            state: engineAccepted ? (isCompleted ? 'completed' : 'active') : 'candidate_rejected',
            evidence: {
              high_swept: h.relationships ? h.relationships.map(r => r.source_swing_id) : [],
              low_swept: l.relationships ? l.relationships.map(r => r.source_swing_id) : [],
              high_state: h.state,
              low_state: l.state,
              time_overlap: results.find(r => r.name === 'time_overlap')?.passed ?? false,
              score,
              hypotheses: results
            }
          });
        }
      });
    });

    return ranges;
  }

  logResearchGraph(boundaries, groupedSwings, options = {}) {
    const startTs = options.startTs || 0;
    const endTs = options.endTs || Infinity;

    const targetSwings = groupedSwings.filter(s => s.time >= startTs && s.time <= endTs);
    const swingToNum = new Map();
    targetSwings.forEach((s, idx) => swingToNum.set(s.id, idx + 1));

    console.log('\nBoundary Graph\n');
    boundaries.forEach(b => {
      if (b.swing.time >= startTs && b.swing.time <= endTs) {
        const swingNum = swingToNum.get(b.swing.id);
        const typeLabel = b.swing.type === 'swing_high' ? 'High' : 'Low';
        const sweptNums = b.relationships
          .map(r => swingToNum.get(r.source_swing_id))
          .filter(n => n !== undefined);

        if (sweptNums.length > 0) {
          console.log(`${typeLabel}`);
          console.log(`${swingNum}`);
          console.log('↓');
          console.log('Swept');
          console.log(sweptNums.join(', '));
          console.log('\n----------------\n');
        }
      }
    });

    console.log('\nBoundary Pair Evaluation Lab\n');
    const highs = boundaries.filter(b => b.swing.type === 'swing_high');
    const lows = boundaries.filter(b => b.swing.type === 'swing_low');

    const manualPairs = ['41-42', '41-38', '39-38', '33-38', '26-27', '17-38', '5-38', '5-6'];

    highs.forEach(h => {
      lows.forEach(l => {
        if (
          (h.swing.time >= startTs && h.swing.time <= endTs) ||
          (l.swing.time >= startTs && l.swing.time <= endTs)
        ) {
          const hNum = swingToNum.get(h.swing.id);
          const lNum = swingToNum.get(l.swing.id);
          if (!hNum || !lNum) return;

          const hEnd = h.swing.timeEnd || Infinity;
          const lEnd = l.swing.timeEnd || Infinity;
          const timeOverlap = Math.max(h.swing.time, l.swing.time) <= Math.min(hEnd, lEnd);

          const results = [
            { 
              name: 'both_active', 
              passed: (h.swing.timeEnd || Infinity) > l.swing.time && (l.swing.timeEnd || Infinity) > h.swing.time 
            },
            { name: 'time_overlap', passed: timeOverlap },
            { name: 'rule_03', passed: true }
          ];

          const score = Math.round((results.filter(r => r.passed).length / results.length) * 100);
          const engineAccepted = score === 100;

          const key = `${hNum}-${lNum}`;
          const manualAccepted = manualPairs.includes(key);
          const isMatch = engineAccepted === manualAccepted;

          console.log(`Pair: High ${hNum} - Low ${lNum}`);
          console.log(`Score: ${score}%`);
          console.log('Hypotheses:');
          results.forEach(r => {
            console.log(`  [${r.passed ? '✓' : '✗'}] ${r.name}`);
          });
          console.log(`Manual Label: ${manualAccepted ? 'Accepted' : 'Rejected'}`);
          console.log(`Engine Decision: ${engineAccepted ? 'Accepted' : 'Rejected'}`);
          console.log(`Result: ${isMatch ? 'MATCH ✓' : 'MISMATCH ✗'}`);
          console.log('\n----------------\n');
        }
      });
    });
  }
}

class DealingRangeEngine extends BaseEngine {
  constructor() {
    super();
    this.strategies = {
      swept_swing_v1:          new SweptSwingPairStrategy(),
      bsl_ssl_alternating_v1:  new BslSslAlternatingStrategy(),
      swing_pair_v1:           new SwingPairStrategyV1(),
      liquidity_state_machine_v1: new LiquidityStateMachineStrategy(),
      inducement_sweep_v1:     new InducementSweepPairStrategy()
    };
  }

  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, symbol } = context;

    if (bars.length === 0) return [];

    let timeframe = 1;
    if (bars.length >= 2) {
      const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
      if (diffMin > 0) timeframe = diffMin;
    }

    // Lazy load pools and interactions from engines if not provided
    let pools = preComputedLiquidity;
    if (!pools || pools.length === 0) {
      const LiquidityEngine = require('./liquidityEngine');
      const liquidityEngine = new LiquidityEngine();
      pools = liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings, symbol });
    }

    let interactions = preComputedInteractions;
    if (!interactions || interactions.length === 0) {
      const LiquidityInteractionEngine = require('./liquidityInteractionEngine');
      const liquidityInteractionEngine = new LiquidityInteractionEngine();
      interactions = liquidityInteractionEngine.detect(bars, {}, { preComputedSwings, preComputedLiquidity: pools, symbol });
    }

    const rangeEvents = [];
    const strategyName = options.pairingStrategy || 'inducement_sweep_v1';

    if (strategyName === 'inducement_sweep_v1') {
      const strategy = this.strategies['inducement_sweep_v1'];
      const swingsList = preComputedSwings?.allSwings || preComputedSwings || [];
      const pairs = strategy.pair(swingsList, bars, symbol, timeframe, options, pools, interactions);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const { highSwing, lowSwing, startTime, confirmTime, lastSweptSide, state, timeEnd } = pair;

        const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
        const priceLow = lowSwing.priceLow ?? lowSwing.price ?? lowSwing.price_low;

        if (priceHigh <= priceLow) continue;

        const range_size  = priceHigh - priceLow;
        const range_ticks = range_size / 0.25;
        const midpoint    = (priceHigh + priceLow) / 2;

        const rangeId = `dealing_range_inducement_${startTime}_tf${timeframe}`;

        // Map barIndex to confirmation bar index
        const highConfIdx = highSwing.confirmationBar ?? highSwing.properties?.confirmationBar ?? (highSwing.barIndex + 2);
        const lowConfIdx = lowSwing.confirmationBar ?? lowSwing.properties?.confirmationBar ?? (lowSwing.barIndex + 2);
        const confirmBarIdx = Math.min(bars.length - 1, Math.max(0, Math.max(highConfIdx, lowConfIdx)));

        rangeEvents.push({
          id: rangeId,
          type: 'dealing_range',
          direction: lastSweptSide === 'ssl' ? 'bearish' : 'bullish',
          time:      confirmTime,
          timeStart: confirmTime,
          timeEnd:   timeEnd,
          priceHigh: priceHigh,
          priceLow:  priceLow,
          barIndex:  confirmBarIdx,
          symbol: symbol || '',
          timeframe,
          state,
          properties: {
            dealing_range_id: rangeId,
            pairing_strategy: strategy.name,
            high_swing_id: highSwing.id,
            low_swing_id:  lowSwing.id,
            swept_bsl_price: priceHigh,
            swept_ssl_price: priceLow,
            swept_bsl_time:  highSwing.time,
            swept_ssl_time:  lowSwing.time,
            last_swept_side: lastSweptSide,
            confirmation_time: confirmTime,
            confirmation_bar: confirmBarIdx,
            high:  priceHigh,
            low:   priceLow,
            range_size,
            range_ticks,
            midpoint,
            level_100: priceHigh,
            level_75:  priceLow + 0.75 * range_size,
            level_50:  midpoint,
            level_25:  priceLow + 0.25 * range_size,
            level_0:   priceLow,
            premium: { high: priceHigh, low: midpoint },
            discount: { high: midpoint, low: priceLow },
            state
          }
        });
      }
      return rangeEvents;
    }

    if (strategyName === 'liquidity_state_machine_v1') {
      const strategy = this.strategies['liquidity_state_machine_v1'];
      const pairs = strategy.pair(preComputedSwings, bars, symbol, timeframe);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const { highSwing, lowSwing, startBarIdx, startTime, lastSweptSide, timeEnd, state, confirmBarIdx, confirmTime } = pair;

        const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
        const priceLow = lowSwing.priceLow ?? lowSwing.price ?? lowSwing.price_low;

        if (priceHigh <= priceLow) continue;

        const range_size  = priceHigh - priceLow;
        const range_ticks = range_size / 0.25;
        const midpoint    = (priceHigh + priceLow) / 2;

        const rangeId = `dealing_range_sweep_${startTime}_tf${timeframe}`;

        rangeEvents.push({
          id: rangeId,
          type: 'dealing_range',
          direction: lastSweptSide === 'ssl' ? 'bearish' : 'bullish',
          time:      confirmTime,
          timeStart: confirmTime,
          timeEnd,
          priceHigh: priceHigh,
          priceLow:  priceLow,
          barIndex:  confirmBarIdx,
          symbol: symbol || '',
          timeframe,
          state,
          properties: {
            dealing_range_id: rangeId,
            pairing_strategy: strategy.name,
            high_swing_id: highSwing.id ?? `swing_high_${highSwing.time}`,
            low_swing_id:  lowSwing.id  ?? `swing_low_${lowSwing.time}`,
            swept_bsl_price: priceHigh,
            swept_ssl_price: priceLow,
            swept_bsl_time:  highSwing.time,
            swept_ssl_time:  lowSwing.time,
            last_swept_side: lastSweptSide,
            confirmation_time: confirmTime,
            confirmation_bar: confirmBarIdx,
            high:  priceHigh,
            low:   priceLow,
            range_size,
            range_ticks,
            midpoint,
            level_100: priceHigh,
            level_75:  priceLow + 0.75 * range_size,
            level_50:  midpoint,
            level_25:  priceLow + 0.25 * range_size,
            level_0:   priceLow,
            premium: { high: priceHigh, low: midpoint },
            discount: { high: midpoint, low: priceLow },
            state
          }
        });
      }
      return rangeEvents;
    }

    // ── Path A: Swept Liquidity (preferred, ICT-correct) ──────────────────────
    const strategy = this.strategies['swept_swing_v1'];
    const swingsList = preComputedSwings?.allSwings || preComputedSwings || [];
    const pairs = strategy.pair(interactions, pools, swingsList, bars);

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const { highSwing, lowSwing, startBarIdx, startTime, lastSweptSide } = pair;

      const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
      const priceLow = lowSwing.priceLow ?? lowSwing.price ?? lowSwing.price_low;

      if (priceHigh <= priceLow) continue;

      const highConfIdx = highSwing.confirmationBar ?? highSwing.properties?.confirmationBar ?? (highSwing.barIndex + 2);
      const lowConfIdx = lowSwing.confirmationBar ?? lowSwing.properties?.confirmationBar ?? (lowSwing.barIndex + 2);
      const confirmBarIdx = Math.min(bars.length - 1, Math.max(0, Math.max(highConfIdx, lowConfIdx)));
      const confirmTime = getSwingConfirmTime(highSwing, bars) > getSwingConfirmTime(lowSwing, bars)
        ? getSwingConfirmTime(highSwing, bars)
        : getSwingConfirmTime(lowSwing, bars);

      const poolHigh = pools.find(p => p.directionType === 'bsl' && p.swings.some(ps => ps.time === highSwing.time));
      const poolLow = pools.find(p => p.directionType === 'ssl' && p.swings.some(ps => ps.time === lowSwing.time));

      let highTakenTime = null;
      if (poolHigh) {
        const matchEvt = interactions.find(evt => 
          evt.properties?.poolId === poolHigh.id && 
          (evt.properties?.interactionType === 'sweep' || evt.properties?.interactionType === 'take') && 
          evt.time > highSwing.time
        );
        if (matchEvt) highTakenTime = matchEvt.time;
      }

      let lowTakenTime = null;
      if (poolLow) {
        const matchEvt = interactions.find(evt => 
          evt.properties?.poolId === poolLow.id && 
          (evt.properties?.interactionType === 'sweep' || evt.properties?.interactionType === 'take') && 
          evt.time > lowSwing.time
        );
        if (matchEvt) lowTakenTime = matchEvt.time;
      }

      const timeEnd = (highTakenTime && lowTakenTime) ? Math.min(highTakenTime, lowTakenTime) : (highTakenTime || lowTakenTime || null);
      const state = timeEnd !== null ? 'completed' : 'active';
      const direction = lastSweptSide === 'ssl' ? 'bearish' : 'bullish';

      const range_size  = priceHigh - priceLow;
      const range_ticks = range_size / 0.25;
      const midpoint    = (priceHigh + priceLow) / 2;

      const rangeId = `dealing_range_sweep_${startTime}_tf${timeframe}`;

      rangeEvents.push({
        id: rangeId,
        type: 'dealing_range',
        direction,
        time:      confirmTime,
        timeStart: confirmTime,
        timeEnd,
        priceHigh: priceHigh,
        priceLow:  priceLow,
        barIndex:  confirmBarIdx,
        symbol: symbol || '',
        timeframe,
        state,
        properties: {
          dealing_range_id: rangeId,
          pairing_strategy: strategy.name,
          high_swing_id: highSwing.id ?? `swing_high_${highSwing.time}`,
          low_swing_id:  lowSwing.id  ?? `swing_low_${lowSwing.time}`,
          swept_bsl_price: priceHigh,
          swept_ssl_price: priceLow,
          swept_bsl_time:  highSwing.time,
          swept_ssl_time:  lowSwing.time,
          last_swept_side: lastSweptSide,
          confirmation_time: confirmTime,
          high:  priceHigh,
          low:   priceLow,
          range_size,
          range_ticks,
          midpoint,
          level_100: priceHigh,
          level_75:  priceLow + 0.75 * range_size,
          level_50:  midpoint,
          level_25:  priceLow + 0.25 * range_size,
          level_0:   priceLow,
          premium: { high: priceHigh, low: midpoint },
          discount: { high: midpoint, low: priceLow },
          state
        }
      });
    }
    return rangeEvents;
  }

  // ── Path B: Swing Pair fallback (if no interaction data available) ─────────
  static _swingPairFallback(bars, preComputedSwings, symbol, timeframe, pools, interactions) {
    let swingHighs = preComputedSwings?.swingHighs;
    let swingLows  = preComputedSwings?.swingLows;

    if (!swingHighs || !swingLows) {
      const swingEngine = new SwingEngine();
      const resolved = swingEngine.findSwings(bars);
      swingHighs = resolved.swingHighs;
      swingLows  = resolved.swingLows;
    }

    const mergedSwings = [
      ...swingHighs.map(h => ({ ...h, swingType: 'high' })),
      ...swingLows.map(l  => ({ ...l, swingType: 'low'  }))
    ].sort((a, b) => a.barIndex - b.barIndex);

    const strategy = this.strategies['swing_pair_v1'];
    const pairs = strategy.pair(mergedSwings, bars);
    const rangeEvents = [];

    for (let i = 0; i < pairs.length; i++) {
      const { highSwing, lowSwing, lastArrived } = pairs[i];

      const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
      const priceLow  = lowSwing.priceLow  ?? lowSwing.price  ?? lowSwing.price_low;

      if (priceHigh <= priceLow) continue;

      const timeStart    = Math.min(highSwing.time, lowSwing.time);
      const startBarIdx  = Math.min(highSwing.barIndex, lowSwing.barIndex);
      const creationBarIdx = Math.max(highSwing.barIndex, lowSwing.barIndex);

      const highConf = highSwing.properties?.confirmationBar ?? highSwing.confirmationBar ?? (highSwing.barIndex + 2);
      const lowConf  = lowSwing.properties?.confirmationBar  ?? lowSwing.confirmationBar  ?? (lowSwing.barIndex  + 2);
      const confirmBarIdx = Math.max(highConf, lowConf);
      const timeConfirm = bars[confirmBarIdx]?.time ?? Math.max(highSwing.time, lowSwing.time);

      const poolHigh = pools.find(p => p.directionType === 'bsl' && p.swings.some(ps => ps.time === highSwing.time));
      const poolLow = pools.find(p => p.directionType === 'ssl' && p.swings.some(ps => ps.time === lowSwing.time));

      let highTakenTime = null;
      if (poolHigh) {
        const matchEvt = interactions.find(evt => 
          evt.properties?.poolId === poolHigh.id && 
          (evt.properties?.interactionType === 'sweep' || evt.properties?.interactionType === 'take') && 
          evt.time > highSwing.time
        );
        if (matchEvt) highTakenTime = matchEvt.time;
      }

      let lowTakenTime = null;
      if (poolLow) {
        const matchEvt = interactions.find(evt => 
          evt.properties?.poolId === poolLow.id && 
          (evt.properties?.interactionType === 'sweep' || evt.properties?.interactionType === 'take') && 
          evt.time > lowSwing.time
        );
        if (matchEvt) lowTakenTime = matchEvt.time;
      }

      const timeEnd = (highTakenTime && lowTakenTime) ? Math.min(highTakenTime, lowTakenTime) : (highTakenTime || lowTakenTime || null);
      const state    = timeEnd !== null ? 'completed' : 'active';
      const direction = lastArrived.swingType === 'high' ? 'bullish' : 'bearish';

      const range_size  = priceHigh - priceLow;
      const range_ticks = range_size / 0.25;
      const midpoint    = (priceHigh + priceLow) / 2;

      const rangeId = `dealing_range_${direction}_${timeStart}_tf${timeframe}`;

      rangeEvents.push({
        id: rangeId,
        type: 'dealing_range',
        direction,
        time:      timeConfirm,
        timeStart: timeConfirm,
        timeEnd,
        priceHigh,
        priceLow,
        barIndex:  confirmBarIdx,
        symbol:    symbol || '',
        timeframe,
        state,
        properties: {
          dealing_range_id: rangeId,
          high_swing_id: highSwing.id ?? `swing_high_${highSwing.time}`,
          low_swing_id:  lowSwing.id  ?? `swing_low_${lowSwing.time}`,
          creation_bar:     creationBarIdx,
          confirmation_bar: confirmBarIdx,
          confirmation_time: timeConfirm,
          completion_bar:    timeEnd ? bars.findIndex(b => b.time === timeEnd) : null,
          high: priceHigh,
          low:  priceLow,
          range_size,
          range_ticks,
          midpoint,
          level_100: priceHigh,
          level_75:  priceLow + 0.75 * range_size,
          level_50:  midpoint,
          level_25:  priceLow + 0.25 * range_size,
          level_0:   priceLow,
          premium: { high: priceHigh, low: midpoint },
          discount: { high: midpoint, low: priceLow },
          state,
          pairing_strategy: strategy.name
        }
      });
    }

    return rangeEvents;
  }

  detect(bars, options = {}, context = {}) {
    const { preComputedSwings, preComputedLiquidity, preComputedInteractions, symbol } = context;

    if (bars.length === 0) return [];

    let timeframe = 1;
    if (bars.length >= 2) {
      const diffMin = Math.round((bars[1].time - bars[0].time) / 60);
      if (diffMin > 0) timeframe = diffMin;
    }

    if (global.profiler) {
      global.profiler.incrementCounter('barsProcessed', bars.length);
    }

    if (global.profiler) global.profiler.startEnginePhase('DealingRangeEngine', timeframe, 'dependencyResolution');
    // Lazy load pools and interactions from engines if not provided
    let pools = preComputedLiquidity;
    if (!pools || pools.length === 0) {
      const LiquidityEngine = require('./liquidityEngine');
      const liquidityEngine = new LiquidityEngine();
      pools = liquidityEngine.detect(bars, { concept: 'liquidity' }, { preComputedSwings, symbol });
    }

    let interactions = preComputedInteractions;
    if (!interactions || interactions.length === 0) {
      const LiquidityInteractionEngine = require('./liquidityInteractionEngine');
      const liquidityInteractionEngine = new LiquidityInteractionEngine();
      interactions = liquidityInteractionEngine.detect(bars, {}, { preComputedSwings, preComputedLiquidity: pools, symbol });
    }
    if (global.profiler) global.profiler.endEnginePhase('DealingRangeEngine', timeframe, 'dependencyResolution');

    if (global.profiler) global.profiler.startEnginePhase('DealingRangeEngine', timeframe, 'strategyPairing');
    const rangeEvents = [];
    const strategyName = options.pairingStrategy || 'bsl_ssl_alternating_v1';

    let resultRanges = [];
    if (strategyName === 'inducement_sweep_v1') {
      const strategy = this.strategies['inducement_sweep_v1'];
      const swingsList = preComputedSwings?.allSwings || preComputedSwings || [];
      const pairs = strategy.pair(swingsList, bars, symbol, timeframe, options, pools, interactions);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const { highSwing, lowSwing, startTime, confirmTime, lastSweptSide, state, timeEnd } = pair;

        const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
        const priceLow = lowSwing.priceLow ?? lowSwing.price ?? lowSwing.price_low;

        if (priceHigh <= priceLow) continue;

        const range_size  = priceHigh - priceLow;
        const range_ticks = range_size / 0.25;
        const midpoint    = (priceHigh + priceLow) / 2;

        const rangeId = `dealing_range_inducement_${startTime}_tf${timeframe}`;

        // Map barIndex to confirmation bar index
        const highConfIdx = highSwing.confirmationBar ?? highSwing.properties?.confirmationBar ?? (highSwing.barIndex + 2);
        const lowConfIdx = lowSwing.confirmationBar ?? lowSwing.properties?.confirmationBar ?? (lowSwing.barIndex + 2);
        const confirmBarIdx = Math.min(bars.length - 1, Math.max(0, Math.max(highConfIdx, lowConfIdx)));

        rangeEvents.push({
          id: rangeId,
          type: 'dealing_range',
          direction: lastSweptSide === 'ssl' ? 'bearish' : 'bullish',
          time:      confirmTime,
          timeStart: confirmTime,
          timeEnd:   timeEnd,
          priceHigh: priceHigh,
          priceLow:  priceLow,
          barIndex:  confirmBarIdx,
          symbol: symbol || '',
          timeframe,
          state,
          properties: {
            dealing_range_id: rangeId,
            pairing_strategy: strategy.name,
            high_swing_id: highSwing.id,
            low_swing_id:  lowSwing.id,
            swept_bsl_price: priceHigh,
            swept_ssl_price: priceLow,
            swept_bsl_time:  highSwing.time,
            swept_ssl_time:  lowSwing.time,
            last_swept_side: lastSweptSide,
            confirmation_time: confirmTime,
            confirmation_bar: confirmBarIdx,
            high:  priceHigh,
            low:   priceLow,
            range_size,
            range_ticks,
            midpoint,
            level_100: priceHigh,
            level_75:  priceLow + 0.75 * range_size,
            level_50:  midpoint,
            level_25:  priceLow + 0.25 * range_size,
            level_0:   priceLow,
            premium: { high: priceHigh, low: midpoint },
            discount: { high: midpoint, low: priceLow },
            state
          }
        });
      }
      resultRanges = rangeEvents;
    } else if (strategyName === 'liquidity_state_machine_v1') {
      const strategy = this.strategies['liquidity_state_machine_v1'];
      const pairs = strategy.pair(preComputedSwings, bars, symbol, timeframe);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const { highSwing, lowSwing, startBarIdx, startTime, lastSweptSide, timeEnd, state, confirmBarIdx, confirmTime } = pair;

        const priceHigh = highSwing.priceHigh ?? highSwing.price ?? highSwing.price_high;
        const priceLow = lowSwing.priceLow ?? lowSwing.price ?? lowSwing.price_low;

        if (priceHigh <= priceLow) continue;

        const range_size  = priceHigh - priceLow;
        const range_ticks = range_size / 0.25;
        const midpoint    = (priceHigh + priceLow) / 2;

        const rangeId = `dealing_range_sweep_${startTime}_tf${timeframe}`;

        rangeEvents.push({
          id: rangeId,
          type: 'dealing_range',
          direction: lastSweptSide === 'ssl' ? 'bearish' : 'bullish',
          time:      confirmTime,
          timeStart: confirmTime,
          timeEnd,
          priceHigh: priceHigh,
          priceLow:  priceLow,
          barIndex:  confirmBarIdx,
          symbol: symbol || '',
          timeframe,
          state,
          properties: {
            dealing_range_id: rangeId,
            pairing_strategy: strategy.name,
            high_swing_id: highSwing.id ?? `swing_high_${highSwing.time}`,
            low_swing_id:  lowSwing.id  ?? `swing_low_${lowSwing.time}`,
            swept_bsl_price: priceHigh,
            swept_ssl_price: priceLow,
            swept_bsl_time:  highSwing.time,
            swept_ssl_time:  lowSwing.time,
            last_swept_side: lastSweptSide,
            confirmation_time: confirmTime,
            high:  priceHigh,
            low:   priceLow,
            range_size,
            range_ticks,
            midpoint,
            level_100: priceHigh,
            level_75:  priceLow + 0.75 * range_size,
            level_50:  midpoint,
            level_25:  priceLow + 0.25 * range_size,
            level_0:   priceLow,
            premium: { high: priceHigh, low: midpoint },
            discount: { high: midpoint, low: priceLow },
            state
          }
        });
      }
      resultRanges = rangeEvents;
    } else if (strategyName === 'bsl_ssl_alternating_v1') {
      // ICT-correct: one range per BSL/SSL alternation using pool price levels directly
      const strategy = this.strategies['bsl_ssl_alternating_v1'];
      const pairs = strategy.pair(pools, bars);

      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const { highPool, lowPool, confirmTime, lastSweptSide, state: pairState } = pair;

        const priceHigh = highPool.priceHigh ?? highPool.price_high ?? highPool.priceHigh;
        const priceLow  = lowPool.priceLow   ?? lowPool.price_low  ?? lowPool.priceLow;

        if (!priceHigh || !priceLow || priceHigh <= priceLow) continue;

        // Resolve bar index for confirmation time
        let confirmBarIdx = 0;
        for (let bi = 0; bi < bars.length; bi++) {
          if (bars[bi].time >= confirmTime) { confirmBarIdx = bi; break; }
        }
        confirmBarIdx = Math.min(bars.length - 1, confirmBarIdx);

        const direction   = lastSweptSide === 'ssl' ? 'bearish' : 'bullish';
        const range_size  = priceHigh - priceLow;
        const range_ticks = range_size / 0.25;
        const midpoint    = (priceHigh + priceLow) / 2;
        const rangeId     = `dealing_range_alternating_${confirmTime}_tf${timeframe}`;

        rangeEvents.push({
          id: rangeId,
          type: 'dealing_range',
          direction,
          time:      confirmTime,
          timeStart: confirmTime,
          timeEnd:   null,
          priceHigh,
          priceLow,
          barIndex:  confirmBarIdx,
          symbol:    symbol || '',
          timeframe,
          state:     'active',
          properties: {
            dealing_range_id:    rangeId,
            pairing_strategy:    strategy.name,
            high_pool_id:        highPool.id,
            low_pool_id:         lowPool.id,
            swept_bsl_price:     priceHigh,
            swept_ssl_price:     priceLow,
            swept_bsl_time:      highPool.time ?? highPool.timeStart,
            swept_ssl_time:      lowPool.time  ?? lowPool.timeStart,
            last_swept_side:     lastSweptSide,
            confirmation_time:   confirmTime,
            high:       priceHigh,
            low:        priceLow,
            range_size,
            range_ticks,
            midpoint,
            level_100:  priceHigh,
            level_75:   priceLow + 0.75 * range_size,
            level_50:   midpoint,
            level_25:   priceLow + 0.25 * range_size,
            level_0:    priceLow,
            premium:    { high: priceHigh, low: midpoint },
            discount:   { high: midpoint,  low: priceLow },
            state: 'active'
          }
        });
      }
      resultRanges = rangeEvents;
    } else {
      resultRanges = DealingRangeEngine._swingPairFallback(bars, preComputedSwings, symbol, timeframe, pools, interactions);
    }
    if (global.profiler) global.profiler.endEnginePhase('DealingRangeEngine', timeframe, 'strategyPairing');

    if (global.profiler) {
      global.profiler.incrementCounter('eventsProduced', resultRanges.length);
    }
    return resultRanges;
  }



  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  validate(event) {
    if (!event.time || event.priceHigh === undefined || event.priceLow === undefined) {
      return { isValid: false, reason: "Missing coordinate variables" };
    }
    if (event.priceHigh <= event.priceLow) {
      return { isValid: false, reason: "priceHigh must be strictly greater than priceLow" };
    }

    const props = event.properties || {};
    if (props.level_100 !== event.priceHigh) {
      return { isValid: false, reason: "level_100 must equal priceHigh" };
    }
    if (props.level_0 !== event.priceLow) {
      return { isValid: false, reason: "level_0 must equal priceLow" };
    }

    const expectedMidpoint = (event.priceHigh + event.priceLow) / 2;
    if (Math.abs(props.level_50 - expectedMidpoint) > 0.001) {
      return { isValid: false, reason: "level_50 must equal exact midpoint" };
    }

    const expected75 = event.priceLow + 0.75 * (event.priceHigh - event.priceLow);
    if (Math.abs(props.level_75 - expected75) > 0.001) {
      return { isValid: false, reason: "level_75 incorrect" };
    }

    const expected25 = event.priceLow + 0.25 * (event.priceHigh - event.priceLow);
    if (Math.abs(props.level_25 - expected25) > 0.001) {
      return { isValid: false, reason: "level_25 incorrect" };
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
        targets: event.targets,
        consumes: event.consumes,
        ...event.properties
      })
    };
  }
}

module.exports = DealingRangeEngine;
