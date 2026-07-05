const { getDB, closeAllDBs } = require('../../algo/db');

try {
  const db = getDB('market_research_v2.db');
  
  // Count dealing ranges
  const count = db.prepare("SELECT COUNT(*) as cnt FROM structure_events WHERE concept_type = 'Dealing Range'").get();
  console.log('Dealing Range count:', count.cnt);
  
  // Sample dealing ranges
  const sample = db.prepare("SELECT event_id, concept_type, time_start, time_end, price_high, price_low, direction, concept_state, timeframe, properties FROM structure_events WHERE concept_type = 'Dealing Range' LIMIT 10").all();
  console.log('\nSample Dealing Ranges:');
  sample.forEach((r, i) => {
    let props = {};
    try { props = JSON.parse(r.properties || '{}'); } catch(e) {}
    console.log(`  [${i}] id=${r.event_id} tf=${r.timeframe} dir=${r.direction} state=${r.concept_state} time=${r.time_start}-${r.time_end} high=${r.price_high} low=${r.price_low}`);
    console.log(`       props:`, JSON.stringify(props));
  });

  // Count by timeframe
  const byTf = db.prepare("SELECT timeframe, COUNT(*) as cnt FROM structure_events WHERE concept_type = 'Dealing Range' GROUP BY timeframe ORDER BY timeframe").all();
  console.log('\nDealing Ranges by timeframe:', JSON.stringify(byTf));

  // Count ALL event types for reference
  const allTypes = db.prepare("SELECT concept_type, COUNT(*) as cnt FROM structure_events GROUP BY concept_type ORDER BY cnt DESC").all();
  console.log('\nAll event types:');
  allTypes.forEach(r => console.log(`  ${r.concept_type}: ${r.cnt}`));

} catch (err) {
  console.error('Error:', err.message);
} finally {
  closeAllDBs();
}
