/**
 * algo/ResearchEngine.js
 * Research Engine Coordinator. Links runs to workspaces, binds manifest version metadata,
 * and calls the raw processing pipeline.
 */

const { getDB } = require('./db');
const RegistryService = require('./RegistryService');
const manifest = require('./EngineManifest');
const { parseCsvFile } = require('./dataLoader');
const { syncSymbolPipeline } = require('./pipeline');
const logger = require('./logger');

class ResearchEngine {
  /**
   * Run a scheduled queue job.
   */
  async runJob(jobId, workspaceId, symbol, config, progressCallback) {
    const runId = jobId; // Use jobId as the runId to keep them linked
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
    const db = getDB(dbName);
    
    logger.info('RESEARCH_ENGINE', `Initializing research run: ${runId} in workspace: ${workspaceId}`);
    
    // Create new immutable run record
    db.prepare(`
      INSERT INTO research_runs (run_id, workspace_id, symbol, status, config, versions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      workspaceId,
      symbol,
      'running',
      JSON.stringify(config),
      JSON.stringify(manifest)
    );

    // Capture execution logs inline
    const logs = [];
    const logInterceptor = (module, msg, meta) => {
      const logLine = `[${new Date().toISOString()}] [INFO] [${module}] ${msg} ${meta ? JSON.stringify(meta) : ''}`;
      logs.push(logLine);
    };

    // Temporarily subscribe local logs recorder
    logger.onLog(logInterceptor);

    try {
      // 1. Resolve CSV dataset path mapping
      const { symbolFiles, scanForSymbols } = require('./dataLoader');
      let filePath = symbolFiles.get(symbol);
      if (!filePath) {
        scanForSymbols();
        filePath = symbolFiles.get(symbol);
        if (!filePath) {
          throw new Error(`CSV file path not found for symbol: ${symbol}`);
        }
      }

      logger.info('RESEARCH_ENGINE', `Loading historical bars dataset: ${filePath}`);
      const limitBars = config.limitBars || null;
      const forceFull = config.mode === 'batch' || !limitBars;
      const rawBars = await parseCsvFile(filePath, forceFull, limitBars);
      logger.info('RESEARCH_ENGINE', `Loaded ${rawBars.length} total bars. Invoking execution pipeline...`);

      // 2. Run execution pipeline
      await syncSymbolPipeline(symbol, rawBars, runId, null, (pct, stats) => {
        if (progressCallback) {
          progressCallback(pct, stats);
        }
      });

      // 3. Finalize run success metrics
      const resultsSummary = global.syncTelemetry ? global.syncTelemetry.counts : {};
      
      db.prepare(`
        UPDATE research_runs 
        SET status = 'completed', statistics = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
        WHERE run_id = ?
      `).run(
        JSON.stringify(resultsSummary),
        logs.join('\n'),
        runId
      );

      logger.info('RESEARCH_ENGINE', `Research run ${runId} finalized successfully.`);
      return resultsSummary;
    } catch (err) {
      logger.error('RESEARCH_ENGINE', `Research run ${runId} execution failure!`, err);
      
      db.prepare(`
        UPDATE research_runs 
        SET status = 'failed', logs = ?, completed_at = CURRENT_TIMESTAMP
        WHERE run_id = ?
      `).run(
        logs.concat(`[ERROR] ${err.message}`).join('\n'),
        runId
      );
      
      throw err;
    } finally {
      // Unsubscribe log listener
      logger.offLog(logInterceptor);
    }
  }

  async runSync(symbol, rawBars, options = {}) {
    const { mode, resume } = options;
    // Resolve test database if USE_TEST_DB is set
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : (mode === 'batch' ? 'market_research.db' : 'market_dev.db');
    const runId = mode === 'batch' ? 'run_research' : 'run_dev';

    logger.info('RESEARCH_ENGINE', `Running sync for symbol: ${symbol} in ${mode || 'interactive'} mode`, { dbName, runId, resume });
    await syncSymbolPipeline(symbol, rawBars, dbName);
  }
}

module.exports = new ResearchEngine();
