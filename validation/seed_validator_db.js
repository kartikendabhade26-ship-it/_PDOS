const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { parseDateTimeToEpoch } = require('../algo/dataLoader');
const { syncSymbolPipeline } = require('../algo/pipeline');

async function main() {
  process.env.USE_TEST_DB = 'true';
  const csvPath = path.join(__dirname, '../NQ_Historical_Data.csv');
  console.log(`Reading CSV from ${csvPath}...`);
  
  const minTime = 1735000000; // Dec 24, 2024
  const maxTime = 1737500000; // Jan 22, 2025

  const fileStream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const bars = [];
  let headerSkipped = false;
  
  for await (const line of rl) {
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const t = parseDateTimeToEpoch(parts[0]);
    if (t < minTime) continue;
    if (t > maxTime) break; // CSV is sorted chronologically

    const o = parseFloat(parts[1]);
    const h = parseFloat(parts[2]);
    const l = parseFloat(parts[3]);
    const c = parseFloat(parts[4]);
    const v = parts[5] ? parseFloat(parts[5]) : 0;

    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
  }

  console.log(`Parsed ${bars.length} bars within date range. Syncing pipeline...`);
  
  // Clean target DB before run
  const { getDB } = require('../algo/db');
  const db = getDB('market_research_test.db');
  db.prepare("DELETE FROM structure_events").run();
  db.prepare("DELETE FROM event_relationships").run();
  db.prepare("DELETE FROM event_outcomes").run();
  db.prepare("DELETE FROM event_context_snapshots").run();
  db.prepare("DELETE FROM liquidity_objects").run();
  db.prepare("DELETE FROM market_bars").run();

  await syncSymbolPipeline('NQ_Historical_Data', bars, 'run_dev');
  console.log("Seeding validator DB complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
