const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

console.log("Querying dealing ranges by timeframe...");
try {
  const counts = db.prepare(`
    SELECT timeframe, COUNT(*) as count
    FROM structure_events
    WHERE concept_type = 'Dealing Range'
    GROUP BY timeframe;
  `).all();
  console.log("Counts:", counts);
} catch (err) {
  console.error("Query failed:", err);
}
db.close();
