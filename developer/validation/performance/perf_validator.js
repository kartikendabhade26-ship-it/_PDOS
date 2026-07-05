/**
 * validation/performance/perf_validator.js
 * Validates throughput speed (bars/sec) and memory footprint leakage.
 */

const { getCandidates } = require('../../../algo/detector');

function runPerformanceCheck() {
  // Generate mock bars to run performance benchmarks
  const barCount = 100000;
  const mockBars = [];
  let basePrice = 18000;
  for (let i = 0; i < barCount; i++) {
    const high = basePrice + 5 + Math.random() * 5;
    const low = basePrice - 5 - Math.random() * 5;
    const close = basePrice + (Math.random() - 0.5) * 6;
    mockBars.push({
      time: 1700000000 + i * 60,
      open: basePrice,
      high,
      low,
      close,
      volume: 100 + Math.floor(Math.random() * 500)
    });
    basePrice = close;
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const memoryBefore = process.memoryUsage().heapUsed;
  const t0 = Date.now();

  // Trigger candidate detection for FVG, swing, and liquidity
  const fvgs = getCandidates('fvg_bullish', mockBars, 1000);
  const swings = getCandidates('swing_bullish', mockBars, 1000);
  const liquidity = getCandidates('liquidity_bsl', mockBars, 1000);

  const duration = Date.now() - t0;
  
  if (global.gc) {
    global.gc();
  }
  const memoryAfter = process.memoryUsage().heapUsed;

  const barsPerSecond = (barCount / duration) * 1000;
  const heapDeltaMb = (memoryAfter - memoryBefore) / (1024 * 1024);

  return {
    passed: barsPerSecond >= 20000 && heapDeltaMb <= 20.0, // adjusted base throughput threshold for test environment
    barsPerSecond,
    heapDeltaMb,
    timeMs: duration
  };
}

module.exports = {
  runPerformanceCheck
};
