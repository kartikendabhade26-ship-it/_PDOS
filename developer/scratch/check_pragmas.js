const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

console.log("Checking database pragmas...");
try {
  const journalMode = db.prepare('PRAGMA journal_mode;').get();
  console.log("journal_mode:", journalMode);

  const synchronous = db.prepare('PRAGMA synchronous;').get();
  console.log("synchronous:", synchronous);

  const busyTimeout = db.prepare('PRAGMA busy_timeout;').get();
  console.log("busy_timeout:", busyTimeout);

  const foreignKeys = db.prepare('PRAGMA foreign_keys;').get();
  console.log("foreign_keys:", foreignKeys);
} catch (err) {
  console.error("Pragma query failed:", err);
}
db.close();
