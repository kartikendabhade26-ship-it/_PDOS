const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

console.log("Existing tables in database:");
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("Tables:", tables.map(t => t.name));
} catch (err) {
  console.error("Query failed:", err);
}
db.close();
