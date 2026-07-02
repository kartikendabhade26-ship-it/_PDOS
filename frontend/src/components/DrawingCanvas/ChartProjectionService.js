/**
 * ChartProjectionService.js
 * Centralizes coordinate projections and handles persistent caching of pixel positions.
 * The cache is invalidated when panning, zooming, resizing, or reloading datasets.
 */
export default class ChartProjectionService {
  constructor() {
    this.chart = null;
    this.series = null;
    this.timeframe = 1;
    this.allBars = [];
    this.timeToIndexMap = new Map();
    this.coordCache = new Map();
  }

  updateDataset(bars, timeframe) {
    this.allBars = bars || [];
    this.timeframe = timeframe || 1;
    this.timeToIndexMap.clear();
    this.allBars.forEach((bar, idx) => {
      this.timeToIndexMap.set(bar.time, idx);
    });
    this.invalidateCache();
  }

  updateChartState(chart, series) {
    this.chart = chart;
    this.series = series;
    this.invalidateCache();
  }

  invalidateCache() {
    this.coordCache.clear();
  }

  pointToCoords(point) {
    if (!point || !this.chart || !this.series) return null;

    const cacheKey = `${point.time}_${point.price !== undefined ? point.price : 'noPrice'}`;
    if (this.coordCache.has(cacheKey)) {
      return this.coordCache.get(cacheKey);
    }

    const timeScale = this.chart.timeScale();
    const bars = this.allBars;
    if (!bars || bars.length === 0) return null;

    let logical = null;
    const lastBar = bars[bars.length - 1];

    // O(1) lookup
    const idx = this.timeToIndexMap.get(point.time);
    if (idx !== undefined) {
      logical = idx;
    } else if (point.time < bars[0].time) {
      // Extrapolate logical index backwards for historical times
      const barDuration = this.timeframe * 60;
      logical = 0 - (bars[0].time - point.time) / barDuration;
    } else {
      // Extrapolate logical index for future times
      const barDuration = this.timeframe * 60;
      const lastIdx = bars.length - 1;
      logical = lastIdx + (point.time - lastBar.time) / barDuration;
    }

    let x = timeScale.logicalToCoordinate(logical);
    if (x === null) {
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        x = (logical - visibleRange.from) * timeScale.options().barSpacing;
      }
    }

    let y = null;
    if (point.price !== undefined) {
      try {
        y = this.series.priceToCoordinate(point.price);
      } catch (e) {
        this.coordCache.set(cacheKey, null);
        return null;
      }
    }

    if (x === null || (point.price !== undefined && y === null)) {
      this.coordCache.set(cacheKey, null);
      return null;
    }

    const coords = { x, y };
    this.coordCache.set(cacheKey, coords);
    return coords;
  }
}
