const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

console.log("Checking connection and executing queries...");
try {
  console.log("Querying structure_events...");
  const eventsCount = db.prepare('SELECT COUNT(*) as count FROM structure_events').get().count;
  console.log("Events count:", eventsCount);

  console.log("Querying event_context_snapshots...");
  const contextCount = db.prepare('SELECT COUNT(*) as count FROM event_context_snapshots').get().count;
  console.log("Context count:", contextCount);

  console.log("Querying event_outcomes...");
  const outcomesCount = db.prepare('SELECT COUNT(*) as count FROM event_outcomes').get().count;
  console.log("Outcomes count:", outcomesCount);

  console.log("Querying human_validations...");
  const validationsCount = db.prepare('SELECT COUNT(*) as count FROM human_validations').get().count;
  console.log("Validations count:", validationsCount);

  console.log("Querying detector_versions...");
  const versionsCount = db.prepare('SELECT COUNT(*) as count FROM detector_versions').get().count;
  console.log("Versions count:", versionsCount);

  console.log("All queries executed successfully!");
} catch (err) {
  console.error("Query failed:", err);
}
