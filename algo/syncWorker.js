const { parentPort, workerData } = require('worker_threads');
const { syncSymbolPipeline } = require('./pipeline');
const { parseCsvFile } = require('./dataLoader');
const algoConfig = require('./config');
const logger = require('./logger');

function getAnalysisBars(symbol) {
  if (algoConfig.symbols && algoConfig.symbols[symbol] && typeof algoConfig.symbols[symbol].analysisBars === 'number') {
    return algoConfig.symbols[symbol].analysisBars;
  }
  return algoConfig.analysisBars || 15000;
}

async function run() {
  const { symbol, filePath, mode, limitBars, resume } = workerData;
  logger.info('WORKER', `Direct sync worker started for symbol: ${symbol}`);

  try {
    const finalLimitBars = (limitBars !== undefined && limitBars !== null) ? limitBars : (mode === 'interactive' ? getAnalysisBars(symbol) : null);
    const forceFull = mode === 'batch' || !finalLimitBars;

    logger.info('WORKER', `Loading historical bars dataset: ${filePath} (limitBars: ${finalLimitBars}, forceFull: ${forceFull})`);
    const rawBars = await parseCsvFile(filePath, forceFull, finalLimitBars);
    logger.info('WORKER', `Loaded ${rawBars.length} total bars. Invoking execution pipeline...`);

    const runId = 'sync_' + Date.now();
    await syncSymbolPipeline(symbol, rawBars, runId, null, (progressPct, stageCounts) => {
      parentPort.postMessage({ type: 'progress', progressPct, results: stageCounts });
    });

    const { closeAllDBs } = require('./db');
    closeAllDBs();

    parentPort.postMessage({ success: true, symbol });
  } catch (err) {
    try {
      const { closeAllDBs } = require('./db');
      closeAllDBs();
    } catch (e) {}
    logger.error('WORKER', `Direct sync worker execution failed`, err);
    parentPort.postMessage({ success: false, symbol, error: err.message });
  }
}

run();
