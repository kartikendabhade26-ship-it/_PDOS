const http = require('http');

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function run() {
  console.log("Triggering sync with force=true...");
  const triggerRes = await request('http://127.0.0.1:3000/api/algo/sync?symbol=NQ_Historical_Data&trigger=true&force=true');
  console.log("Trigger Response:", triggerRes.body);

  if (!triggerRes.body.success) {
    console.error("Failed to trigger sync!");
    return;
  }

  // Poll progress every 1s
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const progressRes = await request('http://127.0.0.1:3000/api/algo/sync/progress?symbol=NQ_Historical_Data');
    console.log(`[${i}s] Status: ${progressRes.body.status} | Progress: ${progressRes.body.current_chunk}% | Results:`, progressRes.body.resultsSummary);
    if (progressRes.body.status === 'completed' || progressRes.body.status === 'failed') {
      console.log("Sync finished with status:", progressRes.body.status);
      break;
    }
  }
}

run().catch(console.error);
