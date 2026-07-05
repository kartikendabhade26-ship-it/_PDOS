const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

console.log("Querying event_relationships count...");
try {
  const count = db.prepare('SELECT COUNT(*) as count FROM event_relationships;').get();
  console.log("Count:", count);
} catch (err) {
  console.error("Query failed:", err);
}
db.close();
