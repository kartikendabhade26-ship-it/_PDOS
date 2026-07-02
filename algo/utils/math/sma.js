/**
 * algo/utils/math/sma.js
 * Precomputes Simple Moving Average (SMA) for an array of bars.
 */

function precomputeSMA(bars, period = 50) {
  const n = bars.length;
  const sma = new Float64Array(n);
  if (n < period) return sma;
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  sma[period - 1] = sum / period;
  
  for (let i = period; i < n; i++) {
    sum = sum - bars[i - period].close + bars[i].close;
    sma[i] = sum / period;
  }
  return sma;
}

module.exports = {
  precomputeSMA
};
