const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Worker } = require('worker_threads');

// Import DB, logger and dataLoader
const { getDB } = require('./algo/db');
const logger = require('./algo/logger');
const QueryEngine = require('./algo/QueryEngine');
const {
  parseDateTimeToEpoch,
  readHeaderInfo,
  precomputeDailyHighLows,
  parseCsvFile,
  buildSymbolIndex,
  findOffsetForTime,
  parseCsvFromOffset,
  aggregate,
  buildDailyCache,
  scanForSymbols,
  symbolFiles,
  cache,
  dailyCache
} = require('./algo/dataLoader');

const PORT = parseInt(process.env.PORT || '8080', 10);

let activeSyncWorker = null;

function triggerWorkerSync(symbol, filePath, options = {}) {
  if (activeSyncWorker) {
    logger.warn('SERVER', 'Sync already running. Skipping parallel sync trigger.', { symbol });
    return;
  }

  logger.info('SERVER', `Spawning worker thread for database sync...`, { symbol, filePath, options });
  activeSyncWorker = new Worker(path.join(__dirname, 'algo', 'syncWorker.js'), {
    workerData: {
      symbol,
      filePath,
      mode: options.mode || 'interactive',
      limitBars: options.limitBars || null,
      resume: !!options.resume
    }
  });
  
  activeSyncWorker.on('message', (msg) => {
    if (msg.success) {
      logger.info('SERVER', `Worker sync completed successfully for ${msg.symbol}`);
    } else {
      logger.error('SERVER', `Worker sync failed for ${msg.symbol}`, new Error(msg.error));
    }
  });
  
  activeSyncWorker.on('error', (err) => {
    logger.error('SERVER', `Worker thread error`, err);
  });
  
  activeSyncWorker.on('exit', (code) => {
    logger.info('SERVER', `Worker thread exited`, { exitCode: code });
    activeSyncWorker = null;
  });
}


// Helper to write JSON responses
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(JSON.stringify(data));
}

// Server Router
const server = http.createServer(async (req, res) => {
  const requestStart = Date.now();

  // Track whether ANY route has already sent a response
  let responded = false;
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    responded = true;
    return originalEnd(...args);
  };

  // ── Request timeout guard ─────────────────────────────────────────────────
  // Only applies to routes that are not long-running (exclude /api/algo/sync).
  // Guards against genuinely hung handlers.
  const urlForTimeout = req.url || '';
  const isLongRunning = urlForTimeout.includes('/api/algo/sync') || urlForTimeout.includes('/api/data');
  const reqTimeout = !isLongRunning ? setTimeout(() => {
    if (!responded && !res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      originalEnd('Request timeout');
    }
  }, 30000) : null;
  res.on('finish', () => { if (reqTimeout) clearTimeout(reqTimeout); });
  res.on('close',  () => { if (reqTimeout) clearTimeout(reqTimeout); });

  // ── Outer safety net ──────────────────────────────────────────────────────
  // Any unhandled throw inside a route is caught here and returned as 500.
  // This prevents a single bad request from crashing the entire server process.
  try {

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Resolve symbol query parameter case-insensitively if present
  const querySymbol = urlObj.searchParams.get('symbol');
  if (querySymbol) {
    const lowerSymbol = querySymbol.toLowerCase();
    for (const key of symbolFiles.keys()) {
      if (key.toLowerCase() === lowerSymbol) {
        urlObj.searchParams.set('symbol', key);
        break;
      }
    }
  }

  // Response time telemetry
  global.apiLatencies = global.apiLatencies || [];
  res.on('finish', () => {
    if (pathname.startsWith('/api') && !pathname.includes('/diagnostics/')) {
      const duration = Date.now() - requestStart;
      global.apiLatencies.push({
        path: pathname,
        method: req.method,
        duration,
        timestamp: new Date().toISOString()
      });
      if (global.apiLatencies.length > 50) {
        global.apiLatencies.shift();
      }
    }
  });

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    res.end();
    return;
  }


  // Remote logger debugging endpoint
  if (pathname === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { msg } = JSON.parse(body);
        console.log(`[CLIENT LOG] ${msg}`);
      } catch (err) {}
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('ok');
    });
    return;
  }

  if (pathname === '/api/symbols' && req.method === 'GET') {
    const symbols = Array.from(symbolFiles.keys());
    sendJSON(res, symbols);
    return;
  }

  if (pathname === '/api/symbol-info' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol');
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing symbol parameter');
      return;
    }

    let filePath = symbolFiles.get(symbol);
    if (!filePath) {
      scanForSymbols();
      filePath = symbolFiles.get(symbol);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Symbol not found');
        return;
      }
    }

    try {
      let dailyBars = dailyCache.get(symbol);
      if (!dailyBars) {
        dailyBars = await buildDailyCache(symbol, filePath);
      }
      if (dailyBars && dailyBars.length > 0) {
        const start = new Date(dailyBars[0].time * 1000).toISOString().split('T')[0];
        const end = new Date(dailyBars[dailyBars.length - 1].time * 1000).toISOString().split('T')[0];
        sendJSON(res, { success: true, start, end });
      } else {
        sendJSON(res, { success: false, error: 'No data' });
      }
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
    return;
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol');
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing symbol parameter');
      return;
    }

    try {
      let tf = 1;
      const tfParam = urlObj.searchParams.get('timeframe');
      if (tfParam) {
        const parsedTf = parseInt(tfParam, 10);
        if (!isNaN(parsedTf)) tf = parsedTf;
      }

      const start = parseInt(urlObj.searchParams.get('start') || '0', 10);
      const end = parseInt(urlObj.searchParams.get('end') || '9999999999', 10);
      const limit = parseInt(urlObj.searchParams.get('limit') || '5000', 10);
      const mode = urlObj.searchParams.get('mode') || 'interactive';
      const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';

      const result = QueryEngine.getCandles(dbName, symbol, tf, start, end, limit);
      sendJSON(res, result);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
    return;
  }

  // ─── ALGO: Get sync statistics or trigger manual sync ───────────────────
  // GET /api/algo/sync?symbol=NQ_Historical_Data&trigger=true&force=true
  // The `force=true` parameter deletes ALL existing bars + events for this symbol
  // before re-running the pipeline. Use this when you've replaced the CSV file
  // with new data and the old data is still in the database.
  if (pathname === '/api/algo/sync' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const trigger = urlObj.searchParams.get('trigger') === 'true';
    const force = urlObj.searchParams.get('force') === 'true';
    const mode = urlObj.searchParams.get('mode') || 'interactive';
    const limitBarsParam = urlObj.searchParams.get('limitBars');
    const limitBars = limitBarsParam ? parseInt(limitBarsParam, 10) : null;
    const resume = urlObj.searchParams.get('resume') === 'true';

    if (trigger) {
      try {
        const filePath = symbolFiles.get(symbol);
        if (!filePath) {
          scanForSymbols();
          const fp = symbolFiles.get(symbol);
          if (!fp) {
            res.writeHead(404);
            res.end('Symbol not found');
            return;
          }
          if (force) {
            // Delete ALL bars + events for this symbol to prevent mixing old + new data
            const db = getDB();
            db.prepare('DELETE FROM market_bars WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM structure_events WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM liquidity_objects WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM research_runs WHERE symbol = ?').run(symbol);
            logger.info('SERVER', `[Force Re-sync] Cleared all old data for ${symbol}`);
          }
          triggerWorkerSync(symbol, fp, { mode, limitBars, resume });
        } else {
          if (force) {
            const db = getDB();
            db.prepare('DELETE FROM market_bars WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM structure_events WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM liquidity_objects WHERE symbol = ?').run(symbol);
            db.prepare('DELETE FROM research_runs WHERE symbol = ?').run(symbol);
            logger.info('SERVER', `[Force Re-sync] Cleared all old data for ${symbol}`);
          }
          triggerWorkerSync(symbol, filePath, { mode, limitBars, resume });
        }
        sendJSON(res, { success: true, message: `Sync pipeline triggered in worker thread in ${mode} mode${force ? ' (force: old data cleared)' : ''}` });
      } catch (err) {
        logger.error('SERVER', 'Error triggering manual sync', err);
        res.writeHead(500); res.end(err.message);
      }
      return;
    }

    try {
      const db = getDB();
      const eventsCount = db.prepare('SELECT COUNT(*) as count FROM structure_events').get().count;
      const contextCount = db.prepare('SELECT COUNT(*) as count FROM event_context_snapshots').get().count;
      const outcomesCount = db.prepare('SELECT COUNT(*) as count FROM event_outcomes').get().count;
      const validationsCount = db.prepare('SELECT COUNT(*) as count FROM human_validations').get().count;
      const versionsCount = db.prepare('SELECT COUNT(*) as count FROM detector_versions').get().count;
      
      sendJSON(res, {
        success: true,
        symbol,
        stats: {
          detector_versions: versionsCount,
          structure_events: eventsCount,
          event_context_snapshots: contextCount,
          event_outcomes: outcomesCount,
          human_validations: validationsCount
        }
      });
    } catch (err) {
      logger.error('SERVER', 'Sync check error', err);
      res.writeHead(500); res.end(err.message);
    }
    return;
  }

  // GET /api/algo/sync/progress?symbol=NQ_Historical_Data&mode=interactive
  if (pathname === '/api/algo/sync/progress' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';

    try {
      const db = getDB();
      const job = db.prepare(`
        SELECT status, progress_pct
        FROM research_jobs
        WHERE symbol = ? AND task_type = 'research_run'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(symbol);

      if (job) {
        sendJSON(res, {
          success: true,
          status: job.status === 'running' ? 'running' : job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'error' : 'idle',
          current_chunk: job.status === 'completed' ? 100 : Math.round(job.progress_pct),
          total_chunks: 100,
          bars_processed: 0,
          elapsed_ms: 0,
          eta_ms: 0,
          updated_at: new Date().toISOString()
        });
      } else {
        sendJSON(res, {
          success: true,
          status: 'idle',
          current_chunk: 0,
          total_chunks: 0,
          bars_processed: 0,
          elapsed_ms: 0,
          eta_ms: 0
        });
      }
    } catch (err) {
      logger.error('SERVER', 'Error reading sync progress', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // GET /api/query/visible-window?symbol=NQ_Historical_Data&timeframe=1&start=123456&end=234567&mode=interactive
  if (pathname === '/api/query/visible-window' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const timeframe = parseInt(urlObj.searchParams.get('timeframe') || '1', 10);
    const start = parseInt(urlObj.searchParams.get('start') || '0', 10);
    const end = parseInt(urlObj.searchParams.get('end') || '9999999999', 10);
    const mode = urlObj.searchParams.get('mode') || 'interactive';
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';

    try {
      const result = QueryEngine.getVisibleWindow(dbName, symbol, timeframe, start, end);
      sendJSON(res, result);
    } catch (err) {
      logger.error('SERVER', 'Error querying visible window', err);
      res.writeHead(500);
      res.end(err.message);
    }
    return;
  }

  if (pathname === '/api/algo/scan' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const concept = urlObj.searchParams.get('concept');
    const lookahead = parseInt(urlObj.searchParams.get('lookahead') || '50', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '5000', 10);

    if (!concept) {
      res.writeHead(400); res.end('Missing concept parameter');
      return;
    }

    try {
      let rawBars = cache.get(symbol);
      if (!rawBars) {
        let filePath = symbolFiles.get(symbol);
        if (!filePath) { scanForSymbols(); filePath = symbolFiles.get(symbol); }
        if (!filePath) { res.writeHead(404); res.end('Symbol not found'); return; }
        rawBars = await parseCsvFile(filePath);
        if (rawBars.length > 0) cache.set(symbol, rawBars);
      }

      const { getCandidates } = require('./algo/detector');
      const { scanAllReactions } = require('./algo/reactions');

      const candidates = getCandidates(concept, rawBars, limit);
      const results = scanAllReactions(candidates, rawBars, lookahead);
      sendJSON(res, { success: true, results });
    } catch (err) {
      console.error('[Scan API Error]', err);
      res.writeHead(500); res.end(err.message);
    }
    return;
  }

  // ─── PDOS EVENTS: Query synchronized structure events, outcomes, and validations from SQLite ──────────
  // GET /api/events?symbol=NQ_Historical_Data&timeframe=1&concept=fvg_bullish&limit=1000
  if (pathname === '/api/events' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const timeframe = parseInt(urlObj.searchParams.get('timeframe') || '1', 10);
    const concept = urlObj.searchParams.get('concept');
    const limit = parseInt(urlObj.searchParams.get('limit') || '1000', 10);
    const start = parseInt(urlObj.searchParams.get('start') || '0', 10);
    const end = parseInt(urlObj.searchParams.get('end') || '9999999999', 10);
    const mode = urlObj.searchParams.get('mode') || 'interactive';
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';

    try {
      if (concept === 'liquidity_object') {
        const result = QueryEngine.getLiquidityObjects(dbName, symbol, timeframe, start, end, limit);
        sendJSON(res, result);
        return;
      }

      if (!concept || concept === '') {
        const result = QueryEngine.getVisibleWindow(dbName, symbol, timeframe, start, end, limit);
        sendJSON(res, result.candidates);
        return;
      }

      const result = QueryEngine.getEvents(dbName, symbol, timeframe, start, end, limit);
      const filtered = result.filter(e => e.type === concept || e.concept_family === concept);
      sendJSON(res, filtered);
    } catch (err) {
      console.error('[Events API Error]', err);
      res.writeHead(500); res.end(err.message);
    }
    return;
  }

  // ─── PDOS SEARCH: Get event details and relationships ───────────────────
  // GET /api/events/details?id=...
  if (pathname === '/api/events/details' && req.method === 'GET') {
    const id = urlObj.searchParams.get('id');
    if (!id) {
      res.writeHead(400); res.end('Missing event ID');
      return;
    }

    const runId = urlObj.searchParams.get('runId') || 'run_legacy';
    try {
      const db = getDB();
      const eventQuery = `
        SELECT e.*, 
               o.is_mitigated, o.mitigation_time, o.mitigation_price, o.mfe, o.mae, 
               o.time_to_mitigation, o.time_to_failure, o.time_to_target, o.fvg_fill_percent, o.is_valid,
               v.status AS validation_status, v.correction_notes AS validation_notes,
               ctx.time_year, ctx.time_quarter, ctx.time_month, ctx.time_weekday, ctx.time_session, ctx.time_hour,
               ctx.price_daily_range_pct, ctx.price_atr_14, ctx.price_volatility_regime, ctx.price_premium_discount_status,
               ctx.price_dist_daily_high, ctx.price_dist_daily_low, ctx.price_dist_weekly_high, ctx.price_dist_weekly_low,
               ctx.structure_bias_1m, ctx.structure_bias_5m, ctx.structure_bias_15m, ctx.structure_bias_1h, ctx.structure_bias_4h, ctx.structure_bias_daily,
               ctx.htf_structure_event_id, ctx.ltf_structure_event_id, ctx.nearest_htf_high, ctx.nearest_htf_low,
               ctx.liq_closest_above, ctx.liq_closest_below, ctx.liq_dist_to_above, ctx.liq_dist_to_below, ctx.liq_eq_high_present, ctx.liq_eq_low_present,
               ctx.nearest_bsl_price, ctx.nearest_bsl_event_id, ctx.nearest_ssl_price, ctx.nearest_ssl_event_id,
               ctx.fvg_size, ctx.fvg_atr_ratio, ctx.fvg_age, ctx.fvg_untouched_nearby_count, ctx.nearest_fvg_price, ctx.nearest_fvg_event_id,
               ctx.nearest_void_price, ctx.nearest_void_event_id, ctx.nearest_volume_imbalance_price, ctx.nearest_volume_imbalance_event_id,
               ctx.flow_before_mss, ctx.flow_after_mss, ctx.flow_before_bos, ctx.flow_after_bos, ctx.flow_sweep_occurred, ctx.flow_no_sweep,
               ctx.session_asia, ctx.session_london, ctx.session_ny, ctx.session_ny_am, ctx.session_ny_pm
        FROM structure_events e
        LEFT JOIN event_outcomes o ON e.event_id = o.event_id AND e.run_id = o.run_id
        LEFT JOIN human_validations v ON e.event_id = v.event_id AND e.run_id = v.run_id
        LEFT JOIN event_context_snapshots ctx ON e.event_id = ctx.event_id AND e.run_id = ctx.run_id
        WHERE e.run_id = ? AND e.event_id = ?
      `;
      const row = db.prepare(eventQuery).get(runId, id);
      if (!row) {
        sendJSON(res, { success: false, error: 'Event not found' }, 404);
        return;
      }

      let properties = {};
      if (row.properties) {
        try { properties = JSON.parse(row.properties); } catch (e) {}
      }

      const eventDetails = {
        id: row.event_id,
        root_event_id: row.root_event_id,
        parent_event_id: row.parent_event_id,
        detectorId: row.detector_id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        conceptFamily: row.concept_family,
        conceptType: row.concept_type,
        state: row.concept_state,
        timeStart: row.time_start,
        timeEnd: row.time_end,
        time: row.time_start,
        priceHigh: row.price_high,
        priceLow: row.price_low,
        direction: row.direction,
        properties: properties,
        isMitigated: row.is_mitigated,
        mitigationTime: row.mitigation_time,
        mitigationPrice: row.mitigation_price,
        mfe: row.mfe,
        mae: row.mae,
        validation: row.validation_status ? { status: row.validation_status, notes: row.validation_notes } : null,
        context: {
          time_year: row.time_year,
          time_quarter: row.time_quarter,
          time_month: row.time_month,
          time_weekday: row.time_weekday,
          time_session: row.time_session,
          time_hour: row.time_hour,
          price_daily_range_pct: row.price_daily_range_pct,
          price_atr_14: row.price_atr_14,
          price_volatility_regime: row.price_volatility_regime,
          price_premium_discount_status: row.price_premium_discount_status,
          price_dist_daily_high: row.price_dist_daily_high,
          price_dist_daily_low: row.price_dist_daily_low,
          price_dist_weekly_high: row.price_dist_weekly_high,
          price_dist_weekly_low: row.price_dist_weekly_low,
          structure_bias_1m: row.structure_bias_1m,
          structure_bias_5m: row.structure_bias_5m,
          structure_bias_15m: row.structure_bias_15m,
          structure_bias_1h: row.structure_bias_1h,
          structure_bias_4h: row.structure_bias_4h,
          structure_bias_daily: row.structure_bias_daily,
          htf_structure_event_id: row.htf_structure_event_id,
          ltf_structure_event_id: row.ltf_structure_event_id,
          nearest_htf_high: row.nearest_htf_high,
          nearest_htf_low: row.nearest_htf_low,
          liq_closest_above: row.liq_closest_above,
          liq_closest_below: row.liq_closest_below,
          liq_dist_to_above: row.liq_dist_to_above,
          liq_dist_to_below: row.liq_dist_to_below,
          liq_eq_high_present: row.liq_eq_high_present,
          liq_eq_low_present: row.liq_eq_low_present,
          nearest_bsl_price: row.nearest_bsl_price,
          nearest_bsl_event_id: row.nearest_bsl_event_id,
          nearest_ssl_price: row.nearest_ssl_price,
          nearest_ssl_event_id: row.nearest_ssl_event_id,
          fvg_size: row.fvg_size,
          fvg_atr_ratio: row.fvg_atr_ratio,
          fvg_age: row.fvg_age,
          fvg_untouched_nearby_count: row.fvg_untouched_nearby_count,
          nearest_fvg_price: row.nearest_fvg_price,
          nearest_fvg_event_id: row.nearest_fvg_event_id,
          nearest_void_price: row.nearest_void_price,
          nearest_void_event_id: row.nearest_void_event_id,
          nearest_volume_imbalance_price: row.nearest_volume_imbalance_price,
          nearest_volume_imbalance_event_id: row.nearest_volume_imbalance_event_id,
          flow_before_mss: row.flow_before_mss,
          flow_after_mss: row.flow_after_mss,
          flow_before_bos: row.flow_before_bos,
          flow_after_bos: row.flow_after_bos,
          flow_sweep_occurred: row.flow_sweep_occurred,
          flow_no_sweep: row.flow_no_sweep,
          session_asia: row.session_asia,
          session_london: row.session_london,
          session_ny: row.session_ny,
          session_ny_am: row.session_ny_am,
          session_ny_pm: row.session_ny_pm
        }
      };

      const relations = [];

      // Link nested parent
      if (row.parent_event_id) {
        const parentRow = db.prepare('SELECT event_id, concept_type, time_start, price_high, price_low, direction, concept_state FROM structure_events WHERE run_id = ? AND event_id = ?').get(runId, row.parent_event_id);
        if (parentRow) {
          relations.push({
            role: 'parent',
            type: 'nested_inside',
            id: parentRow.event_id,
            conceptType: parentRow.concept_type,
            time: parentRow.time_start,
            priceHigh: parentRow.price_high,
            priceLow: parentRow.price_low,
            direction: parentRow.direction,
            state: parentRow.concept_state
          });
        }
      }

      // Link children
      const childrenRows = db.prepare('SELECT event_id, concept_type, time_start, price_high, price_low, direction, concept_state FROM structure_events WHERE run_id = ? AND parent_event_id = ?').all(runId, id);
      for (const child of childrenRows) {
        relations.push({
          role: 'child',
          type: child.concept_type === 'IBISI' || child.concept_type === 'ISIBI' ? 'inverted_from' : 'nested_inside',
          id: child.event_id,
          conceptType: child.concept_type,
          time: child.time_start,
          priceHigh: child.price_high,
          priceLow: child.price_low,
          direction: child.direction,
          state: child.concept_state
        });
      }

      // Fetch other custom graph relationships
      const rels = db.prepare(`
        SELECT r.relationship_type, e.event_id, e.concept_type, e.time_start, e.price_high, e.price_low, e.direction, e.concept_state,
               CASE WHEN r.parent_event_id = ? THEN 'child' ELSE 'parent' END as role
        FROM event_relationships r
        JOIN structure_events e ON (r.parent_event_id = ? AND r.child_event_id = e.event_id AND r.run_id = e.run_id)
                               OR (r.child_event_id = ? AND r.parent_event_id = e.event_id AND r.run_id = e.run_id)
        WHERE r.run_id = ?
      `).all(id, id, id, runId);

      for (const rel of rels) {
        if (relations.some(r => r.id === rel.event_id)) continue;
        relations.push({
          role: rel.role,
          type: rel.relationship_type,
          id: rel.event_id,
          conceptType: rel.concept_type,
          time: rel.time_start,
          priceHigh: rel.price_high,
          priceLow: rel.price_low,
          direction: rel.direction,
          state: rel.concept_state
        });
      }

      sendJSON(res, { success: true, details: eventDetails, relations });
    } catch (err) {
      console.error('[Event Details API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── PDOS RESEARCH FILTER: Execute advanced query search ─────────────────
  // GET /api/research/query
  if (pathname === '/api/research/query' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const timeframe = urlObj.searchParams.get('timeframe');
    const session = urlObj.searchParams.get('session');
    const concept_family = urlObj.searchParams.get('concept_family');
    const concept_state = urlObj.searchParams.get('state');
    const search = urlObj.searchParams.get('search');
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
    const sortBy = urlObj.searchParams.get('sortBy') || 'time_start';
    const sortOrder = urlObj.searchParams.get('sortOrder') || 'DESC';

    try {
      const db = getDB();
      const runId = QueryEngine.resolveRunId(urlObj.searchParams.get('runId') || urlObj.searchParams.get('mode'));
      let filterSql = 'WHERE e.run_id = ? AND e.symbol = ? COLLATE NOCASE';
      const params = [runId, symbol];

      if (timeframe) {
        const tfs = timeframe.split(',').map(Number).filter(n => !isNaN(n));
        if (tfs.length > 0) {
          filterSql += ` AND e.timeframe IN (${tfs.map(() => '?').join(',')})`;
          params.push(...tfs);
        }
      }

      if (session) {
        const ses = session.split(',');
        if (ses.length > 0) {
          filterSql += ` AND ctx.time_session IN (${ses.map(() => '?').join(',')})`;
          params.push(...ses);
        }
      }

      if (concept_family) {
        const fams = concept_family.split(',');
        if (fams.length > 0) {
          filterSql += ` AND e.concept_family IN (${fams.map(() => '?').join(',')})`;
          params.push(...fams);
        }
      }

      if (concept_state) {
        const sts = concept_state.split(',');
        if (sts.length > 0) {
          filterSql += ` AND e.concept_state IN (${sts.map(() => '?').join(',')})`;
          params.push(...sts);
        }
      }

      if (search) {
        filterSql += ' AND (e.event_id LIKE ? OR e.concept_type LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      // Count total matches
      const countQuery = `
        SELECT COUNT(*) as count 
        FROM structure_events e
        LEFT JOIN event_context_snapshots ctx ON e.event_id = ctx.event_id AND e.run_id = ctx.run_id
        ${filterSql}
      `;
      const totalCount = db.prepare(countQuery).get(...params).count;

      // Select matching records
      let querySql = `
        SELECT e.*, 
               o.is_mitigated, o.mitigation_time, o.mitigation_price, o.mfe, o.mae, o.fvg_fill_percent, o.is_valid,
               v.status AS validation_status, v.correction_notes AS validation_notes,
               ctx.time_session, ctx.price_premium_discount_status
        FROM structure_events e
        LEFT JOIN event_outcomes o ON e.event_id = o.event_id AND e.run_id = o.run_id
        LEFT JOIN human_validations v ON e.event_id = v.event_id AND e.run_id = v.run_id
        LEFT JOIN event_context_snapshots ctx ON e.event_id = ctx.event_id AND e.run_id = ctx.run_id
        ${filterSql}
      `;

      const allowedSortColumns = ['event_id', 'timeframe', 'concept_family', 'concept_type', 'concept_state', 'time_start', 'price_high', 'price_low', 'mfe', 'mae', 'validation_status'];
      const finalSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'time_start';
      const finalSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      querySql += ` ORDER BY ${finalSortBy} ${finalSortOrder} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = db.prepare(querySql).all(...params);

      const results = rows.map(r => {
        let properties = {};
        if (r.properties) {
          try { properties = JSON.parse(r.properties); } catch (e) {}
        }
        return {
          id: r.event_id,
          type: r.concept_type.toLowerCase() === 'bisi' || r.concept_type.toLowerCase() === 'sibi' ? 'fvg' :
                r.concept_type.toLowerCase() === 'ibisi' || r.concept_type.toLowerCase() === 'isibi' ? 'ifvg' :
                r.concept_type.toLowerCase() === 'swing' ? 'swing' :
                r.concept_type.toLowerCase() === 'strong swing' ? 'strong_swing' :
                r.concept_type.toLowerCase() === 'protected low' || r.concept_type.toLowerCase() === 'protected high' ? 'protected_high_low' :
                r.concept_type.toLowerCase() === 'displacement' ? 'displacement' :
                r.concept_type.toLowerCase() === 'volume imbalance' ? 'volume_imbalance' :
                r.concept_type.toLowerCase() === 'liquidity void' ? 'liquidity_void' :
                ['bsl', 'ssl', 'eqh', 'eql', 'reqh', 'reql'].includes(r.concept_type.toLowerCase()) ? 'liquidity' :
                r.concept_type.toLowerCase() === 'ob' ? 'ob' :
                r.concept_type.toLowerCase() === 'mss' ? 'mss' :
                r.concept_type.toLowerCase() === 'bos' ? 'bos' : r.concept_type.toLowerCase(),
          direction: r.direction,
          time: r.time_start,
          timeStart: r.time_start,
          timeEnd: r.time_end,
          priceHigh: r.price_high,
          priceLow: r.price_low,
          symbol: r.symbol,
          timeframe: r.timeframe,
          state: r.concept_state,
          properties: properties,
          isMitigated: r.is_mitigated,
          mitigationTime: r.mitigation_time,
          mitigationPrice: r.mitigation_price,
          mfe: r.mfe,
          mae: r.mae,
          validation: r.validation_status ? { status: r.validation_status, notes: r.validation_notes } : null,
          context: {
            time_session: r.time_session,
            price_premium_discount_status: r.price_premium_discount_status
          }
        };
      });

      sendJSON(res, { success: true, total: totalCount, results });
    } catch (err) {
      console.error('[Research Query API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── PDOS TELEMETRY: Return engine performance dashboards ──────────────
  // GET /api/diagnostics/telemetry
  if (pathname === '/api/diagnostics/telemetry' && req.method === 'GET') {
    try {
      const db = getDB();
      const eventsCount = db.prepare('SELECT COUNT(*) as count FROM structure_events').get().count;
      const contextCount = db.prepare('SELECT COUNT(*) as count FROM event_context_snapshots').get().count;
      const outcomesCount = db.prepare('SELECT COUNT(*) as count FROM event_outcomes').get().count;
      const validationsCount = db.prepare('SELECT COUNT(*) as count FROM human_validations').get().count;
      const relationshipsCount = db.prepare('SELECT COUNT(*) as count FROM event_relationships').get().count;
      const countsByFamily = db.prepare('SELECT concept_family, COUNT(*) as count FROM structure_events GROUP BY concept_family').all();
      
      const familyCountsMap = {};
      countsByFamily.forEach(f => {
        familyCountsMap[f.concept_family] = f.count;
      });

      sendJSON(res, {
        success: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        dbStats: {
          totalEvents: eventsCount,
          contexts: contextCount,
          outcomes: outcomesCount,
          validations: validationsCount,
          relationships: relationshipsCount,
          familyCounts: familyCountsMap
        },
        syncTelemetry: global.syncTelemetry || null,
        apiLatencies: global.apiLatencies || []
      });
    } catch (err) {
      console.error('[Telemetry API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── PDOS LOGS: Fetch logs tail in real time ─────────────────────────────
  // GET /api/diagnostics/logs
  if (pathname === '/api/diagnostics/logs' && req.method === 'GET') {
    const limit = Math.min(250, parseInt(urlObj.searchParams.get('limit') || '100', 10));
    const logFilePath = path.join(__dirname, 'algo', 'results', 'pdos_system.log');
    
    if (!fs.existsSync(logFilePath)) {
      sendJSON(res, { logs: [] });
      return;
    }

    try {
      const data = fs.readFileSync(logFilePath, 'utf8');
      const lines = data.split('\n').filter(l => l.trim() !== '');
      const tail = lines.slice(-limit);
      sendJSON(res, { logs: tail });
    } catch (err) {
      console.error('[Logs API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── PDOS VALIDATIONS: Save human validation to SQLite ───────────────────
  // POST /api/validations  body: { eventId, status, notes }
  if (pathname === '/api/validations' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { eventId, status, notes, runId } = JSON.parse(body);
        if (!eventId || !status) {
          res.writeHead(400); res.end('Missing eventId or status');
          return;
        }

        const targetRunId = runId || 'run_legacy';
        const db = getDB();
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO human_validations
          (run_id, validation_id, event_id, user_id, status, correction_notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          targetRunId,
          `val_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          eventId,
          'human_user',
          status, // 'approved' | 'rejected'
          notes || ''
        );

        console.log(`[DB] Logged human validation for ${eventId}: ${status}`);
        sendJSON(res, { success: true, eventId, status });
      } catch (err) {
        console.error('[Validation API Error]', err);
        sendJSON(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  const TRADES_FILE = path.join(__dirname, 'algo', 'labels', 'trades_log.json');

  // ─── SIMULATOR: Get all logged trades ───────────────────────────
  // GET /api/trades
  if (pathname === '/api/trades' && req.method === 'GET') {
    if (!fs.existsSync(TRADES_FILE)) {
      sendJSON(res, []);
      return;
    }
    try {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      const trades = JSON.parse(data || '[]');
      sendJSON(res, trades);
    } catch (err) {
      console.error(err);
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ─── SIMULATOR: Save/Update a trade ─────────────────────────────
  // POST /api/trades  body: { trade: {...} }
  if (pathname === '/api/trades' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { trade } = JSON.parse(body);
        if (!trade || !trade.id) {
          sendJSON(res, { success: false, error: 'Invalid trade body' }, 400);
          return;
        }

        let trades = [];
        if (fs.existsSync(TRADES_FILE)) {
          const raw = fs.readFileSync(TRADES_FILE, 'utf8');
          trades = JSON.parse(raw || '[]');
        }

        const idx = trades.findIndex(t => t.id === trade.id);
        if (idx !== -1) {
          // Update existing
          trades[idx] = { ...trades[idx], ...trade };
        } else {
          // Insert new
          trades.push(trade);
        }

        fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
        sendJSON(res, { success: true, trade });
      } catch (err) {
        console.error(err);
        sendJSON(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ─── SIMULATOR: Delete a trade ──────────────────────────────────
  // DELETE /api/trades?id=...
  if (pathname === '/api/trades' && req.method === 'DELETE') {
    const tradeId = urlObj.searchParams.get('id');
    if (!tradeId) {
      sendJSON(res, { success: false, error: 'Missing trade ID' }, 400);
      return;
    }
    try {
      if (fs.existsSync(TRADES_FILE)) {
        const raw = fs.readFileSync(TRADES_FILE, 'utf8');
        const trades = JSON.parse(raw || '[]');
        const filtered = trades.filter(t => t.id !== tradeId);
        fs.writeFileSync(TRADES_FILE, JSON.stringify(filtered, null, 2));
        sendJSON(res, { success: true });
      } else {
        sendJSON(res, { success: false, error: 'No trades file found' }, 404);
      }
    } catch (err) {
      console.error(err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }
  // ─── JOB QUEUE: Add job ────────────────────────────────────────────────
  if (pathname === '/api/jobs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { workspaceId, symbol, taskType, config, priority } = JSON.parse(body);
        const ResearchJobManager = require('./algo/ResearchJobManager');
        const jobId = ResearchJobManager.addJob({
          workspaceId: workspaceId || 'development',
          symbol: symbol || 'NQ_Historical_Data',
          taskType: taskType || 'research_run',
          config: config || {},
          priority: priority || 0
        });
        sendJSON(res, { success: true, jobId });
      } catch (err) {
        logger.error('SERVER', 'Error scheduling job', err);
        sendJSON(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ─── JOB QUEUE: Get job status ─────────────────────────────────────────
  if (pathname === '/api/jobs' && req.method === 'GET') {
    const jobId = urlObj.searchParams.get('jobId');
    if (!jobId) {
      sendJSON(res, { success: false, error: 'Missing jobId' }, 400);
      return;
    }
    try {
      const ResearchJobManager = require('./algo/ResearchJobManager');
      const job = ResearchJobManager.getJob(jobId);
      if (job) {
        sendJSON(res, { success: true, job });
      } else {
        sendJSON(res, { success: false, error: 'Job not found' }, 404);
      }
    } catch (err) {
      logger.error('SERVER', 'Error fetching job status', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── JOB QUEUE: Cancel job ─────────────────────────────────────────────
  if (pathname === '/api/jobs/cancel' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { jobId } = JSON.parse(body);
        const ResearchJobManager = require('./algo/ResearchJobManager');
        ResearchJobManager.cancelJob(jobId);
        sendJSON(res, { success: true });
      } catch (err) {
        logger.error('SERVER', 'Error cancelling job', err);
        sendJSON(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ─── WORKSPACES: List workspaces ───────────────────────────────────────
  if (pathname === '/api/workspaces' && req.method === 'GET') {
    try {
      const db = getDB();
      const workspaces = db.prepare('SELECT * FROM workspaces').all();
      sendJSON(res, { success: true, workspaces });
    } catch (err) {
      logger.error('SERVER', 'Error fetching workspaces', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── RUNS: List runs for workspace ─────────────────────────────────────
  if (pathname === '/api/runs' && req.method === 'GET') {
    const workspaceId = urlObj.searchParams.get('workspaceId') || 'development';
    try {
      const db = getDB();
      const runs = db.prepare('SELECT run_id, workspace_id, symbol, status, created_at, completed_at FROM research_runs WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId);
      sendJSON(res, { success: true, runs });
    } catch (err) {
      logger.error('SERVER', 'Error fetching runs', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── RUNS: Get run details ─────────────────────────────────────────────
  if (pathname === '/api/runs/details' && req.method === 'GET') {
    const runId = urlObj.searchParams.get('runId');
    if (!runId) {
      sendJSON(res, { success: false, error: 'Missing runId' }, 400);
      return;
    }
    try {
      const db = getDB();
      const run = db.prepare('SELECT * FROM research_runs WHERE run_id = ?').get(runId);
      if (run) {
        try { run.config = JSON.parse(run.config || '{}'); } catch(e) {}
        try { run.versions = JSON.parse(run.versions || '{}'); } catch(e) {}
        try { run.statistics = JSON.parse(run.statistics || '{}'); } catch(e) {}
        sendJSON(res, { success: true, run });
      } else {
        sendJSON(res, { success: false, error: 'Run not found' }, 404);
      }
    } catch (err) {
      logger.error('SERVER', 'Error fetching run details', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }
  // ─── LABELS: Save human-labelled concept instances to a JSON log ─────────
  // POST /api/algo/labels  body: { concept, labels: [{time, priceHigh, priceLow, valid, type, direction, note, ...}] }
  if (pathname === '/api/algo/labels' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { concept, labels } = JSON.parse(body);
        if (!concept || !Array.isArray(labels)) {
          sendJSON(res, { success: false, error: 'Missing concept or labels array' }, 400);
          return;
        }
        const LABELS_FILE = path.join(__dirname, 'algo', 'labels', 'human_labels.json');
        let existing = [];
        if (fs.existsSync(LABELS_FILE)) {
          try { existing = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8') || '[]'); } catch (e) {}
        }
        const stamped = labels.map(l => ({
          ...l,
          concept,
          saved_at: new Date().toISOString()
        }));
        existing.push(...stamped);
        fs.mkdirSync(path.dirname(LABELS_FILE), { recursive: true });
        fs.writeFileSync(LABELS_FILE, JSON.stringify(existing, null, 2));
        logger.info('SERVER', `Saved ${stamped.length} labels for concept ${concept}`);
        sendJSON(res, { success: true, saved: stamped.length });
      } catch (err) {
        console.error('[Labels API Error]', err);
        sendJSON(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // GET /api/algo/labels — return all saved labels
  if (pathname === '/api/algo/labels' && req.method === 'GET') {
    const LABELS_FILE = path.join(__dirname, 'algo', 'labels', 'human_labels.json');
    if (!fs.existsSync(LABELS_FILE)) { sendJSON(res, []); return; }
    try {
      const data = fs.readFileSync(LABELS_FILE, 'utf8');
      sendJSON(res, JSON.parse(data || '[]'));
    } catch (err) {
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── AI SWING ENGINE: factor-weight documentation ──────────────────────
  // GET /api/ai/swings/factors
  // Returns the 7-factor confluence weight table so the frontend can render
  // a "factor breakdown" panel alongside detected pivots.
  if (pathname === '/api/ai/swings/factors' && req.method === 'GET') {
    try {
      const AISwingEngine = require('./algo/engines/aiSwingEngine');
      const factors = AISwingEngine.FACTOR_DOC.map(f => ({
        key: f.key,
        weight: f.weight,
        label: f.label,
        description: f.description
      }));
      sendJSON(res, {
        success: true,
        detector_id: 'AI_SWING_v1',
        weights: AISwingEngine.WEIGHTS,
        factors,
        confidence_buckets: [
          { label: 'very_high', min_score: 80 },
          { label: 'high',      min_score: 60 },
          { label: 'medium',    min_score: 40 },
          { label: 'low',       min_score: 0  }
        ]
      });
    } catch (err) {
      console.error('[AI Swing Factors API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── AI SWING ENGINE: multi-factor confluence-scored swing detector ────
  // GET /api/ai/swings?symbol=NQ_Historical_Data&timeframe=1&min_score=60&limit=500
  if (pathname === '/api/ai/swings' && req.method === 'GET') {
    const symbol = urlObj.searchParams.get('symbol') || 'NQ_Historical_Data';
    const timeframe = parseInt(urlObj.searchParams.get('timeframe') || '1', 10);
    const minScore = parseInt(urlObj.searchParams.get('min_score') || '40', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '500', 10);

    try {
      let rawBars = cache.get(symbol);
      if (!rawBars) {
        let filePath = symbolFiles.get(symbol);
        if (!filePath) { scanForSymbols(); filePath = symbolFiles.get(symbol); }
        if (!filePath) { sendJSON(res, { success: false, error: 'Symbol not found' }, 404); return; }
        rawBars = await parseCsvFile(filePath);
        if (rawBars.length > 0) cache.set(symbol, rawBars);
      }

      const AISwingEngine = require('./algo/engines/aiSwingEngine');
      const engine = new AISwingEngine(timeframe, symbol);
      const t0 = Date.now();
      const swings = engine.detect(rawBars, { timeframe, minScore, limit });
      const elapsedMs = Date.now() - t0;

      // Build confidence histogram
      const factors_summary = { very_high: 0, high: 0, medium: 0, low: 0 };
      for (const s of swings) {
        let props = null;
        try { props = JSON.parse(s.properties); } catch (_) {}
        if (props && factors_summary[props.ai_confidence] !== undefined) {
          factors_summary[props.ai_confidence]++;
        }
      }

      sendJSON(res, {
        success: true,
        detector_id: 'AI_SWING_v1',
        symbol,
        timeframe,
        min_score: minScore,
        swings,
        count: swings.length,
        bars_processed: rawBars.length,
        elapsed_ms: elapsedMs,
        factors_summary
      });
    } catch (err) {
      console.error('[AI Swings API Error]', err);
      sendJSON(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // ─── STATIC FRONTEND: serve built Vite assets from frontend/dist ─────────
  // Allows the preview gateway to route a single port (:8080) to the full app.
  if (!pathname.startsWith('/api/') && req.method === 'GET') {
    const FRONTEND_DIST = path.join(__dirname, 'frontend', 'dist');
    let relPath = decodeURIComponent(pathname);
    if (relPath === '/' || relPath === '') relPath = '/index.html';

    // Security: prevent path traversal
    if (relPath.includes('..')) {
      res.writeHead(400); res.end('Bad request'); return;
    }

    const candidate = path.join(FRONTEND_DIST, relPath);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.ico':  'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf':  'font/ttf',
        '.map':  'application/json'
      };
      const mime = mimeTypes[ext] || 'application/octet-stream';
      try {
        const data = fs.readFileSync(candidate);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        res.end(data);
        return;
      } catch (e) {
        // fall through to SPA fallback
      }
    }

    // SPA fallback: serve index.html for any non-API, non-static route
    const indexHtml = path.join(FRONTEND_DIST, 'index.html');
    if (fs.existsSync(indexHtml)) {
      try {
        const data = fs.readFileSync(indexHtml);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(data);
        return;
      } catch (e) {}
    }
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Not Found');

  } catch (outerErr) {
    // Outer safety net: catch anything that escaped all per-route handlers
    logger.error('SERVER', 'Unhandled error in request handler — returning 500', outerErr);
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message: outerErr.message }));
      } catch (_) { /* response already closed */ }
    }
  }
});

// Initialize database
try {
  const db = getDB();
  logger.info('SERVER', 'Database initialization check passed.');
  
  // Clean up stuck jobs (mark 'running' from previous process life as 'failed')
  const stuckCleanup = db.prepare("UPDATE research_jobs SET status = 'failed', error_message = 'Job terminated due to server restart' WHERE status = 'running'").run();
  if (stuckCleanup.changes > 0) {
    logger.info('SERVER', `Cleaned up ${stuckCleanup.changes} stuck running jobs on startup.`);
  }
  const runsCleanup = db.prepare("UPDATE research_runs SET status = 'failed' WHERE status = 'running'").run();
  if (runsCleanup.changes > 0) {
    logger.info('SERVER', `Cleaned up ${runsCleanup.changes} stuck running runs on startup.`);
  }
} catch (dbErr) {
  logger.error('SERVER', 'Database initialization failed', dbErr);
}

scanForSymbols();

server.listen(PORT, () => {
  logger.info('SERVER', `=== Node.js TradingView Backend Server Running on port ${PORT} ===`);
  logger.info('SERVER', 'Discovered symbols:');
  for (const [sym, fp] of symbolFiles.entries()) {
    logger.info('SERVER', `  - ${sym} -> ${fp}`);
  }

  // Pre-load ALL discovered symbols — check seed status and CSV file changes
  for (const [symbol, filePath] of symbolFiles.entries()) {
    logger.info('SERVER', `[Startup] Checking database seed status for: ${symbol}`);

    // ── CSV file-change detection ──────────────────────────────────────────
    // If the CSV file was modified AFTER the last pipeline run completed, the
    // user has dropped new data. We must clear old bars + events and re-run
    // the pipeline to prevent mixing old + new price data on the chart.
    let csvChanged = false;
    try {
      const csvMtime = fs.statSync(filePath).mtimeMs;
      const db = getDB();
      const lastRun = db.prepare(`
        SELECT completed_at FROM research_runs
        WHERE symbol = ? AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
      `).get(symbol);
      if (lastRun && lastRun.completed_at) {
        const runTime = new Date(lastRun.completed_at + 'Z').getTime();
        if (csvMtime > runTime) {
          csvChanged = true;
          logger.info('SERVER', `[Startup] CSV file for ${symbol} modified after last pipeline run. Forcing re-sync.`);
          // Clear ALL old data for this symbol
          db.prepare('DELETE FROM market_bars WHERE symbol = ?').run(symbol);
          db.prepare('DELETE FROM structure_events WHERE symbol = ?').run(symbol);
          db.prepare('DELETE FROM liquidity_objects WHERE symbol = ?').run(symbol);
          db.prepare('DELETE FROM research_runs WHERE symbol = ?').run(symbol);
        }
      }
    } catch (e) {
      // If anything fails, fall through to normal seed check
    }

    // Check if DB is already fully seeded with at least one completed run that contains events
    let isSeeded = false;
    if (!csvChanged) {
      try {
        const db = getDB();
        const completedRun = db.prepare(`
          SELECT r.run_id FROM research_runs r
          JOIN structure_events e ON r.run_id = e.run_id
          WHERE r.symbol = ? AND r.status = 'completed' AND r.run_id LIKE 'job_%'
          LIMIT 1
        `).get(symbol);
        if (completedRun) {
          const countRes = db.prepare('SELECT COUNT(*) as count FROM structure_events WHERE symbol = ?').get(symbol);
          logger.info('SERVER', `[Startup] Database already seeded with ${countRes ? countRes.count : 0} events for ${symbol} (Run ID: ${completedRun.run_id}).`);
          isSeeded = true;
        }
      } catch (dbErr) {
        logger.error('SERVER', 'Failed to check completed run status in DB', dbErr);
      }
    }

    if (!isSeeded || csvChanged) {
      logger.info('SERVER', `[Startup] ${csvChanged ? 'CSV changed — re-syncing' : 'Database not seeded — triggering'} background worker sync for ${symbol}...`);
      triggerWorkerSync(symbol, filePath, { mode: 'interactive', limitBars: 80000 });
    } else {
      // Just warm the cache asynchronously on the main thread
      logger.info('SERVER', `[Startup] Warming cache in background for: ${symbol}`);
      parseCsvFile(filePath).then(rawBars => {
        cache.set(symbol, rawBars);
        logger.info('SERVER', `[Startup] Cache warmed successfully for ${symbol}.`);
      }).catch(err => {
        logger.error('SERVER', `[Startup] Warming cache failed for ${symbol}`, err);
      });
    }
  }
});

// Process-wide Uncaught Exception and Unhandled Rejection hooks for server stability
process.on('uncaughtException', (err) => {
  // EADDRINUSE is a normal startup conflict (e.g., bat script launched two copies).
  // Exit cleanly so the process manager can recover.
  if (err.code === 'EADDRINUSE') {
    process.exit(1);
  }
  logger.error('SYSTEM', 'CRITICAL: Uncaught Exception detected!', err);
  // Restart for any genuinely fatal error
  const isFatal =
    err.message.includes('FATAL') ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    (err.code && ['ERR_WORKER_OUT_OF_MEMORY', 'ERR_SYSTEM_ERROR'].includes(err.code));

  if (isFatal) {
    logger.error('SYSTEM', 'Fatal error — exiting process for restart.', err);
    process.exit(1);
  }
  // Non-fatal: log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('SYSTEM', 'CRITICAL: Unhandled Promise Rejection detected!', err);
  // Give active requests 1s to drain, then exit so process manager can restart
  setTimeout(() => {
    logger.error('SYSTEM', 'Exiting after unhandled rejection.');
    process.exit(1);
  }, 1000).unref();
});

