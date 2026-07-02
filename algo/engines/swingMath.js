/**
 * algo/engines/swingMath.js
 * Private mathematical helpers for Swing Service (Optimized for speed and memory).
 */

/**
 * Scan bars to find raw swing high and low candidates.
 * Uses Uint8Array to minimize heap allocation.
 */
function scanSwingCandidates(bars, leftLen, rightLen) {
  const isHighCand = new Uint8Array(bars.length);
  const isLowCand = new Uint8Array(bars.length);

  for (let i = leftLen; i < bars.length - rightLen; i++) {
    const curr = bars[i];
    
    let allLowerOrEqualHigh = true;
    let hasStrictlyLowerHigh = false;
    for (let j = i - leftLen; j <= i + rightLen; j++) {
      if (bars[j].high > curr.high) {
        allLowerOrEqualHigh = false;
        break;
      }
      if (bars[j].high < curr.high) {
        hasStrictlyLowerHigh = true;
      }
    }
    if (allLowerOrEqualHigh && hasStrictlyLowerHigh) {
      isHighCand[i] = 1;
    }

    let allHigherOrEqualLow = true;
    let hasStrictlyHigherLow = false;
    for (let j = i - leftLen; j <= i + rightLen; j++) {
      if (bars[j].low < curr.low) {
        allHigherOrEqualLow = false;
        break;
      }
      if (bars[j].low > curr.low) {
        hasStrictlyHigherLow = true;
      }
    }
    if (allHigherOrEqualLow && hasStrictlyHigherLow) {
      isLowCand[i] = 1;
    }
  }

  return { isHighCand, isLowCand };
}

/**
 * Resolves flat runs of equal price wicks by selecting a single optimal index.
 * Uses priority scoring (opposite-type conflict avoidance) and defaults to the last index of the run.
 */
function resolveFlatRuns(bars, isCand, opposingCand, isHighSide) {
  const finalIndices = new Uint8Array(bars.length);
  const confirmIndices = new Int32Array(bars.length);
  
  let i = 0;
  while (i < bars.length) {
    if (isCand[i] === 1) {
      let L = i;
      let R = i;
      const targetPrice = isHighSide ? bars[L].high : bars[L].low;
      
      while (R + 1 < bars.length && isCand[R + 1] === 1 && (isHighSide ? bars[R + 1].high === targetPrice : bars[R + 1].low === targetPrice)) {
        R++;
      }
      
      let bestIdx = L;
      let maxScore = -1;
      for (let idx = L; idx <= R; idx++) {
        let score = opposingCand[idx] === 1 ? 0 : 1;
        if (score >= maxScore) {
          maxScore = score;
          bestIdx = idx;
        }
      }
      
      finalIndices[bestIdx] = 1;
      confirmIndices[bestIdx] = R;
      i = R + 1;
    } else {
      i++;
    }
  }

  return { finalIndices, confirmIndices };
}

module.exports = {
  scanSwingCandidates,
  resolveFlatRuns
};
