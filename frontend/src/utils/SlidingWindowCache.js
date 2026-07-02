class SlidingWindowCache {
  constructor() {
    this.symbol = null;
    this.timeframe = null;
    this.mode = 'interactive';
    this.candles = [];
    this.candidates = [];
    this.startSec = 0;
    this.endSec = 0;
  }

  clear() {
    this.symbol = null;
    this.timeframe = null;
    this.candles = [];
    this.candidates = [];
    this.startSec = 0;
    this.endSec = 0;
  }

  /**
   * Check if the requested range [from, to] is fully covered by our cached bounds.
   * If it is, we return the cached elements matching [from, to].
   * If it isn't, we return null.
   */
  getRange(symbol, timeframe, mode, from, to) {
    if (this.symbol !== symbol || this.timeframe !== timeframe || this.mode !== mode) {
      return null;
    }
    
    // We check if requested bounds are within the cached bounds
    if (from >= this.startSec && to <= this.endSec) {
      const candles = this.candles.filter(b => b.time >= from && b.time <= to);
      const candidates = this.candidates.filter(e => {
        const eStart = e.timeStart || e.time;
        const eEnd = e.timeEnd || Infinity;
        return eStart <= to && eEnd >= from;
      });
      return { candles, candidates };
    }
    return null;
  }

  /**
   * Set or merge new range data from the server.
   */
  setRange(symbol, timeframe, mode, from, to, candles, candidates) {
    if (this.symbol !== symbol || this.timeframe !== timeframe || this.mode !== mode) {
      this.symbol = symbol;
      this.timeframe = timeframe;
      this.mode = mode;
      this.candles = candles;
      this.candidates = candidates;
      this.startSec = from;
      this.endSec = to;
      return;
    }

    // Merge candles (unique by time)
    const candlesMap = new Map();
    this.candles.forEach(c => candlesMap.set(c.time, c));
    candles.forEach(c => candlesMap.set(c.time, c));
    this.candles = Array.from(candlesMap.values()).sort((a, b) => a.time - b.time);

    // Merge candidates (unique by id)
    const candidatesMap = new Map();
    this.candidates.forEach(e => candidatesMap.set(e.id, e));
    candidates.forEach(e => candidatesMap.set(e.id, e));
    this.candidates = Array.from(candidatesMap.values());

    this.startSec = Math.min(this.startSec, from);
    this.endSec = Math.max(this.endSec, to);

    // Prune cache if it becomes too large (more than 30,000 items) to prevent memory leak
    if (this.candles.length > 30000) {
      this.candles = this.candles.slice(-20000);
      this.startSec = this.candles[0].time;
      this.candidates = this.candidates.filter(e => (e.timeStart || e.time) >= this.startSec);
    }
  }
}

export const slidingWindowCache1 = new SlidingWindowCache();
export const slidingWindowCache2 = new SlidingWindowCache();
