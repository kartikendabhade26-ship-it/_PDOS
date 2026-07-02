/**
 * algo/engines/swingValidator.js
 * Strictly validates all swings before they are finalized and saved.
 */

class SwingValidator {
  /**
   * Validates a complete array of swings (all degrees merged).
   * Returns { isValid: boolean, errors: string[] }
   */
  validate(swings) {
    const errors = [];
    if (!swings || swings.length === 0) return { isValid: true, errors };

    const seenIds = new Set();
    const swingMap = new Map();
    swings.forEach(s => swingMap.set(s.id, s));

    // Group by degree for sequence checks
    const swingsByDegree = {};

    for (const sw of swings) {
      // 1. Uniqueness check
      if (seenIds.has(sw.id)) {
        errors.push(`Duplicate Swing ID detected: ${sw.id}`);
      }
      seenIds.add(sw.id);

      // 2. Metadata verification
      if (sw.degree === undefined || typeof sw.degree !== 'number') {
        errors.push(`Swing ${sw.id} is missing a numeric degree`);
      }
      if (sw.confirmationBar === undefined || typeof sw.confirmationBar !== 'number') {
        errors.push(`Swing ${sw.id} is missing confirmationBar`);
      }
      if (!sw.type || (sw.type !== 'swing_high' && sw.type !== 'swing_low')) {
        errors.push(`Swing ${sw.id} has invalid type: ${sw.type}`);
      }
      if (sw.timestamp === undefined || typeof sw.timestamp !== 'number') {
        errors.push(`Swing ${sw.id} is missing timestamp`);
      }

      // 3. Replay Safety Check: confirmationBar must be strictly greater than barIndex
      if (sw.confirmationBar <= sw.barIndex) {
        errors.push(`Replay Safety Failure for swing ${sw.id}: confirmationBar (${sw.confirmationBar}) must be > barIndex (${sw.barIndex})`);
      }

      // 4. Parent/Child Relationships Check
      if (sw.degree > 1) {
        if (!sw.childSwingIds || sw.childSwingIds.length === 0) {
          errors.push(`Hierarchy Failure for swing ${sw.id}: degree ${sw.degree} swing has no childSwingIds`);
        } else {
          // Check that children exist and have degree === sw.degree - 1
          sw.childSwingIds.forEach(childId => {
            const child = swingMap.get(childId);
            if (!child) {
              errors.push(`Hierarchy Link Failure for swing ${sw.id}: childSwingId ${childId} does not exist in the swing pool`);
            } else if (child.degree !== sw.degree - 1) {
              errors.push(`Hierarchy Degree mismatch for swing ${sw.id}: child ${childId} degree ${child.degree} must be ${sw.degree - 1}`);
            }
          });
        }
      }

      // Group for sequence and order checks
      const deg = sw.degree || 1;
      if (!swingsByDegree[deg]) swingsByDegree[deg] = [];
      swingsByDegree[deg].push(sw);
    }

    // 5. Degree Order Check: Verify no degree-3 swing without an underlying degree-2 swing at the same index
    const deg2Map = new Map();
    if (swingsByDegree[2]) {
      swingsByDegree[2].forEach(s => deg2Map.set(`${s.barIndex}_${s.type}`, s));
    }
    if (swingsByDegree[3]) {
      swingsByDegree[3].forEach(s => {
        if (!deg2Map.has(`${s.barIndex}_${s.type}`)) {
          errors.push(`Degree Order Failure: Degree 3 swing ${s.id} has no underlying Degree 2 swing at index ${s.barIndex}`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = SwingValidator;
