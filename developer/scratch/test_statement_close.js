const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('market_research_v2.db');

const stmt = db.prepare('SELECT 1;');
console.log("Statement methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(stmt)));
db.close();
