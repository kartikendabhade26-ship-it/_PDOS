const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'market_research_v2.db');
const db = new DatabaseSync(targetPath);

try {
  const rows = db.prepare("SELECT concept_type, COUNT(*) as count FROM structure_events GROUP BY concept_type").all();
  console.log('--- Concept Counts ---');
  rows.forEach(r => {
    console.log(`${r.concept_type}: ${r.count}`);
  });
} catch (e) {
  console.error('Error running query:', e);
}
