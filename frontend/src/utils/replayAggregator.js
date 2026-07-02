/**
 * replayAggregator.js
 * 
 * Centralized aggregator for replaying multi-timeframe price bars.
 * Dynamically aggregates prices for active/developing higher-timeframe bars
 * from the underlying base-timeframe (1m) data to eliminate lookahead bias.
 */

/**
 * Reconstructs the last candle of a higher timeframe dataset if it is still developing at the active replay limitTime.
 * Open never changes, High only increases, Low only decreases, Close updates every minute.
 * 
 * @param {Array} bars - The higher-timeframe bars (e.g. 15m)
 * @param {Array} allBars - The base-timeframe bars (e.g. 1m)
 * @param {number} timeframe - The higher timeframe in minutes (e.g. 15)
 * @param {number} limitTime - The active replay timestamp (in seconds)
 * @returns {Array} - The filtered and aggregated bars
 */
export function aggregateDevelopingCandle(bars, allBars, timeframe, limitTime) {
  if (!bars || bars.length === 0) return [];
  if (!allBars || allBars.length === 0) return bars.filter(b => b.time <= limitTime);

  const filtered = bars.filter(b => b.time <= limitTime);
  if (filtered.length === 0) return filtered;

  const lastBar = filtered[filtered.length - 1];
  const tfSec = timeframe * 60;

  // Check if this bar is still developing at the active replay limitTime
  if (lastBar.time + tfSec > limitTime) {
    const subBars = allBars.filter(sub => sub.time >= lastBar.time && sub.time <= limitTime);
    if (subBars.length > 0) {
      filtered[filtered.length - 1] = {
        ...lastBar,
        open: subBars[0].open,
        high: Math.max(...subBars.map(s => s.high)),
        low: Math.min(...subBars.map(s => s.low)),
        close: subBars[subBars.length - 1].close,
        volume: subBars.reduce((sum, s) => sum + (s.volume || 0), 0),
      };
    }
  }
  return filtered;
}
