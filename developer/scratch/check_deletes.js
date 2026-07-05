const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

const symbol = 'NQ_Historical_Data';
console.log("Executing DELETE statements...");
try {
  console.log("Deleting structure_events...");
  let res = db.prepare('DELETE FROM structure_events WHERE symbol = ?').run(symbol);
  console.log("Deleted structure_events rows:", res.changes);

  console.log("Deleting liquidity_objects...");
  res = db.prepare('DELETE FROM liquidity_objects WHERE symbol = ?').run(symbol);
  console.log("Deleted liquidity_objects rows:", res.changes);

  console.log("Deleting research_runs...");
  res = db.prepare('DELETE FROM research_runs WHERE symbol = ?').run(symbol);
  console.log("Deleted research_runs rows:", res.changes);

  console.log("Deleting research_jobs...");
  res = db.prepare('DELETE FROM research_jobs WHERE symbol = ?').run(symbol);
  console.log("Deleted research_jobs rows:", res.changes);

  console.log("Deletes completed successfully!");
} catch (err) {
  console.error("Delete failed:", err);
}
