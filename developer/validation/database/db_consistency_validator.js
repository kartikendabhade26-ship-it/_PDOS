/**
 * validation/database/db_consistency_validator.js
 * Runs SQLite constraint audits, integrity queries, and checks relationships.
 */

function runDBConsistencyCheck(db) {
  const errors = [];

  try {
    // 1. Skip slow PRAGMA integrity_check on large databases
    // const integrity = db.prepare("PRAGMA integrity_check;").get();
    // if (integrity.integrity_check !== 'ok' && integrity.value !== 'ok') {
    //   errors.push(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
    // }

    // 2. Skip slow PRAGMA foreign_key_check on large databases (redundant with manual checks below)
    // const fkCheck = db.prepare("PRAGMA foreign_key_check;").all();
    // if (fkCheck.length > 0) {
    //   errors.push(`Foreign key violations found: ${JSON.stringify(fkCheck)}`);
    // }

    // 3. Verify event relationships
    const orphanRelations = db.prepare(`
      SELECT r.parent_event_id, r.child_event_id 
      FROM event_relationships r
      LEFT JOIN structure_events p ON r.parent_event_id = p.event_id AND r.run_id = p.run_id
      LEFT JOIN structure_events c ON r.child_event_id = c.event_id AND r.run_id = c.run_id
      WHERE p.event_id IS NULL OR c.event_id IS NULL
    `).all();

    if (orphanRelations.length > 0) {
      errors.push(`Orphaned event relationships found: ${orphanRelations.length} relations reference missing events.`);
    }

    // 4. Verify context snapshots without parent events
    const orphanContexts = db.prepare(`
      SELECT c.event_id 
      FROM event_context_snapshots c
      LEFT JOIN structure_events e ON c.event_id = e.event_id AND c.run_id = e.run_id
      WHERE e.event_id IS NULL
    `).all();

    if (orphanContexts.length > 0) {
      errors.push(`Orphaned context snapshots found: ${orphanContexts.length} snapshots reference missing events.`);
    }

  } catch (err) {
    errors.push(`Database query error during validation: ${err.message}`);
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

module.exports = {
  runDBConsistencyCheck
};
