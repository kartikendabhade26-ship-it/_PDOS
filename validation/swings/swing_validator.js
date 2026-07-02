/**
 * validation/swings/swing_validator.js
 * Asserts correct fractal pivot detection counts and locations.
 */

const SwingEngine = require('../../algo/engines/swingEngine');

function runSwingValidation(db, benchmark, runId = 'run_dev', verbose = false) {
  const errors = [];
  const swingEngine = new SwingEngine();

  // Load expected swings from benchmark session
  const expectedSwings = benchmark.expected_events.swings || [];

  // Query events of type Swing or Strong Swing from database for this session date
  // Since time is stored as epoch, we fetch events where time_start matches
  const expectedTimes = expectedSwings.map(s => s.time);
  if (expectedTimes.length === 0) {
    return { passed: true, errors };
  }

  const minTime = Math.min(...expectedTimes) - 3600;
  const maxTime = Math.max(...expectedTimes) + 3600;

  try {
    const detected = db.prepare(`
      SELECT event_id, concept_type, time_start, price_high, price_low, direction 
      FROM structure_events 
      WHERE symbol = ? COLLATE NOCASE 
        AND concept_family = 'Swings' 
        AND time_start BETWEEN ? AND ?
        AND run_id = ?
    `).all(benchmark.symbol, minTime, maxTime, runId);

    if (verbose) {
      console.log(`    [VERBOSE] Swing Validator: Expected=${expectedSwings.length}, Detected=${detected.length}`);
    }

    for (const exp of expectedSwings) {
      const match = detected.find(d => d.time_start === exp.time && d.direction === exp.direction);
      if (!match) {
        errors.push(`Missing expected swing: ${exp.direction} swing at timestamp ${exp.time} was not detected.`);
      } else {
        const detectedPrice = exp.direction === 'bullish' ? match.price_low : match.price_high;
        if (Math.abs(detectedPrice - exp.price) > 0.01) {
          errors.push(`Swing price discrepancy: expected ${exp.price}, but detected ${detectedPrice} for swing at ${exp.time}.`);
        }
      }
    }
  } catch (err) {
    errors.push(`Query error: ${err.message}`);
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

module.exports = {
  runSwingValidation
};
