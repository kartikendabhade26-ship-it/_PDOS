/**
 * validation/liquidity/registry_validator.js
 * Asserts the correctness, immutability, and constraints of the Liquidity Registry.
 */

function runRegistryValidation(db, benchmark, runId = 'run_dev', verbose = false) {
  const errors = [];
  const symbol = benchmark.symbol;

  try {
    // 1. Assert: Database Schema has no mutable "status" or lifecycle columns
    const schemaInfo = db.prepare("PRAGMA table_info(liquidity_objects);").all();
    const statusCol = schemaInfo.find(c => c.name === 'status');
    if (statusCol) {
      errors.push(`Immutability violation: Table 'liquidity_objects' contains a mutable 'status' column.`);
    }

    // Safeguard: Check that direction column in structure_events for 'Liquidity' family ONLY contains 'bsl' or 'ssl'
    const invalidDirections = db.prepare(`
      SELECT DISTINCT direction FROM structure_events 
      WHERE symbol = ? COLLATE NOCASE 
        AND concept_family = 'Liquidity' 
        AND run_id = ? 
        AND direction NOT IN ('bsl', 'ssl')
    `).all(symbol, runId);
    
    if (invalidDirections.length > 0) {
      errors.push(`Safeguard violation: Found invalid direction values in structure_events: ${invalidDirections.map(d => d.direction).join(', ')}. Direction must strictly be 'bsl' or 'ssl'.`);
    }

    // 2. Fetch all swings and liquidity objects in the database for this run
    const swings = db.prepare(`
      SELECT event_id, concept_type, direction, timeframe, symbol, price_high, price_low, properties
      FROM structure_events
      WHERE symbol = ? COLLATE NOCASE AND concept_family = 'Swings' AND run_id = ?
    `).all(symbol, runId);

    const liqObjects = db.prepare(`
      SELECT liquidity_id, parent_swing_id, price, parent_swing_type, liquidity_side, swing_degree, timeframe, symbol,
             origin_bar_index, confirmation_bar_index, origin_timestamp, metadata
      FROM liquidity_objects
      WHERE symbol = ? COLLATE NOCASE AND run_id = ?
    `).all(symbol, runId);

    if (verbose) {
      console.log(`    [VERBOSE] Registry Validator: Swings=${swings.length}, Liquidity Objects=${liqObjects.length}`);
    }

    // Assert: Every confirmed Swing creates exactly one Liquidity Object.
    // Assert: Liquidity count equals confirmed Swing count.
    if (swings.length !== liqObjects.length) {
      errors.push(`Count mismatch: Swings in database: ${swings.length}, Liquidity Objects: ${liqObjects.length}. Swing count must match Liquidity count exactly.`);
    }

    // Map swings by ID for quick lookups
    const swingsMap = new Map();
    for (const sw of swings) {
      swingsMap.set(sw.event_id, sw);
    }

    // 3. Assert: Mapping correctness & terminology
    for (const liq of liqObjects) {
      const parentSwing = swingsMap.get(liq.parent_swing_id);
      if (!parentSwing) {
        errors.push(`Orphan Liquidity Object: ${liq.liquidity_id} references non-existent parent swing ${liq.parent_swing_id}.`);
        continue;
      }

      // Assert deterministic ID format
      const expectedLiqId = `liquidity_${parentSwing.event_id}`;
      if (liq.liquidity_id !== expectedLiqId) {
        errors.push(`Deterministic ID violation: Got ID ${liq.liquidity_id}, expected ${expectedLiqId}`);
      }

      // Assert parent swing type mapping
      const expectedSwingType = parentSwing.concept_type.startsWith('LT') || parentSwing.concept_type.startsWith('IT') || parentSwing.concept_type.startsWith('ST')
        ? (parentSwing.concept_type.endsWith('H') ? 'high' : 'low')
        : (parentSwing.concept_type.toLowerCase().includes('high') ? 'high' : 'low');
      if (liq.parent_swing_type !== expectedSwingType) {
        errors.push(`Terminology error: parent_swing_type for ${liq.liquidity_id} is '${liq.parent_swing_type}', expected '${expectedSwingType}'`);
      }

      // Assert price matching
      const swingPrice = expectedSwingType === 'high' ? parentSwing.price_high : parentSwing.price_low;
      if (Math.abs(liq.price - swingPrice) > 0.001) {
        errors.push(`Price mismatch for ${liq.liquidity_id}: Got price ${liq.price}, expected ${swingPrice}`);
      }

      // Assert liquidity side mapping (High -> buy_side, Low -> sell_side)
      const expectedSide = expectedSwingType === 'high' ? 'buy_side' : 'sell_side';
      if (liq.liquidity_side !== expectedSide) {
        errors.push(`Side terminology error: liquidity_side for ${liq.liquidity_id} is '${liq.liquidity_side}', expected '${expectedSide}'`);
      }

      // Assert confirmation timing bounds
      if (liq.confirmation_bar_index < liq.origin_bar_index) {
        errors.push(`Replay violation: confirmation_bar_index (${liq.confirmation_bar_index}) is before origin_bar_index (${liq.origin_bar_index}) on ${liq.liquidity_id}`);
      }

      // Assert session metadata format
      let metadata = {};
      try { metadata = JSON.parse(liq.metadata || '{}'); } catch (e) {}
      if (!metadata.session) {
        errors.push(`Metadata session missing for ${liq.liquidity_id}`);
      }
    }

    // 4. Assert: No orphan liquidity exists (database level scan)
    const orphans = db.prepare(`
      SELECT l.liquidity_id
      FROM liquidity_objects l
      LEFT JOIN structure_events e ON l.parent_swing_id = e.event_id AND e.run_id = l.run_id
      WHERE e.event_id IS NULL AND l.symbol = ? AND l.run_id = ?
    `).all(symbol, runId);
    if (orphans.length > 0) {
      errors.push(`Database integrity error: Found ${orphans.length} orphan liquidity objects without corresponding swing records.`);
    }

    // 5. Assert: Price independence (duplicate prices produce distinct liquidity objects)
    const priceGroups = new Map();
    for (const l of liqObjects) {
      if (!priceGroups.has(l.price)) {
        priceGroups.set(l.price, []);
      }
      priceGroups.get(l.price).push(l);
    }
    for (const [price, group] of priceGroups.entries()) {
      if (group.length > 1) {
        // Assert they have different parent swings
        const parentIds = new Set(group.map(g => g.parent_swing_id));
        if (parentIds.size !== group.length) {
          errors.push(`Duplicate price violation: Price ${price} has multiple liquidity objects sharing the exact same parent swing!`);
        }
      }
    }

  } catch (err) {
    errors.push(`Validation exception: ${err.message}`);
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

module.exports = {
  runRegistryValidation
};
