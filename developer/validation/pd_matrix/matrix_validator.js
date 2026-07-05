/**
 * validation/pd_matrix/matrix_validator.js
 * Asserts the correctness and boundary constraints of the PD Array Context Engine
 * and the resulting PD Array Matrix events in the database.
 */

function runPDMatrixValidation(db, benchmark, runId = 'run_dev', verbose = false) {
  const errors = [];

  try {
    // 1. Fetch all PD Array Matrix events
    const matrices = db.prepare(`
      SELECT event_id, price_high, price_low, timeframe, properties
      FROM structure_events
      WHERE symbol = ? AND concept_type = 'PD Array Matrix'
        AND run_id = ?
    `).all(benchmark.symbol, runId);

    if (verbose) {
      console.log(`    [VERBOSE] PD Matrix Validator: Detected Matrices=${matrices.length}`);
    }

    if (matrices.length === 0) {
      errors.push(`No PD Array Matrix events ('PD_ARRAY_CONTEXT_v1') were generated for symbol: ${benchmark.symbol}`);
      return { passed: false, errors };
    }

    for (const matrix of matrices) {
      let props = {};
      try {
        props = JSON.parse(matrix.properties);
      } catch (err) {
        errors.push(`Matrix ${matrix.event_id} has invalid JSON properties: ${err.message}`);
        continue;
      }

      const activeRangeId = props.activeRangeId;
      if (!activeRangeId) {
        errors.push(`Matrix ${matrix.event_id} is missing 'activeRangeId' association.`);
        continue;
      }

      // Verify the associated range exists in the database
      const rangeCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM structure_events 
        WHERE event_id = ? AND concept_type = 'Dealing Range'
          AND run_id = ?
      `).get(activeRangeId, runId);

      if (rangeCount.count === 0) {
        errors.push(`Matrix ${matrix.event_id} references Dealing Range '${activeRangeId}' which does not exist in the database.`);
      }

      const activePdArrays = props.activePdArrays || [];
      for (const arrId of activePdArrays) {
        // Query the array details
        const arr = db.prepare(`
          SELECT event_id, price_high, price_low, timeframe, concept_type
          FROM structure_events
          WHERE event_id = ? AND run_id = ?
        `).get(arrId, runId);

        if (!arr) {
          errors.push(`Matrix ${matrix.event_id} lists active array '${arrId}' which was not saved to structure_events.`);
          continue;
        }

        // Verify spatial boundaries: the array must fit inside the active quadrant/dealing range price boundaries
        const fitsInside = arr.price_low >= (matrix.price_low - 0.05) && arr.price_high <= (matrix.price_high + 0.05);
        if (!fitsInside) {
          errors.push(`Spatial constraint violation: Array '${arrId}' [${arr.price_low}, ${arr.price_high}] lies outside matrix boundaries [${matrix.price_low}, ${matrix.price_high}]`);
        }

        // Verify timeframe match
        if (arr.timeframe !== matrix.timeframe) {
          errors.push(`Timeframe mismatch: Array '${arrId}' (tf=${arr.timeframe}) is associated with matrix '${matrix.event_id}' (tf=${matrix.timeframe})`);
        }

        // Verify relationship link exists in database: range contains array
        const rel = db.prepare(`
          SELECT COUNT(*) as count 
          FROM event_relationships 
          WHERE parent_event_id = ? AND child_event_id = ? AND relationship_type = 'contains'
            AND run_id = ?
        `).get(activeRangeId, arrId, runId);

        if (rel.count === 0) {
          errors.push(`Missing database relationship link: Range '${activeRangeId}' does not have a 'contains' link to Array '${arrId}'`);
        }
      }
    }
  } catch (err) {
    errors.push(`Query or execution error in PD Matrix validator: ${err.message}`);
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

module.exports = {
  runPDMatrixValidation
};
