/**
 * algo/repositories/SqliteRegistryRepository.js
 * Concrete SQLite Registry Repository adapter. Exposes basic stateless CRUD methods.
 */

const { getDB, executeTransaction } = require('../db');

class SqliteRegistryRepository {
  /**
   * Helper to execute queries inside a transaction
   */
  executeInTransaction(callback, dbName) {
    executeTransaction(callback, dbName);
  }

  // --- Run Lifecycle Methods ---

  clearRunData(dbName, runId) {
    const db = getDB(dbName);
    db.prepare('DELETE FROM event_relationships WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM event_outcomes WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM event_context_snapshots WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM structure_events WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM liquidity_objects WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM research_sync_checkpoints WHERE run_id = ?').run(runId);
  }

  deleteBars(dbName, symbol) {
    const db = getDB(dbName);
    db.prepare('DELETE FROM market_bars WHERE symbol = ?').run(symbol);
  }

  // --- Candlestick Methods ---
  
  insertBars(dbName, symbol, timeframe, bars) {
    const db = getDB(dbName);
    const insertBar = db.prepare(`
      INSERT OR REPLACE INTO market_bars (symbol, timeframe, time_epoch, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const b of bars) {
      insertBar.run(symbol, timeframe, b.time, b.open, b.high, b.low, b.close, b.volume);
    }
  }

  getCandles(dbName, symbol, timeframe, start, end, limit) {
    const db = getDB(dbName);
    if (!start || start === 0) {
      const rows = db.prepare(`
        SELECT time_epoch as time, open, high, low, close, volume
        FROM market_bars
        WHERE symbol = ? COLLATE NOCASE AND timeframe = ?
        ORDER BY time_epoch DESC LIMIT ?
      `).all(symbol, timeframe, limit);
      return rows.reverse();
    }
    return db.prepare(`
      SELECT time_epoch as time, open, high, low, close, volume
      FROM market_bars
      WHERE symbol = ? COLLATE NOCASE AND timeframe = ? AND time_epoch >= ? AND time_epoch <= ?
      ORDER BY time_epoch ASC LIMIT ?
    `).all(symbol, timeframe, start, end, limit);
  }

  // --- Concept / Event Methods ---

  insertEvents(dbName, runId, events) {
    const db = getDB(dbName);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO structure_events 
      (run_id, event_id, root_event_id, parent_event_id, detector_id, symbol, timeframe, concept_family, concept_type, concept_state, time_start, time_end, price_high, price_low, direction, properties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of events) {
      stmt.run(
        runId,
        e.event_id,
        e.root_event_id,
        e.parent_event_id,
        e.detector_id,
        e.symbol,
        e.timeframe,
        e.concept_family,
        e.concept_type,
        e.concept_state,
        e.time_start,
        e.time_end,
        e.price_high,
        e.price_low,
        e.direction,
        e.properties
      );
    }
  }

  getEvents(dbName, runId, symbol, timeframe, start, end, limit) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT e.event_id, e.root_event_id, e.parent_event_id, e.detector_id,
             e.symbol, e.timeframe, e.concept_family, e.concept_type, e.concept_state,
             e.time_start, e.time_end, e.price_high, e.price_low, e.direction, e.properties
      FROM structure_events e
      WHERE e.run_id = ? AND e.symbol = ? COLLATE NOCASE AND e.timeframe = ? AND e.time_start >= ? AND e.time_start <= ?
      ORDER BY e.time_start ASC LIMIT ?
    `).all(runId, symbol, timeframe, start, end, limit);
  }

  updateEventState(dbName, runId, eventId, state, invalidatedAt) {
    const db = getDB(dbName);
    db.prepare(`
      UPDATE structure_events 
      SET concept_state = ?, invalidated_at = ?
      WHERE run_id = ? AND event_id = ?
    `).run(state, invalidatedAt, runId, eventId);
  }

  getEventDetails(dbName, runId, eventId) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT * FROM structure_events 
      WHERE run_id = ? AND event_id = ?
    `).get(runId, eventId);
  }

  // --- Relationship Methods ---

  insertRelationships(dbName, runId, relationships) {
    const db = getDB(dbName);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO event_relationships
      (run_id, parent_event_id, child_event_id, relationship_type)
      VALUES (?, ?, ?, ?)
    `);
    for (const r of relationships) {
      stmt.run(runId, r.parent_event_id, r.child_event_id, r.relationship_type);
    }
  }

  getEventRelationships(dbName, runId, eventId) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT r.parent_event_id, r.child_event_id, r.relationship_type,
             e.concept_type AS child_concept_type, e.time_start AS child_time_start
      FROM event_relationships r
      LEFT JOIN structure_events e ON r.child_event_id = e.event_id AND r.run_id = e.run_id
      WHERE r.run_id = ? AND r.parent_event_id = ?
    `).all(runId, eventId);
  }

  // --- Outcome Methods ---

  insertOutcomes(dbName, runId, outcomes) {
    const db = getDB(dbName);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO event_outcomes
      (run_id, event_id, is_mitigated, mitigation_time, mitigation_price, mfe, mae, time_to_mitigation, time_to_failure, time_to_target, fvg_fill_percent, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const o of outcomes) {
      stmt.run(
        runId,
        o.event_id,
        o.is_mitigated,
        o.mitigation_time,
        o.mitigation_price,
        o.mfe,
        o.mae,
        o.time_to_mitigation,
        o.time_to_failure,
        o.time_to_target,
        o.fvg_fill_percent,
        o.is_valid
      );
    }
  }

  // --- Context Snapshot Methods ---

  insertContexts(dbName, runId, contexts) {
    const db = getDB(dbName);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO event_context_snapshots
      (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of contexts) {
      stmt.run(
        runId, c.event_id, c.symbol, c.timeframe, c.time_year, c.time_quarter, c.time_month, c.time_weekday, c.time_session, c.time_hour,
        c.price_daily_range_pct, c.price_atr_14, c.price_volatility_regime, c.price_premium_discount_status,
        c.price_dist_daily_high, c.price_dist_daily_low, c.price_dist_weekly_high, c.price_dist_weekly_low,
        c.structure_bias_1m, c.structure_bias_5m, c.structure_bias_15m, c.structure_bias_1h, c.structure_bias_4h, c.structure_bias_daily,
        c.htf_structure_event_id, c.ltf_structure_event_id, c.nearest_htf_high, c.nearest_htf_low,
        c.liq_closest_above, c.liq_closest_below, c.liq_dist_to_above, c.liq_dist_to_below, c.liq_eq_high_present, c.liq_eq_low_present,
        c.nearest_bsl_price, c.nearest_bsl_event_id, c.nearest_ssl_price, c.nearest_ssl_event_id,
        c.fvg_size, c.fvg_atr_ratio, c.fvg_age, c.fvg_untouched_nearby_count, c.nearest_fvg_price, c.nearest_fvg_event_id,
        c.nearest_void_price, c.nearest_void_event_id, c.nearest_volume_imbalance_price, c.nearest_volume_imbalance_event_id,
        c.flow_before_mss, c.flow_after_mss, c.flow_before_bos, c.flow_after_bos, c.flow_sweep_occurred, c.flow_no_sweep,
        c.session_asia, c.session_london, c.session_ny, c.session_ny_am, c.session_ny_pm,
        c.outcome_mfe, c.outcome_mae, c.outcome_time_to_mitigation, c.outcome_time_to_failure, c.outcome_time_to_target
      );
    }
  }

  // --- Liquidity Object Methods ---

  insertLiquidityObjects(dbName, runId, liquidity) {
    const db = getDB(dbName);
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO liquidity_objects
      (run_id, liquidity_id, parent_swing_id, price, parent_swing_type, liquidity_side, swing_degree, timeframe, symbol, origin_bar_index, confirmation_bar_index, origin_timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of liquidity) {
      stmt.run(
        runId,
        l.liquidity_id,
        l.parent_swing_id,
        l.price,
        l.parent_swing_type,
        l.liquidity_side,
        l.swing_degree,
        l.timeframe,
        l.symbol,
        l.origin_bar_index,
        l.confirmation_bar_index,
        l.origin_timestamp,
        l.metadata
      );
    }
  }

  getLiquidityObjects(dbName, runId, symbol, timeframe, start, end, limit) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT liquidity_id, parent_swing_id, price, parent_swing_type, liquidity_side, swing_degree, timeframe, symbol,
             origin_bar_index, confirmation_bar_index, origin_timestamp, metadata
      FROM liquidity_objects
      WHERE run_id = ? AND symbol = ? COLLATE NOCASE AND timeframe = ? AND origin_timestamp >= ? AND origin_timestamp <= ?
      ORDER BY origin_timestamp ASC LIMIT ?
    `).all(runId, symbol, timeframe, start, end, limit);
  }

  // --- Human Validation Methods ---

  saveValidation(dbName, runId, v) {
    const db = getDB(dbName);
    db.prepare(`
      INSERT OR REPLACE INTO human_validations
      (run_id, validation_id, event_id, user_id, status, modified_price_high, modified_price_low, correction_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, v.validation_id, v.event_id, v.user_id, v.status, v.modified_price_high, v.modified_price_low, v.correction_notes);
  }

  getValidation(dbName, runId, eventId) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT status, correction_notes FROM human_validations
      WHERE run_id = ? AND event_id = ?
    `).get(runId, eventId);
  }

  // --- Advanced Research Queries ---

  getResearchQuery(dbName, runId, filterSql, params, limit, offset, sortBy, sortOrder) {
    const db = getDB(dbName);
    
    // Safety check on order parameters
    const allowedSortColumns = ['event_id', 'timeframe', 'concept_family', 'concept_type', 'concept_state', 'time_start', 'price_high', 'price_low', 'mfe', 'mae', 'validation_status'];
    const finalSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'time_start';
    const finalSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const querySql = `
      SELECT e.*, 
             o.is_mitigated, o.mitigation_time, o.mitigation_price, o.mfe, o.mae, o.fvg_fill_percent, o.is_valid,
             v.status AS validation_status, v.correction_notes AS validation_notes,
             ctx.time_session, ctx.price_premium_discount_status
      FROM structure_events e
      LEFT JOIN event_outcomes o ON e.event_id = o.event_id AND e.run_id = o.run_id
      LEFT JOIN human_validations v ON e.event_id = v.event_id AND e.run_id = v.run_id
      LEFT JOIN event_context_snapshots ctx ON e.event_id = ctx.event_id AND e.run_id = ctx.run_id
      WHERE e.run_id = ? ${filterSql}
      ORDER BY ${finalSortBy} ${finalSortOrder} LIMIT ? OFFSET ?
    `;

    const fullParams = [runId, ...params, limit, offset];
    return db.prepare(querySql).all(...fullParams);
  }

  countResearchQuery(dbName, runId, filterSql, params) {
    const db = getDB(dbName);
    const countSql = `
      SELECT COUNT(*) as count 
      FROM structure_events e
      LEFT JOIN event_context_snapshots ctx ON e.event_id = ctx.event_id AND e.run_id = ctx.run_id
      WHERE e.run_id = ? ${filterSql}
    `;
    return db.prepare(countSql).get(runId, ...params).count;
  }

  // --- Checkpoints Methods ---

  saveCheckpoint(dbName, runId, symbol, checkpoint) {
    const db = getDB(dbName);
    db.prepare(`
      INSERT OR REPLACE INTO research_sync_checkpoints
      (run_id, symbol, last_processed_timestamp, last_processed_index, detector_state_hash, engine_version, registry_version, build_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      symbol,
      checkpoint.last_processed_timestamp,
      checkpoint.last_processed_index,
      checkpoint.detector_state_hash,
      checkpoint.engine_version,
      checkpoint.registry_version,
      checkpoint.build_hash
    );
  }

  getCheckpoint(dbName, runId, symbol) {
    const db = getDB(dbName);
    return db.prepare(`
      SELECT * FROM research_sync_checkpoints
      WHERE run_id = ? AND symbol = ?
    `).get(runId, symbol);
  }
}

module.exports = SqliteRegistryRepository;
