// Check the candles time range vs dealing ranges time range
const http = require('http');

// Get candles data
const candlesUrl = 'http://localhost:3000/api/data?symbol=NQ_Historical_Data&timeframe=1&limit=15000&mode=interactive';

http.get(candlesUrl, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const candles = JSON.parse(data);
    if (candles.length > 0) {
      console.log(`Candles loaded: ${candles.length}`);
      console.log(`Candles time range: ${new Date(candles[0].time * 1000).toISOString()} to ${new Date(candles[candles.length - 1].time * 1000).toISOString()}`);
      console.log(`Candles epoch range: ${candles[0].time} to ${candles[candles.length - 1].time}`);
    } else {
      console.log('No candles returned');
    }
    
    // Now check events
    const eventsUrl = 'http://localhost:3000/api/events?symbol=NQ_Historical_Data&timeframe=1&concept=&limit=5000&display_mode=narrative&mode=interactive';
    http.get(eventsUrl, (res2) => {
      let data2 = '';
      res2.on('data', chunk => data2 += chunk);
      res2.on('end', () => {
        const events = JSON.parse(data2);
        const dr = events.filter(e => e.type === 'dealing_range');
        const tf1dr = dr.filter(e => Number(e.timeframe) === 1);
        
        console.log(`\nTotal events: ${events.length}`);
        console.log(`Total dealing ranges: ${dr.length}`);
        console.log(`TF=1 dealing ranges: ${tf1dr.length}`);
        
        if (tf1dr.length > 0 && candles.length > 0) {
          const candleStart = candles[0].time;
          const candleEnd = candles[candles.length - 1].time;
          
          const drInCandleRange = tf1dr.filter(r => r.timeStart >= candleStart && r.timeStart <= candleEnd);
          console.log(`TF=1 DRs within candle range: ${drInCandleRange.length}`);
          
          if (drInCandleRange.length > 0) {
            console.log('\nSample TF=1 DRs within candle range:');
            drInCandleRange.slice(-5).forEach((r, i) => {
              console.log(`  [${i}] id=${r.id} state=${r.state} time=${r.timeStart} (${new Date(r.timeStart * 1000).toISOString()})`);
            });
          }
          
          // Active DRs
          const activeTf1 = tf1dr.filter(r => r.state === 'active' || r.state === 'developing');
          console.log(`\nActive TF=1 DRs: ${activeTf1.length}`);
          activeTf1.forEach(r => {
            console.log(`  id=${r.id} time=${r.timeStart} (${new Date(r.timeStart * 1000).toISOString()}) inCandleRange=${r.timeStart >= candleStart && r.timeStart <= candleEnd}`);
          });
        }
      });
    });
  });
}).on('error', (e) => {
  console.error('Request error:', e.message);
});
