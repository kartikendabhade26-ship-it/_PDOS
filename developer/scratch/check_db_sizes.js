// developer/scratch/check_db_sizes.js
const { getDB } = require('../../algo/db');
process.env.USE_TEST_DB = 'true';
const db = getDB();

try {
  const eventsCount = db.prepare("SELECT COUNT(*) as count FROM structure_events").get().count;
  const relationsCount = db.prepare("SELECT COUNT(*) as count FROM event_relationships").get().count;
  console.log(`structure_events count: ${eventsCount}`);
  console.log(`event_relationships count: ${relationsCount}`);
} catch (e) {
  console.error(e);
}
