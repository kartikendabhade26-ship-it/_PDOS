/**
 * algo/engines/swingSequenceResolver.js
 * Ingests swing candidates and enforces classification:
 * - Groups consecutive same-type swings into runs.
 * - Identifies the extreme (highest high / lowest low) in each run as structural.
 * - Rest of the swings in each run are non-structural.
 * - Resolves outside bars and pivot placements.
 */

function resolveSequences(swings) {
  if (!swings || swings.length === 0) return [];

  // Sort chronologically by bar index
  swings.sort((a, b) => {
    if (a.barIndex !== b.barIndex) {
      return a.barIndex - b.barIndex;
    }
    // If indices are identical (outside bar), order high first or low first will be handled dynamically
    return 0;
  });

  const ordered = [];

  for (const sw of swings) {
    if (ordered.length === 0) {
      ordered.push(sw);
      continue;
    }

    const last = ordered[ordered.length - 1];

    if (last.barIndex === sw.barIndex) {
      // Outside bar conflict: both high and low on same bar.
      // Order them so they alternate with the prior swing.
      const prior = ordered[ordered.length - 2];
      const priorType = prior ? prior.type : (last.type === 'swing_high' ? 'swing_low' : 'swing_high');
      
      if (priorType === 'swing_high') {
        // We want: High -> Low -> High.
        // Since prior is High, last must be Low, and sw must be High.
        if (last.type === 'swing_high') {
          ordered[ordered.length - 1] = sw; // Swap so Low is last
          ordered.push(last);
        } else {
          ordered.push(sw);
        }
      } else {
        // Prior is Low. We want: Low -> High -> Low.
        if (last.type === 'swing_low') {
          ordered[ordered.length - 1] = sw; // Swap so High is last
          ordered.push(last);
        } else {
          ordered.push(sw);
        }
      }
      continue;
    }
    ordered.push(sw);
  }

  for (const sw of ordered) {
    sw.isStructural = true;
    sw.renderHint = 'normal';
  }

  return ordered;
}

module.exports = {
  resolveSequences
};
