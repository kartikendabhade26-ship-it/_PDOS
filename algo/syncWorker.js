const { parentPort, workerData } = require('worker_threads');
const JobManager = require('./ResearchJobManager');
const logger = require('./logger');

async function run() {
  const { symbol } = workerData;
  logger.info('WORKER', `Legacy syncWorker adapter started for symbol: ${symbol}`);

  try {
    const jobId = JobManager.addJob({
      workspaceId: 'development',
      symbol,
      taskType: 'research_run',
      config: {
        limitBars: workerData.limitBars || null,
        mode: workerData.mode || 'interactive',
        resume: !!workerData.resume
      },
      priority: 10
    });

    const onCompleted = ({ jobId: finishedId }) => {
      if (finishedId === jobId) {
        cleanup();
        parentPort.postMessage({ success: true, symbol });
      }
    };

    const onFailed = ({ jobId: finishedId, error }) => {
      if (finishedId === jobId) {
        cleanup();
        parentPort.postMessage({ success: false, symbol, error });
      }
    };

    const cleanup = () => {
      JobManager.removeListener('job_completed', onCompleted);
      JobManager.removeListener('job_failed', onFailed);
    };

    JobManager.on('job_completed', onCompleted);
    JobManager.on('job_failed', onFailed);
  } catch (err) {
    logger.error('WORKER', `Legacy syncWorker adapter failed.`, err);
    parentPort.postMessage({ success: false, symbol, error: err.message });
  }
}

run();
