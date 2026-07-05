/**
 * algo/jobWorker.js
 * Worker thread execution target. Executes coordinated research engine jobs.
 */

const { parentPort, workerData } = require('worker_threads');
const ResearchEngine = require('../../algo/ResearchEngine');
const logger = require('../../algo/logger');

async function main() {
  const { jobId, workspaceId, symbol, taskType, config } = workerData;
  logger.info('WORKER', `Worker thread started for job: ${jobId}`, { jobId, taskType });

  try {
    const results = await ResearchEngine.runJob(
      jobId,
      workspaceId,
      symbol,
      config,
      (pct, stats) => {
        parentPort.postMessage({
          type: 'progress',
          progress: pct,
          results: stats
        });
      }
    );

    parentPort.postMessage({
      type: 'complete',
      results
    });
  } catch (err) {
    logger.error('WORKER', `Worker thread execution failed for job: ${jobId}`, err);
    parentPort.postMessage({
      type: 'error',
      error: err.message
    });
  }
}

main();
