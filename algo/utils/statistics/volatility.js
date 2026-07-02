/**
 * algo/utils/statistics/volatility.js
 * Implements volatility indicators and classifications.
 */

const { calculateATRForIndex } = require('../math/atr');

function getVolatilityRegime(bars, index, period = 14) {
  if (index < period) return 'normal';
  
  // Calculate current ATR
  const currentAtr = calculateATRForIndex(bars, index, period);
  
  // Calculate average ATR over last 100 periods
  let atrSum = 0;
  let count = 0;
  for (let i = Math.max(period, index - 100); i <= index; i++) {
    atrSum += calculateATRForIndex(bars, i, period);
    count++;
  }
  const avgAtr = count > 0 ? atrSum / count : currentAtr;
  
  if (currentAtr > 1.5 * avgAtr) return 'high';
  if (currentAtr < 0.5 * avgAtr) return 'low';
  return 'normal';
}

module.exports = {
  getVolatilityRegime
};
