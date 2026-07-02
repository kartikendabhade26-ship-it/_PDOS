const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const dbInstances = new Map();

function getDB(dbName) {
  const targetName = dbName || (process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db');
  const targetPath = path.isAbsolute(targetName) ? targetName : path.join(__dirname, '..', targetName);
  
  let db = dbInstances.get(targetPath);
  if (!db) {
    logger.info('DATABASE', `Initializing SQLite database at: ${targetPath}`);
    db = new DatabaseSync(targetPath);
    dbInstances.set(targetPath, db);
    migrateSchema(db, targetPath);
    initTables(db);
  }
  return db;
}

function migrateSchema(db, targetPath) {
  let needsMigration = false;
  try {
    const info = db.prepare("PRAGMA table_info(structure_events);").all();
    if (info.length > 0) {
      const hasRunId = info.some(col => col.name === 'run_id');
      if (!hasRunId) {
        needsMigration = true;
      }
    }
  } catch (err) {
    // structure_events doesn't exist yet, nothing to do
  }

  if (needsMigration) {
    logger.warn('DATABASE', 'Migration check: run_id column is missing from structure_events. Initiating safe database migration...');
    const backupPath = targetPath.replace(/\.db$/, '.backup.db');
    try {
      fs.copyFileSync(targetPath, backupPath);
      logger.info('DATABASE', `Safe database backup file created at: ${backupPath}`);
    } catch (err) {
      logger.error('DATABASE', `Safe database backup failed! Aborting migration to prevent data loss.`, err);
      throw err;
    }

    const tablesToRename = [
      'structure_events',
      'event_relationships',
      'event_outcomes',
      'human_validations',
      'event_context_snapshots',
      'liquidity_objects',
      'research_sync_checkpoints'
    ];

    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const tbl of tablesToRename) {
        db.exec(`DROP TABLE IF EXISTS ${tbl}_old;`); // Safety clean
        db.exec(`ALTER TABLE ${tbl} RENAME TO ${tbl}_old;`);
      }
      db.exec('COMMIT;');
      logger.info('DATABASE', 'Legacy tables renamed successfully.');
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error('DATABASE', 'Failed to rename legacy tables!', err);
      throw err;
    }

    // Now call initTables to create the new tables
    initTables(db);

    // Copy rows from old tables into new tables under 'run_legacy'
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // Copy structure_events
      db.exec(`
        INSERT OR REPLACE INTO structure_events (
          run_id, event_id, root_event_id, parent_event_id, detector_id, symbol, timeframe,
          concept_family, concept_type, concept_state, time_start, time_end,
          price_high, price_low, direction, properties, created_at, confirmed_at, mitigated_at, invalidated_at
        )
        SELECT 
          'run_legacy', event_id, root_event_id, parent_event_id, detector_id, symbol, timeframe,
          concept_family, concept_type, concept_state, time_start, time_end,
          price_high, price_low, direction, properties, created_at, confirmed_at, mitigated_at, invalidated_at
        FROM structure_events_old;
      `);

      // Copy event_relationships
      db.exec(`
        INSERT OR REPLACE INTO event_relationships (run_id, parent_event_id, child_event_id, relationship_type)
        SELECT 'run_legacy', parent_event_id, child_event_id, relationship_type
        FROM event_relationships_old;
      `);

      // Copy event_outcomes
      db.exec(`
        INSERT OR REPLACE INTO event_outcomes (
          run_id, event_id, is_mitigated, mitigation_time, mitigation_price, mfe, mae,
          time_to_mitigation, time_to_failure, time_to_target, fvg_fill_percent, is_valid
        )
        SELECT 
          'run_legacy', event_id, is_mitigated, mitigation_time, mitigation_price, mfe, mae,
          time_to_mitigation, time_to_failure, time_to_target, fvg_fill_percent, is_valid
        FROM event_outcomes_old;
      `);

      // Copy human_validations
      db.exec(`
        INSERT OR REPLACE INTO human_validations (
          run_id, validation_id, event_id, user_id, status,
          modified_price_high, modified_price_low, correction_notes, validated_at
        )
        SELECT 
          'run_legacy', validation_id, event_id, user_id, status,
          modified_price_high, modified_price_low, correction_notes, validated_at
        FROM human_validations_old;
      `);

      // Copy event_context_snapshots
      db.exec(`
        INSERT OR REPLACE INTO event_context_snapshots (
          run_id, event_id, symbol, timeframe, time_year, time_quarter, time_month, time_weekday, time_session, time_hour,
          price_daily_range_pct, price_atr_14, price_volatility_regime, price_premium_discount_status,
          price_dist_daily_high, price_dist_daily_low, price_dist_weekly_high, price_dist_weekly_low,
          structure_bias_1m, structure_bias_5m, structure_bias_15m, structure_bias_1h, structure_bias_4h, structure_bias_daily,
          htf_structure_event_id, ltf_structure_event_id, nearest_htf_high, nearest_htf_low,
          liq_closest_above, liq_closest_below, liq_dist_to_above, liq_dist_to_below, liq_eq_high_present, liq_eq_low_present,
          nearest_bsl_price, nearest_bsl_event_id, nearest_ssl_price, nearest_ssl_event_id,
          fvg_size, fvg_atr_ratio, fvg_age, fvg_untouched_nearby_count, nearest_fvg_price, nearest_fvg_event_id,
          nearest_void_price, nearest_void_event_id, nearest_volume_imbalance_price, nearest_volume_imbalance_event_id,
          flow_before_mss, flow_after_mss, flow_before_bos, flow_after_bos, flow_sweep_occurred, flow_no_sweep,
          session_asia, session_london, session_ny, session_ny_am, session_ny_pm,
          outcome_mfe, outcome_mae, outcome_time_to_mitigation, outcome_time_to_failure, outcome_time_to_target
        )
        SELECT 
          'run_legacy', event_id, symbol, timeframe, time_year, time_quarter, time_month, time_weekday, time_session, time_hour,
          price_daily_range_pct, price_atr_14, price_volatility_regime, price_premium_discount_status,
          price_dist_daily_high, price_dist_daily_low, price_dist_weekly_high, price_dist_weekly_low,
          structure_bias_1m, structure_bias_5m, structure_bias_15m, structure_bias_1h, structure_bias_4h, structure_bias_daily,
          htf_structure_event_id, ltf_structure_event_id, nearest_htf_high, nearest_htf_low,
          liq_closest_above, liq_closest_below, liq_dist_to_above, liq_dist_to_below, liq_eq_high_present, liq_eq_low_present,
          nearest_bsl_price, nearest_bsl_event_id, nearest_ssl_price, nearest_ssl_event_id,
          fvg_size, fvg_atr_ratio, fvg_age, fvg_untouched_nearby_count, nearest_fvg_price, nearest_fvg_event_id,
          nearest_void_price, nearest_void_event_id, nearest_volume_imbalance_price, nearest_volume_imbalance_event_id,
          flow_before_mss, flow_after_mss, flow_before_bos, flow_after_bos, flow_sweep_occurred, flow_no_sweep,
          session_asia, session_london, session_ny, session_ny_am, session_ny_pm,
          outcome_mfe, outcome_mae, outcome_time_to_mitigation, outcome_time_to_failure, outcome_time_to_target
        FROM event_context_snapshots_old;
      `);

      // Copy liquidity_objects
      db.exec(`
        INSERT OR REPLACE INTO liquidity_objects (
          run_id, liquidity_id, parent_swing_id, price, parent_swing_type, liquidity_side,
          swing_degree, timeframe, symbol, origin_bar_index, confirmation_bar_index, origin_timestamp, metadata, created_at
        )
        SELECT 
          'run_legacy', liquidity_id, parent_swing_id, price, parent_swing_type, liquidity_side,
          swing_degree, timeframe, symbol, origin_bar_index, confirmation_bar_index, origin_timestamp, metadata, created_at
        FROM liquidity_objects_old;
      `);

      // Copy research_sync_checkpoints
      db.exec(`
        INSERT OR REPLACE INTO research_sync_checkpoints (
          run_id, symbol, last_processed_timestamp, last_processed_index, detector_state_hash,
          engine_version, registry_version, build_hash
        )
        SELECT 
          'run_legacy', symbol, last_processed_timestamp, last_processed_index, detector_state_hash,
          engine_version, registry_version, build_hash
        FROM research_sync_checkpoints_old;
      `);

      db.exec('COMMIT;');
      logger.info('DATABASE', 'Legacy data copied to new run-partitioned tables successfully.');
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error('DATABASE', 'Failed to copy legacy data to new partitioned tables!', err);
      throw err;
    }

    // Drop the old tables
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const tbl of tablesToRename) {
        db.exec(`DROP TABLE IF EXISTS ${tbl}_old;`);
      }
      db.exec('COMMIT;');
      logger.info('DATABASE', 'Temporary legacy tables dropped.');
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error('DATABASE', 'Failed to drop temporary legacy tables!', err);
      throw err;
    }
  }
}

function initTables(db) {
  // Enable foreign keys (off for fast syncing), WAL mode, synchronous off, and busy timeout
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = OFF;');
    db.exec('PRAGMA busy_timeout = 10000;');
  } catch (pragmaErr) {
    logger.warn('DATABASE', 'Failed to configure WAL/pragmas - proceeding with SQLite defaults', pragmaErr);
  }

  // 1. Detector Versions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS detector_versions (
      detector_id TEXT PRIMARY KEY,
      concept_type TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Market Bars Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_bars (
      symbol TEXT NOT NULL,
      timeframe INTEGER NOT NULL,
      time_epoch INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY (symbol, timeframe, time_epoch)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_market_bars_query ON market_bars (symbol COLLATE NOCASE, timeframe, time_epoch DESC);`);

  // 3. Workspaces Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Research Runs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      run_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,               -- 'running' | 'completed' | 'failed'
      config TEXT NOT NULL,               -- JSON parameters (ranges, lookaheads)
      versions TEXT NOT NULL,             -- JSON engine versions
      statistics TEXT,                    -- JSON run metrics (counts, timings)
      validation_results TEXT,            -- JSON validation checks output
      logs TEXT,                          -- Text logs compiled during run
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
    );
  `);

  // 5. Research Jobs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_jobs (
      job_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      task_type TEXT NOT NULL,      -- 'research_run' | 'validate_run' | etc.
      status TEXT NOT NULL,         -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      cancel_requested INTEGER DEFAULT 0,
      parent_job TEXT,
      progress_pct REAL DEFAULT 0.0,
      config TEXT,                  -- JSON parameters
      versions TEXT,                -- JSON system/engine versions
      results TEXT,                 -- JSON metrics output
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT
    );
  `);

  // 6. Structure Events Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS structure_events (
      run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      root_event_id TEXT,
      parent_event_id TEXT,
      detector_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe INTEGER NOT NULL,
      concept_family TEXT NOT NULL, -- 'Imbalances', 'Liquidity', 'Structure Breaks', 'Order Flow', 'Swings'
      concept_type TEXT NOT NULL,   -- 'BISI', 'SIBI', 'IBISI', 'ISIBI', 'BOS', 'MSS', 'BSL', 'SSL', 'OB', 'Breaker'
      concept_state TEXT NOT NULL,  -- 'active', 'mitigated', 'failed', 'inverted'
      time_start INTEGER NOT NULL,
      time_end INTEGER,
      price_high REAL NOT NULL,
      price_low REAL NOT NULL,
      direction TEXT NOT NULL,
      properties TEXT,              -- JSON string of extra properties
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT,
      mitigated_at TEXT,
      invalidated_at TEXT,
      PRIMARY KEY (run_id, event_id),
      FOREIGN KEY (run_id) REFERENCES research_runs (run_id) ON DELETE CASCADE,
      FOREIGN KEY (detector_id) REFERENCES detector_versions (detector_id) ON DELETE CASCADE
    );
  `);

  // Create indexes for fast canvas rendering and multi-timeframe scans
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_mtf ON structure_events (run_id, root_event_id, parent_event_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_query ON structure_events (run_id, symbol COLLATE NOCASE, timeframe, concept_family, concept_state);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_time ON structure_events (run_id, symbol COLLATE NOCASE, timeframe, time_start DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_family ON structure_events (run_id, symbol COLLATE NOCASE, concept_family, time_start DESC);`);

  // 7. Event Relationships Table (Nesting and triggers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_relationships (
      run_id TEXT NOT NULL,
      parent_event_id TEXT NOT NULL,
      child_event_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL, -- 'nested_inside', 'triggered_by', 'mitigated_by'
      PRIMARY KEY (run_id, parent_event_id, child_event_id),
      FOREIGN KEY (run_id, parent_event_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE,
      FOREIGN KEY (run_id, child_event_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE
    );
  `);

  // 8. Event Outcomes Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_outcomes (
      run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      is_mitigated INTEGER DEFAULT 0,
      mitigation_time INTEGER,
      mitigation_price REAL,
      mfe REAL,
      mae REAL,
      time_to_mitigation INTEGER,
      time_to_failure INTEGER,
      time_to_target INTEGER,
      fvg_fill_percent REAL,
      is_valid INTEGER DEFAULT 1,
      PRIMARY KEY (run_id, event_id),
      FOREIGN KEY (run_id, event_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE
    );
  `);

  // 9. Human Validations Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS human_validations (
      run_id TEXT NOT NULL,
      validation_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL, -- 'approved', 'rejected', 'modified'
      modified_price_high REAL,
      modified_price_low REAL,
      correction_notes TEXT,
      validated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id, event_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE
    );
  `);

  // 10. Event Context Snapshots Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_context_snapshots (
      run_id TEXT NOT NULL,
      event_id TEXT PRIMARY KEY,
      symbol TEXT,
      timeframe INTEGER,
      time_year INTEGER,
      time_quarter INTEGER,
      time_month INTEGER,
      time_weekday INTEGER,
      time_session TEXT,
      time_hour INTEGER,
      price_daily_range_pct REAL,
      price_atr_14 REAL,
      price_volatility_regime REAL,
      price_premium_discount_status REAL,
      price_dist_daily_high REAL,
      price_dist_daily_low REAL,
      price_dist_weekly_high REAL,
      price_dist_weekly_low REAL,
      structure_bias_1m INTEGER,
      structure_bias_5m INTEGER,
      structure_bias_15m INTEGER,
      structure_bias_1h INTEGER,
      structure_bias_4h INTEGER,
      structure_bias_daily INTEGER,
      htf_structure_event_id TEXT,
      ltf_structure_event_id TEXT,
      nearest_htf_high REAL,
      nearest_htf_low REAL,
      liq_closest_above REAL,
      liq_closest_below REAL,
      liq_dist_to_above REAL,
      liq_dist_to_below REAL,
      liq_eq_high_present INTEGER,
      liq_eq_low_present INTEGER,
      nearest_bsl_price REAL,
      nearest_bsl_event_id TEXT,
      nearest_ssl_price REAL,
      nearest_ssl_event_id TEXT,
      fvg_size REAL,
      fvg_atr_ratio REAL,
      fvg_age INTEGER,
      fvg_untouched_nearby_count INTEGER,
      nearest_fvg_price REAL,
      nearest_fvg_event_id TEXT,
      nearest_void_price REAL,
      nearest_void_event_id TEXT,
      nearest_volume_imbalance_price REAL,
      nearest_volume_imbalance_event_id TEXT,
      flow_before_mss INTEGER,
      flow_after_mss INTEGER,
      flow_before_bos INTEGER,
      flow_after_bos INTEGER,
      flow_sweep_occurred INTEGER,
      flow_no_sweep INTEGER,
      session_asia INTEGER,
      session_london INTEGER,
      session_ny INTEGER,
      session_ny_am INTEGER,
      session_ny_pm INTEGER,
      outcome_mfe REAL,
      outcome_mae REAL,
      outcome_time_to_mitigation INTEGER,
      outcome_time_to_failure INTEGER,
      outcome_time_to_target INTEGER,
      FOREIGN KEY (run_id, event_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE
    );
  `);

  // 11. Liquidity Objects Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS liquidity_objects (
      run_id TEXT NOT NULL,
      liquidity_id TEXT NOT NULL,
      parent_swing_id TEXT NOT NULL,
      price REAL NOT NULL,
      parent_swing_type TEXT NOT NULL,   -- 'high' | 'low'
      liquidity_side TEXT NOT NULL,      -- 'buy_side' | 'sell_side'
      swing_degree INTEGER NOT NULL,
      timeframe INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      origin_bar_index INTEGER NOT NULL,
      confirmation_bar_index INTEGER NOT NULL,
      origin_timestamp INTEGER NOT NULL,
      metadata TEXT,                     -- JSON string
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id, liquidity_id),
      FOREIGN KEY (run_id, parent_swing_id) REFERENCES structure_events (run_id, event_id) ON DELETE CASCADE
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_liquidity_objects_query ON liquidity_objects (run_id, symbol COLLATE NOCASE, timeframe, origin_timestamp DESC);`);

  // 12. Research Sync Checkpoints Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_sync_checkpoints (
      run_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      last_processed_timestamp INTEGER NOT NULL,
      last_processed_index INTEGER NOT NULL,
      detector_state_hash TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      registry_version TEXT NOT NULL,
      build_hash TEXT NOT NULL,
      PRIMARY KEY (run_id, symbol),
      FOREIGN KEY (run_id) REFERENCES research_runs (run_id) ON DELETE CASCADE
    );
  `);

  // Seed default detector versions if not already seeded
  const seedVersions = [
    { id: 'SWING_v1', type: 'swing', desc: '3-bar fractal swing high/low detector' },
    { id: 'STRONG_SWING_v1', type: 'strong_swing', desc: 'Pure structural strong swing high/low detector with subsequent displacement' },
    { id: 'FVG_v1', type: 'fvg', desc: 'Standard 3-bar Fair Value Gap (BISI/SIBI) detector' },
    { id: 'VOLUME_IMBALANCE_v1', type: 'volume_imbalance', desc: 'Volume Imbalance (gap between body close and open) detector' },
    { id: 'LIQUIDITY_VOID_v1', type: 'liquidity_void', desc: 'Liquidity Void (3 consecutive high-momentum candles) detector' },
    { id: 'IFVG_v1', type: 'ifvg', desc: 'Inverted Fair Value Gap (IBISI/ISIBI) state handler' },
    { id: 'MSS_v1', type: 'mss', desc: 'Market Structure Shift detector using SWING_v1 breaks' },
    { id: 'BOS_v1', type: 'bos', desc: 'Break of Structure detector using SWING_v1 breaks in trend direction' },
    { id: 'LIQUIDITY_v1', type: 'liquidity', desc: 'Equal Highs/Lows detector with 2.0 pt tolerance' },
    { id: 'OB_v1', type: 'ob', desc: 'Order Block and Breaker detector using momentum breakouts' },
    { id: 'DISPLACEMENT_v1', type: 'displacement', desc: 'Displacement candle detector' },
    { id: 'PROTECTED_v1', type: 'protected_high_low', desc: 'Protected swing high/low detector' },
    { id: 'SESSION_v1', type: 'session', desc: 'Session high/low detector' },
    { id: 'MACRO_v1', type: 'macro', desc: 'Macro high/low detector' },
    { id: 'AMD_v1', type: 'amd', desc: 'AMD cycle detector' },
    { id: 'PREMIUM_v1', type: 'premium_discount', desc: 'Premium/discount zone detector' },
    { id: 'REFERENCE_v1', type: 'reference_level', desc: 'DO, WO, MO, Session Opens, and previous HTF extremes' },
    { id: 'DEALING_RANGE_v1', type: 'dealing_range', desc: 'Centralized Dealing Range with delivery state context' },
    { id: 'NARRATIVE_CONTEXT_v1', type: 'narrative_context', desc: 'Compiled active market narrative context' },
    { id: 'MARKET_INTENT_v1', type: 'market_intent', desc: 'Checks post-sweep volume and candle expansion to confirm institutional commitment' },
    { id: 'PRICE_DELIVERY_v1', type: 'price_delivery', desc: 'Tracks active price delivery leg from swept source ERL to target ERL' },
    { id: 'STRUCTURE_CONFIRMATION_v1', type: 'structure_confirm', desc: 'Confirms price delivery legs when candle body closes past swing pivots' },
    { id: 'DEALING_RANGE_v2', type: 'dealing_range', desc: 'Centralized Dealing Range with delivery state context (V2)' },
    { id: 'BREAKER_v1', type: 'breaker', desc: 'Breaker Block detector' },
    { id: 'PD_ARRAY_CONTEXT_v1', type: 'pd_array_matrix', desc: 'Context-driven PD Array Matrix' },
    { id: 'LIQUIDITY_INTERACTION_v1', type: 'liquidity_interaction', desc: 'Liquidity Interaction Engine (Touch, Test, Sweep, Take, Reclaim, Consume, Archive)' },
    { id: 'SWING_HIERARCHY_v1', type: 'swing_hierarchy', desc: 'HTF swing hierarchy detector' }
  ];

  const checkStmt = db.prepare('SELECT COUNT(*) as count FROM detector_versions WHERE detector_id = ?');
  const insertStmt = db.prepare('INSERT INTO detector_versions (detector_id, concept_type, description) VALUES (?, ?, ?)');

  for (const v of seedVersions) {
    const res = checkStmt.get(v.id);
    if (res.count === 0) {
      insertStmt.run(v.id, v.type, v.desc);
      logger.info('DATABASE', `Seeded detector version: ${v.id}`);
    }
  }

  // Seed default workspaces
  const workspaces = [
    { id: 'development', name: 'Development', desc: 'Fast local development workspace' },
    { id: 'research', name: 'Research', desc: 'Comprehensive historical backtesting workspace' },
    { id: 'experiments', name: 'Experiments', desc: 'Hypothesis testing and isolated sandboxes' }
  ];
  const checkWorkspace = db.prepare('SELECT COUNT(*) as count FROM workspaces WHERE workspace_id = ?');
  const insertWorkspace = db.prepare('INSERT INTO workspaces (workspace_id, name, description) VALUES (?, ?, ?)');
  for (const ws of workspaces) {
    if (checkWorkspace.get(ws.id).count === 0) {
      insertWorkspace.run(ws.id, ws.name, ws.desc);
      logger.info('DATABASE', `Seeded default workspace: ${ws.name}`);
    }
  }

  // Seed default legacy run
  const checkRun = db.prepare('SELECT COUNT(*) as count FROM research_runs WHERE run_id = ?');
  const insertRun = db.prepare(`
    INSERT INTO research_runs (run_id, workspace_id, symbol, status, config, versions, statistics, validation_results, logs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  if (checkRun.get('run_legacy').count === 0) {
    insertRun.run('run_legacy', 'development', 'NQ_Historical_Data', 'completed', '{}', '{}', '{}', '{}', 'Pre-migration historical logs');
    logger.info('DATABASE', 'Seeded default research run: run_legacy');
  }
  if (checkRun.get('run_dev').count === 0) {
    insertRun.run('run_dev', 'development', 'NQ_Historical_Data', 'completed', '{}', '{}', '{}', '{}', 'Development/Interactive Mode run');
    logger.info('DATABASE', 'Seeded default research run: run_dev');
  }
  if (checkRun.get('run_research').count === 0) {
    insertRun.run('run_research', 'research', 'NQ_Historical_Data', 'completed', '{}', '{}', '{}', '{}', 'Batch Research Mode run');
    logger.info('DATABASE', 'Seeded default research run: run_research');
  }
}

// Helpers for CRUD
function executeTransaction(callback, dbNameOrInstance) {
  let db;
  if (typeof dbNameOrInstance === 'string') {
    db = getDB(dbNameOrInstance);
  } else if (dbNameOrInstance && typeof dbNameOrInstance.exec === 'function') {
    db = dbNameOrInstance;
  } else {
    db = getDB();
  }
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    logger.debug('DATABASE', 'Transaction BEGIN');
    callback(db);
    db.exec('COMMIT;');
    logger.debug('DATABASE', 'Transaction COMMIT');
  } catch (err) {
    db.exec('ROLLBACK;');
    logger.error('DATABASE', 'Transaction ROLLBACK', err);
    throw err;
  }
}

const DEFAULT_DB_NAME = 'market_research_v2.db';
const DB_PATH = path.join(__dirname, '..', DEFAULT_DB_NAME);

module.exports = {
  getDB,
  executeTransaction,
  DB_PATH
};
