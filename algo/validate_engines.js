const { DatabaseSync } = require('node:sqlite');
const path = require('path');

function main() {
  const dbPath = path.join(__dirname, '..', 'market_research_v2.db');
  console.log('='.repeat(50));
  console.log(`Auditing SQLite Database at: ${dbPath}`);
  console.log('='.repeat(50));

  const db = new DatabaseSync(dbPath);

  // 1. Total event count
  const total = db.prepare('SELECT COUNT(*) as count FROM structure_events').get().count;
  console.log(`Total Events in Database: ${total}`);
  console.log('='.repeat(50));

  // 2. Count by concept family and type
  const counts = db.prepare(`
    SELECT concept_family, concept_type, COUNT(*) as count
    FROM structure_events
    GROUP BY concept_family, concept_type
    ORDER BY concept_family, concept_type
  `).all();

  console.log('Event Counts by Concept Family and Type:');
  counts.forEach(row => {
    console.log(`  - [${row.concept_family}] ${row.concept_type}: ${row.count}`);
  });
  console.log('='.repeat(50));

  // 3. Count by timeframe
  const tfCounts = db.prepare(`
    SELECT timeframe, COUNT(*) as count
    FROM structure_events
    GROUP BY timeframe
    ORDER BY timeframe
  `).all();

  console.log('Event Counts by Timeframe:');
  tfCounts.forEach(row => {
    console.log(`  - Timeframe ${row.timeframe}m: ${row.count}`);
  });
  console.log('='.repeat(50));
}

main();
