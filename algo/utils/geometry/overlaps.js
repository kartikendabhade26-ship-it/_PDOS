/**
 * algo/utils/geometry/overlaps.js
 * Implements interval overlap math.
 */

function isOverlapping(minA, maxA, minB, maxB) {
  return maxA >= minB && maxB >= minA;
}

function getOverlapSize(minA, maxA, minB, maxB) {
  if (!isOverlapping(minA, maxA, minB, maxB)) return 0;
  return Math.min(maxA, maxB) - Math.max(minA, minB);
}

module.exports = {
  isOverlapping,
  getOverlapSize
};
