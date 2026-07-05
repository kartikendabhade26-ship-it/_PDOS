const { DatabaseSync } = require('node:sqlite');
console.log("Trying to open DB...");
try {
  const db = new DatabaseSync('market_research_v2.db');
  console.log("Success! DB opened.");
  db.close();
} catch (e) {
  console.error("Failed to open DB:", e);
}
