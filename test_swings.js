/**
 * Quick smoke-test for the new findSwingsWindowed function.
 * Loads a slice of NQ data and compares 3-bar fractal vs windowed output.
 * Run from project root: node test_swings.js
 */
const { parseCsvFile } = require('./algo/dataLoader');
const { findSwings, findSwingsWindowed } = require('./algo/primitives');

(async () => {
  const filePath = 'D:\\nijna data\\Project 1 MNQ data\\NQ_Historical_Data.csv';

  console.log('Loading last 5000 1m bars (this takes a few seconds)...');
  const allBars = await parseCsvFile(filePath);
  const bars = allBars.slice(-5000);
  console.log(`Loaded ${bars.length} bars. First: ${new Date(bars[0].time * 1000).toISOString()}, Last: ${new Date(bars[bars.length-1].time * 1000).toISOString()}`);

  // 3-bar fractal (old behavior)
  const fractal = findSwings(bars, 1);
  console.log(`\n3-bar fractal:`);
  console.log(`  Highs: ${fractal.swingHighs.length}  Lows: ${fractal.swingLows.length}  Total: ${fractal.allSwings.length}`);

  // Windowed (new behavior)
  const w3  = findSwingsWindowed(bars, 3, 3, 1);
  const w5  = findSwingsWindowed(bars, 5, 5, 1);
  const w10 = findSwingsWindowed(bars, 10, 10, 1);
  console.log(`\nWindowed window=3:  Highs=${w3.swingHighs.length}  Lows=${w3.swingLows.length}  Total=${w3.allSwings.length}`);
  console.log(`Windowed window=5:  Highs=${w5.swingHighs.length}  Lows=${w5.swingLows.length}  Total=${w5.allSwings.length}`);
  console.log(`Windowed window=10: Highs=${w10.swingHighs.length}  Lows=${w10.swingLows.length}  Total=${w10.allSwings.length}`);

  console.log('\nLast 5 windowed(w=5) swing HIGHS:');
  w5.swingHighs.slice(-5).forEach(s =>
    console.log(`  ${new Date(s.time * 1000).toISOString()}  HIGH=${s.price}`)
  );
  console.log('\nLast 5 windowed(w=5) swing LOWS:');
  w5.swingLows.slice(-5).forEach(s =>
    console.log(`  ${new Date(s.time * 1000).toISOString()}  LOW=${s.price}`)
  );
})();
