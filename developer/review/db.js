const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DB_NAME = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
const DB_PATH = path.join(__dirname, '..', DB_NAME);
let dbInstance = null;

function getDB() {
  if (!dbInstance) {
    logger.info('DATABASE', `Initializing SQLite database at: ${DB_PATH}`);
    dbInstance = new DatabaseSync(DB_PATH);
    initTables();
  }
  return dbInstance;
}

function initTables() {
  const db = dbInstance;

  // Check and upgrade schema if needed
  try {
    const info = db.prepare("PRAGMA table_info(event_context_snapshots);").all();
    if (info.length > 0) {
      const hasCol = info.some(col => col.name === 'htf_structure_event_id');
      if (!hasCol) {
        logger.warn('DATABASE', 'Schema upgrade needed: htf_structure_event_id column is missing. Dropping event_context_snapshots table...');
        db.exec("DROP TABLE IF EXISTS event_context_snapshots;");
      }
    }
  } catch (err) {
    // Table doesn't exist yet, nothing to do
  }

  // Enable foreign keys (off for fast syncing), WAL mode, synchronous off, and busy timeout
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = OFF;');
  db.exec('PRAGMA busy_timeout = 10000;');

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

  // 3. Structure Events Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS structure_events (
      event_id TEXT PRIMARY KEY,
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
      FOREIGN KEY (detector_id) REFERENCES detector_versions (detector_id) ON DELETE CASCADE,
      FOREIGN KEY (parent_event_id) REFERENCES structure_events (event_id) ON DELETE SET NULL,
      FOREIGN KEY (root_event_id) REFERENCES structure_events (event_id) ON DELETE SET NULL
    );
  `);

  // Create indexes for fast canvas rendering and multi-timeframe scans
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_mtf ON structure_events (root_event_id, parent_event_id);`);
  
  // Drop old binary-collation indexes if they exist to force COLLATE NOCASE rebuild (migration)
  try {
    const sqlTime = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_struct_events_time'").get()?.sql;
    if (sqlTime && !sqlTime.includes('COLLATE NOCASE')) {
      logger.warn('DATABASE', 'Migrating idx_struct_events_time to COLLATE NOCASE...');
      db.exec('DROP INDEX IF EXISTS idx_struct_events_time;');
    }
    const sqlQuery = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_struct_events_query'").get()?.sql;
    if (sqlQuery && !sqlQuery.includes('COLLATE NOCASE')) {
      logger.warn('DATABASE', 'Migrating idx_struct_events_query to COLLATE NOCASE...');
      db.exec('DROP INDEX IF EXISTS idx_struct_events_query;');
    }
  } catch (err) {
    logger.error('DATABASE', 'Failed to check index collation migration status', err);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_query ON structure_events (symbol COLLATE NOCASE, timeframe, concept_family, concept_state);`);
  // Covering index for the main /api/events query: ORDER BY time_start DESC LIMIT N
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_time ON structure_events (symbol COLLATE NOCASE, timeframe, time_start DESC);`);
  // Index for validation queries and general searches by concept family
  db.exec(`CREATE INDEX IF NOT EXISTS idx_struct_events_family ON structure_events (symbol COLLATE NOCASE, concept_family, time_start DESC);`);

  // 4. Event Relationships Table (Nesting and triggers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_relationships (
      parent_event_id TEXT NOT NULL,
      child_event_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL, -- 'nested_inside', 'triggered_by', 'mitigated_by'
      PRIMARY KEY (parent_event_id, child_event_id),
      FOREIGN KEY (parent_event_id) REFERENCES structure_events (event_id) ON DELETE CASCADE,
      FOREIGN KEY (child_event_id) REFERENCES structure_events (event_id) ON DELETE CASCADE
    );
  `);

  // 5. Event Outcomes Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_outcomes (
      event_id TEXT PRIMARY KEY,
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
      FOREIGN KEY (event_id) REFERENCES structure_events (event_id) ON DELETE CASCADE
    );
  `);

  // 6. Human Validations Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS human_validations (
      validation_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL, -- 'approved', 'rejected', 'modified'
      modified_price_high REAL,
      modified_price_low REAL,
      correction_notes TEXT,
      validated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES structure_events (event_id) ON DELETE CASCADE
    );
  `);

  // 7. Event Context Snapshots Table (The Market Context Feature Table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_context_snapshots (
      event_id TEXT PRIMARY KEY,
      
      -- NEW ENTITY FIELDS
      symbol TEXT,
      timeframe INTEGER,

      -- TIME CONTEXT
      time_year INTEGER,
      time_quarter INTEGER,
      time_month INTEGER,
      time_weekday INTEGER,
      time_session TEXT,
      time_hour INTEGER,
      
      -- PRICE CONTEXT
      price_daily_range_pct REAL,
      price_atr_14 REAL,
      price_volatility_regime REAL,
      price_premium_discount_status REAL,
      price_dist_daily_high REAL,
      price_dist_daily_low REAL,
      price_dist_weekly_high REAL,
      price_dist_weekly_low REAL,
      
      -- MARKET STRUCTURE CONTEXT
      structure_bias_1m INTEGER, -- -1 (bearish), 0 (neutral), 1 (bullish)
      structure_bias_5m INTEGER,
      structure_bias_15m INTEGER,
      structure_bias_1h INTEGER,
      structure_bias_4h INTEGER,
      structure_bias_daily INTEGER,
      htf_structure_event_id TEXT,
      ltf_structure_event_id TEXT,
      nearest_htf_high REAL,
      nearest_htf_low REAL,
      
      -- LIQUIDITY CONTEXT
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
      
      -- FVG CONTEXT
      fvg_size REAL,
      fvg_atr_ratio REAL,
      fvg_age INTEGER,
      fvg_untouched_nearby_count INTEGER,
      nearest_fvg_price REAL,
      nearest_fvg_event_id TEXT,
      
      -- IMBLANCES CONTEXT
      nearest_void_price REAL,
      nearest_void_event_id TEXT,
      nearest_volume_imbalance_price REAL,
      nearest_volume_imbalance_event_id TEXT,

      -- ORDER FLOW CONTEXT
      flow_before_mss INTEGER,
      flow_after_mss INTEGER,
      flow_before_bos INTEGER,
      flow_after_bos INTEGER,
      flow_sweep_occurred INTEGER,
      flow_no_sweep INTEGER,
      
      -- SESSION CONTEXT
      session_asia INTEGER,
      session_london INTEGER,
      session_ny INTEGER,
      session_ny_am INTEGER,
      session_ny_pm INTEGER,
      
      -- OUTCOME CONTEXT
      outcome_mfe REAL,
      outcome_mae REAL,
      outcome_time_to_mitigation INTEGER,
      outcome_time_to_failure INTEGER,
      outcome_time_to_target INTEGER,

      FOREIGN KEY (event_id) REFERENCES structure_events (event_id) ON DELETE CASCADE
    );
  `);

  // 8. Liquidity Objects Table (PDOS Sprint 1 Immutable Registry)
  db.exec(`
    CREATE TABLE IF NOT EXISTS liquidity_objects (
      liquidity_id TEXT PRIMARY KEY,
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
      metadata TEXT,                     -- JSON string (e.g. {"session": "London"})
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_swing_id) REFERENCES structure_events (event_id) ON DELETE CASCADE
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_liquidity_objects_query ON liquidity_objects (symbol COLLATE NOCASE, timeframe, origin_timestamp DESC);`);

  // Seed default detector versions if not already seeded
  const seedVersions = [
    { id: 'SWING_v1', type: 'swing', desc: '3-bar fractal swing high/low detector' },
    { id: 'SWING_HIERARCHY_v1', type: 'swing_hierarchy', desc: 'Degree-2+ (ITH/ITL/LTH/LTL) hierarchical swing pivot detector' },
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
    { id: 'LIQUIDITY_INTERACTION_v1', type: 'liquidity_interaction', desc: 'Liquidity Interaction Engine (Touch, Test, Sweep, Take, Reclaim, Consume, Archive)' }
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
}

// Helpers for CRUD
function executeTransaction(callback) {
  const db = getDB();
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

module.exports = {
  getDB,
  executeTransaction,
  DB_PATH
};
