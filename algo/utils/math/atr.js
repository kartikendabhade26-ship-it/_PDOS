/**
 * algo/utils/math/atr.js
 * Calculates simple Average Range for a given bar index (no True Range / ATR used).
 */

function calculateAvgRangeForIndex(bars, endIdx, period = 14) {
  if (endIdx < period || endIdx >= bars.length) return 10.0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    sum += (bars[i].high - bars[i].low);
  }
  return sum / period;
}

// Keep the old name as alias for backward compatibility but using the simple range calculation
const calculateATRForIndex = calculateAvgRangeForIndex;

module.exports = {
  calculateAvgRangeForIndex,
  calculateATRForIndex
};

