/**
 * validation/liquidity/liquidity_validator.js
 * Asserts correct Equal High/Low clustering prices and lifecycles.
 */

function runLiquidityValidation(db, benchmark, runId = 'run_dev', verbose = false) {
  const errors = [];
  const expectedPools = benchmark.expected_events.liquidity_pools || [];

  const expectedPrices = expectedPools.map(p => p.level_price);
  if (expectedPrices.length === 0) {
    return { passed: true, errors };
  }

  try {
    const detected = db.prepare(`
      SELECT event_id, concept_type, time_start, price_high, price_low, direction, properties 
      FROM structure_events 
      WHERE symbol = ? COLLATE NOCASE 
        AND concept_family = 'Liquidity'
        AND run_id = ?
    `).all(benchmark.symbol, runId);

    if (verbose) {
      console.log(`    [VERBOSE] Liquidity Validator: Expected=${expectedPools.length}, Detected=${detected.length}`);
    }

    for (const exp of expectedPools) {
      // Find matching pool based on direction type and close price
      const match = detected.find(d => {
        let props = {};
        try { props = JSON.parse(d.properties); } catch (e) {}
        const levelPrice = props.levelPrice || d.price_high; // fallback
        return d.direction === exp.direction && Math.abs(levelPrice - exp.level_price) <= 0.05;
      });

      if (!match) {
        errors.push(`Missing expected liquidity pool: direction=${exp.direction}, levelPrice=${exp.level_price} was not detected.`);
      } else {
        // Assert generic relationships link Contributing Swings
        let props = {};
        try { props = JSON.parse(match.properties); } catch (e) {}
        const contributingSwingIds = props.contributingSwingIds || [];
        
        // Query database event_relationships to make sure it was populated
        const relations = db.prepare(`
          SELECT child_event_id FROM event_relationships 
          WHERE parent_event_id = ? AND relationship_type = 'contributed_to'
        `).all(match.event_id);

        if (relations.length === 0) {
          errors.push(`Missing generic relationships: Liquidity pool ${match.event_id} has no 'contributed_to' swing relationships stored.`);
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
  runLiquidityValidation
};
