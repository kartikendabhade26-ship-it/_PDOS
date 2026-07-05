const {getDB} = require('./algo/db');
const db = getDB();

// What does the server actually send as 'type' for swings?
const swings = db.prepare(`
  SELECT concept_type, concept_family, direction, price_high, price_low, time_start, properties
  FROM structure_events 
  WHERE symbol='NQ_Historical_Data' AND concept_family='Swings' 
  LIMIT 5
`).all();
console.log('DB Swing rows:');
swings.forEach(s => console.log(' ', JSON.stringify(s)));

// Check what the server API route returns for concept field
const api = db.prepare(`
  SELECT concept_type, concept_family, direction
  FROM structure_events 
  WHERE symbol='NQ_Historical_Data' 
  GROUP BY concept_type, concept_family
  ORDER BY concept_family, concept_type
`).all();
console.log('\nAll concept_type + concept_family combos:');
api.forEach(r => console.log(' ', r.concept_family, '|', r.concept_type));
