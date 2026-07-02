/**
 * algo/engines/swingHierarchyBuilder.js
 * Ingests degree=1 swings and recursively builds degree=2 and degree=3 pivots.
 * Links parent and child swing relationships (optimized to prevent unnecessary array allocations).
 */

class SwingHierarchyBuilder {
  /**
   * Builds the swing hierarchy up to maxDegree.
   * Updates parentSwingIds and childSwingIds for all contributing pivots on-demand.
   */
  build(degree1Swings, maxDegree = 3) {
    if (!degree1Swings || degree1Swings.length < 3) return [];

    // Sort chronologically
    degree1Swings.sort((a, b) => a.barIndex - b.barIndex);

    // Map of ID -> swing event for easy reference and relationship linking
    const swingMap = new Map();
    degree1Swings.forEach(s => swingMap.set(s.id, s));

    const allPromoted = [];
    let currentHighs = degree1Swings.filter(s => s.type === 'swing_high');
    let currentLows = degree1Swings.filter(s => s.type === 'swing_low');

    for (let targetDegree = 2; targetDegree <= maxDegree; targetDegree++) {
      const promotedHighs = this._buildOneSide(currentHighs, 'swing_high', targetDegree, swingMap);
      const promotedLows = this._buildOneSide(currentLows, 'swing_low', targetDegree, swingMap);

      allPromoted.push(...promotedHighs, ...promotedLows);

      // Register new promoted events in the map
      promotedHighs.forEach(s => swingMap.set(s.id, s));
      promotedLows.forEach(s => swingMap.set(s.id, s));

      currentHighs = promotedHighs;
      currentLows = promotedLows;

      if (promotedHighs.length === 0 && promotedLows.length === 0) break;
    }

    return allPromoted;
  }

  _buildOneSide(swings, type, targetDegree, swingMap) {
    const promoted = [];
    const isHigh = type === 'swing_high';

    for (let i = 1; i < swings.length - 1; i++) {
      const prev = swings[i - 1];
      const middle = swings[i];
      const next = swings[i + 1];

      const qualifies = isHigh
        ? (middle.price > prev.price && middle.price > next.price)
        : (middle.price < prev.price && middle.price < next.price);

      if (qualifies) {
        const id = `swing_${isHigh ? 'high' : 'low'}_d${targetDegree}_${middle.time}`;
        const entry = {
          id,
          type,
          concept: 'swing',
          direction: middle.direction,
          time: middle.time,
          timestamp: middle.time,
          price: middle.price,
          priceHigh: middle.priceHigh,
          priceLow: middle.priceLow,
          barIndex: middle.barIndex,
          confirmationBar: middle.confirmationBar,
          timeframe: middle.timeframe,
          symbol: middle.symbol,
          degree: targetDegree,
          childSwingIds: [prev.id, middle.id, next.id] // allocated only for promoted ones
        };

        // Link child swings to this new parent swing on-demand
        [prev.id, middle.id, next.id].forEach(childId => {
          const child = swingMap.get(childId);
          if (child) {
            if (!child.parentSwingIds) child.parentSwingIds = [];
            if (!child.parentSwingIds.includes(id)) {
              child.parentSwingIds.push(id);
            }
          }
        });

        promoted.push(entry);
      }
    }

    return promoted;
  }
}

module.exports = SwingHierarchyBuilder;
