const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

try {
  const rows = db.prepare("SELECT event_id, properties, time_start FROM structure_events WHERE concept_type = 'Dealing Range' ORDER BY rowid DESC LIMIT 5").all();
  rows.forEach(r => {
    console.log(`Event ID: ${r.event_id}, Time: ${r.time_start}`);
    try {
      console.log('Properties:', JSON.stringify(JSON.parse(r.properties), null, 2));
    } catch(e) {
      console.log('Raw Properties:', r.properties);
    }
    console.log('------------------------');
  });
} catch(e) {
  console.error(e);
} finally {
  db.close();
}
