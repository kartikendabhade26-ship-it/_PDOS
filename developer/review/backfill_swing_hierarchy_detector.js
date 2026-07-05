#!/usr/bin/env node
/**
 * backfill_swing_hierarchy_detector.js
 *
 * One-time backfill: inserts the missing SWING_HIERARCHY_v1 row into the
 * detector_versions table of existing SQLite databases.
 *
 * Root cause: algo/db.js's seedVersions array was missing the SWING_HIERARCHY_v1
 * entry, but algo/pipeline.js:330 emits that detector_id for every degree-2+
 * swing. Result: 37k-49k structure_events rows had no matching parent in
 * detector_versions → foreign_key_check failures.
 *
 * The db.js fix (already applied) will seed this row for any NEW database
 * created from scratch. This script patches EXISTING databases so they don't
 * need a full re-sync.
 *
 * Usage:
 *   node backfill_swing_hierarchy_detector.js                  # patches market_research_v2.db (prod)
 *   USE_TEST_DB=true node backfill_swing_hierarchy_detector.js  # patches market_research_test.db
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_NAME = process.env.USE_TEST_DB === 'true'
  ? 'market_research_test.db'
  : 'market_research_v2.db';
const DB_PATH = path.join(__dirname, DB_NAME);

console.log(`Backfilling SWING_HIERARCHY_v1 into ${DB_PATH}`);

const db = new DatabaseSync(DB_PATH);

// Check if already present
const existing = db.prepare("SELECT detector_id FROM detector_versions WHERE detector_id = 'SWING_HIERARCHY_v1'").get();
if (existing) {
  console.log('  SWING_HIERARCHY_v1 already present — nothing to do.');
  process.exit(0);
}

// Insert the missing row
db.prepare(
  "INSERT INTO detector_versions (detector_id, concept_type, description) VALUES (?, ?, ?)"
).run(
  'SWING_HIERARCHY_v1',
  'swing_hierarchy',
  'Degree-2+ (ITH/ITL/LTH/LTL) hierarchical swing pivot detector'
);
console.log('  Inserted SWING_HIERARCHY_v1 into detector_versions.');

// Verify
const check = db.prepare("PRAGMA foreign_key_check;").all();
const swingHierarchyViolations = check.filter(v => v.parent === 'detector_versions');
console.log(`  Remaining detector_versions FK violations: ${swingHierarchyViolations.length}`);

const totalEvents = db.prepare(
  "SELECT COUNT(*) as c FROM structure_events WHERE detector_id = 'SWING_HIERARCHY_v1'"
).get();
console.log(`  structure_events with SWING_HIERARCHY_v1: ${totalEvents.c} rows now have a valid parent.`);

console.log('Done.');
