/**
 * algo/EngineManifest.js
 * Tracks version signatures and environment hashes for reproducible market research runs.
 */

const { execSync } = require('child_process');
const { getDB } = require('./db');

let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 1000 }).trim();
} catch (e) {
  // Silent fallback
}

let sqliteVersion = 'unknown';
try {
  const db = getDB();
  const res = db.prepare('SELECT sqlite_version() as version').get();
  if (res && res.version) {
    sqliteVersion = res.version;
  }
} catch (e) {
  // Silent fallback
}

const manifest = {
  // Semantic component versions
  schema_version: '2.0.0',
  swing_engine_version: '1.0.0',
  liquidity_engine_version: '1.0.0',
  replay_engine_version: '1.0.0',
  research_engine_version: '1.0.0',
  query_engine_version: '1.0.0',

  // Environmental audit parameters
  git_commit: gitCommit,
  node_version: process.version,
  sqlite_version: sqliteVersion,
  build_date: new Date().toISOString()
};

module.exports = manifest;
