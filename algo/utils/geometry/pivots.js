/**
 * algo/utils/geometry/pivots.js
 * Binary search and spatial coordinate helpers for pivot points.
 */

function findLastIndexLessThan(array, targetVal, key = 'barIndex') {
  let low = 0;
  let high = array.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid][key] < targetVal) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

function findFirstIndexGreaterOrEqual(array, targetVal, key = 'barIndex') {
  let low = 0;
  let high = array.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (array[mid][key] >= targetVal) {
      ans = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return ans;
}

function findIndexUpTo(bars, targetTime) {
  if (!bars || bars.length === 0) return -1;
  let low = 0;
  let high = bars.length - 1;
  let ans = -1;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bars[mid].time <= targetTime) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

module.exports = {
  findLastIndexLessThan,
  findFirstIndexGreaterOrEqual,
  findIndexUpTo
};
