/**
 * validation/rendering/render_validator.js
 * Verifies canvas coordinate mapping logic projections.
 */

function runRenderingCheck() {
  const errors = [];

  // Mock timescale projection logic similar to pointToCoords in DrawingCanvas
  const mockTimescale = {
    logicalToCoordinate: (logical) => {
      if (logical < 0 || logical > 5000) return null;
      return logical * 10.0; // scale factor
    },
    options: () => ({ barSpacing: 10.0 }),
    getVisibleLogicalRange: () => ({ from: 100, to: 1000 })
  };

  const mockSeries = {
    priceToCoordinate: (price) => {
      if (price < 10000 || price > 30000) return null;
      return 1000.0 - (price - 10000) * 0.05; // mock price conversion
    }
  };

  const mockBars = Array.from({ length: 2000 }, (_, idx) => ({
    time: 1700000000 + idx * 60,
    price: 18000 + idx * 0.5
  }));

  const mockPointToCoords = (point) => {
    let logical = mockBars.findIndex(b => b.time === point.time);
    if (logical === -1) return null;
    const x = mockTimescale.logicalToCoordinate(logical);
    const y = mockSeries.priceToCoordinate(point.price);
    return { x, y };
  };

  // Test event coordinates
  const eventsToTest = [
    { type: 'fvg', priceHigh: 18200.5, priceLow: 18180.25, timeStart: 1700000000 + 100 * 60, timeEnd: 1700000000 + 102 * 60 },
    { type: 'liquidity', levelPrice: 19500.0, time: 1700000000 + 500 * 60 }
  ];

  for (const e of eventsToTest) {
    const startPt = { time: e.timeStart || e.time, price: e.priceHigh || e.levelPrice };
    const coords = mockPointToCoords(startPt);
    if (!coords || coords.x === null || coords.y === null) {
      errors.push(`Failed to calculate rendering coordinates for event type ${e.type}`);
    } else {
      if (coords.x < 0 || coords.y < 0) {
        errors.push(`Render coordinate projection out of expected bounds: x=${coords.x}, y=${coords.y}`);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

module.exports = {
  runRenderingCheck
};
