/**
 * algo/utils/statistics/distribution.js
 * Implements volume profile and distribution density math.
 */

function getVolumeAtPrice(bars, startIdx, endIdx, binSize = 1.0) {
  const profile = {};
  for (let i = startIdx; i <= endIdx && i < bars.length; i++) {
    const bar = bars[i];
    const avgPrice = (bar.high + bar.low) / 2;
    const bin = Math.round(avgPrice / binSize) * binSize;
    profile[bin] = (profile[bin] || 0) + bar.volume;
  }
  return profile;
}

module.exports = {
  getVolumeAtPrice
};
