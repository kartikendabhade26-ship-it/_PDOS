const RegistryService = require('./RegistryService');
const { getDB } = require('./db');
const logger = require('./logger');

// Cache the resolved run_id for a short window so we don't re-query on every request
let _cachedRunId = null;
let _cacheExpiry = 0;

class QueryEngine {
  /**
   * Dynamically resolve the latest completed (or running) run_id from the database.
   * Falls back to the most recent any-status run_id if no completed run exists.
   * Results are cached for 5 seconds to avoid DB overhead on rapid requests.
   */
  static resolveRunId(runIdOrDbName) {
    // If a concrete job_id was passed, use it directly
    if (runIdOrDbName && runIdOrDbName.startsWith('job_')) return runIdOrDbName;

    const now = Date.now();
    if (_cachedRunId && now < _cacheExpiry) return _cachedRunId;

    try {
      const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
      const db = getDB(dbName);

      // Prefer the most recent completed job, fall back to most recent of any status
      const row = db.prepare(`
        SELECT run_id FROM structure_events
        GROUP BY run_id
        ORDER BY MAX(time_start) DESC
        LIMIT 1
      `).get();

      if (row && row.run_id) {
        _cachedRunId = row.run_id;
        _cacheExpiry = now + 5000; // cache for 5 s
        return _cachedRunId;
      }
    } catch (e) {
      logger.warn('QUERY_ENGINE', 'Could not resolve run_id from DB, using fallback', e);
    }

    // Legacy fallback strings (only reached if DB is empty)
    if (!runIdOrDbName) return 'run_dev';
    if (runIdOrDbName === 'market_dev.db' || runIdOrDbName === 'development' || runIdOrDbName === 'interactive') return 'run_dev';
    if (runIdOrDbName === 'market_research.db' || runIdOrDbName === 'research' || runIdOrDbName === 'batch') return 'run_research';
    return runIdOrDbName;
  }

  /**
   * Fetch candlesticks (bars) for a given symbol, timeframe, and time range.
   */
  static getCandles(runIdOrDbName, symbol, timeframe, start, end, limit = 5000) {
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
    
    let actualStart = start;
    let actualEnd = end;

    if (!start || start === 0 || start === 1) {
      const runId = this.resolveRunId(runIdOrDbName);
      try {
        const { getDB } = require('./db');
        const db = getDB(dbName);

        const latestEvent = db.prepare(`
          SELECT MAX(time_start) as latest
          FROM structure_events
          WHERE run_id = ? AND symbol = ? COLLATE NOCASE AND timeframe = ?
        `).get(runId, symbol, timeframe);

        if (latestEvent && latestEvent.latest) {
          actualEnd = latestEvent.latest + timeframe * 60 * 200; // padding
          
          // Use direct SQLite LIMIT to fetch exactly the latest limit bars ending at actualEnd
          const rows = db.prepare(`
            SELECT time_epoch as time, open, high, low, close, volume
            FROM market_bars
            WHERE symbol = ? COLLATE NOCASE AND timeframe = ? AND time_epoch <= ?
            ORDER BY time_epoch DESC LIMIT ?
          `).all(symbol, timeframe, actualEnd, limit);
          return rows.reverse();
        }
      } catch (e) {
        // Fallback to defaults
      }
    }

    return RegistryService.getCandles(dbName, symbol, timeframe, actualStart, actualEnd, limit);
  }

  /**
   * Fetch structural events for a symbol, timeframe, and range.
   */
  static getEvents(runIdOrDbName, symbol, timeframe, start, end, limit = 15000) {
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
    const runId = this.resolveRunId(runIdOrDbName);
    
    let rows = RegistryService.getEvents(dbName, runId, symbol, timeframe, start, end, limit);

    // Also include dealing ranges from higher timeframes
    try {
      const { getDB } = require('./db');
      const db = getDB(dbName);
      const higherRanges = db.prepare(`
        SELECT e.event_id, e.root_event_id, e.parent_event_id, e.detector_id,
               e.symbol, e.timeframe, e.concept_family, e.concept_type, e.concept_state,
               e.time_start, e.time_end, e.price_high, e.price_low, e.direction, e.properties
        FROM structure_events e
        WHERE e.run_id = ? AND e.symbol = ? COLLATE NOCASE AND e.concept_type = 'Dealing Range' AND e.timeframe > ? AND e.time_start >= ? AND e.time_start <= ?
        ORDER BY e.time_start ASC LIMIT ?
      `).all(runId, symbol, timeframe, start, end, limit);
      
      if (higherRanges && higherRanges.length > 0) {
        rows = [...rows, ...higherRanges];
        const seen = new Set();
        rows = rows.filter(r => {
          if (seen.has(r.event_id)) return false;
          seen.add(r.event_id);
          return true;
        });
      }
    } catch (e) {
      // Fallback
    }

    return rows.map(r => {
      let properties = {};
      if (r.properties) {
        try { properties = JSON.parse(r.properties); } catch (e) {}
      }
      
      // Determine standardized client event type
      let type = r.concept_type.toLowerCase();
      if (type === 'bisi' || type === 'sibi') type = 'fvg';
      else if (type === 'ibisi' || type === 'isibi') type = 'ifvg';
      else if (['sth', 'ith', 'lth'].includes(type)) type = 'swing_high';
      else if (['stl', 'itl', 'ltl'].includes(type)) type = 'swing_low';
      else if (type === 'protected low' || type === 'protected high') type = 'protected_high_low';
      else if (type === 'volume imbalance') type = 'volume_imbalance';
      else if (type === 'liquidity void') type = 'liquidity_void';
      else if (['bsl', 'ssl', 'eqh', 'eql', 'reqh', 'reql'].includes(type)) type = 'liquidity';
      else if (type === 'dealing range') type = 'dealing_range';
      else if (type === 'narrative context') type = 'narrative_context';
      else if (type === 'structure confirmation') type = 'structure_confirm';
      else if (type === 'price delivery leg') type = 'delivery_leg';

      return {
        id: r.event_id,
        type: type,
        concept_label: r.concept_type,
        concept_family: r.concept_family,
        state: r.concept_state,
        time: r.time_start,
        timeStart: r.time_start,
        timeEnd: r.time_end,
        priceHigh: r.price_high,
        priceLow: r.price_low,
        direction: r.direction,
        symbol: r.symbol,
        timeframe: r.timeframe,
        properties
      };
    });
  }

  /**
   * Fetch liquidity objects.
   */
  static getLiquidityObjects(runIdOrDbName, symbol, timeframe, start, end, limit = 15000) {
    const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';
    const runId = this.resolveRunId(runIdOrDbName);
    
    const rows = RegistryService.getLiquidityObjects(dbName, runId, symbol, timeframe, start, end, limit);
    return rows.map(r => {
      let metadata = {};
      try { metadata = JSON.parse(r.metadata || '{}'); } catch (e) {}
      return {
        id: r.liquidity_id,
        type: 'liquidity_object',
        direction: r.liquidity_side === 'buy_side' ? 'bearish' : 'bullish',
        time: r.origin_timestamp,
        timeStart: r.origin_timestamp,
        timeEnd: null,
        priceHigh: r.price,
        priceLow: r.price,
        symbol: r.symbol,
        timeframe: r.timeframe,
        state: 'active',
        barIndex: r.origin_bar_index,
        confirmationBarIndex: r.confirmation_bar_index,
        properties: {
          parentSwingId: r.parent_swing_id,
          swingDegree: r.swing_degree,
          parentSwingType: r.parent_swing_type,
          liquiditySide: r.liquidity_side,
          ...metadata
        }
      };
    });
  }

  /**
   * Consolidated viewport query method.
   */
  static getVisibleWindow(runIdOrDbName, symbol, timeframe, start, end, limit = 15000) {
    // If start is 0 or null, anchor to the latest event timestamp (not latest candle),
    // so the initial view shows a region that actually has swings/liquidity drawn on it.
    let actualStart = start;
    let actualEnd = end;
    if (!start || start === 0) {
      const dbName = process.env.USE_TEST_DB === 'true' ? 'market_research_test.db' : 'market_research_v2.db';

      try {
        const { getDB } = require('./db');
        const db = getDB(dbName);
        const runId = this.resolveRunId(runIdOrDbName);

        // Find the latest event for this symbol/timeframe
        const latestEvent = db.prepare(`
          SELECT MAX(time_start) as latest
          FROM structure_events
          WHERE run_id = ? AND symbol = ? COLLATE NOCASE AND timeframe = ?
        `).get(runId, symbol, timeframe);


        if (latestEvent && latestEvent.latest) {
          // Show limit candles ending at (or just after) the latest event.
          // Pass start=1 (not 0) so getCandles uses the time-range path and respects the end cutoff.
          actualEnd = latestEvent.latest + timeframe * 60 * 200;
          const candles = this.getCandles(runIdOrDbName, symbol, timeframe, 1, actualEnd, limit);
          if (candles.length > 0) {
            actualStart = candles[0].time;
            actualEnd = candles[candles.length - 1].time;
          }

        } else {
          // No events — fall back to last limit candles
          const candles = this.getCandles(runIdOrDbName, symbol, timeframe, 0, 0, limit);
          if (candles.length > 0) {
            actualStart = candles[0].time;
            actualEnd = candles[candles.length - 1].time;
          } else {
            actualStart = 0;
            actualEnd = 9999999999;
          }
        }
      } catch (e) {
        // Fallback to last limit candles if anything errors
        const candles = this.getCandles(runIdOrDbName, symbol, timeframe, 0, 0, limit);
        if (candles.length > 0) {
          actualStart = candles[0].time;
          actualEnd = candles[candles.length - 1].time;
        } else {
          actualStart = 0;
          actualEnd = 9999999999;
        }
      }
    }

    const candles = this.getCandles(runIdOrDbName, symbol, timeframe, actualStart, actualEnd, limit);
    const events = this.getEvents(runIdOrDbName, symbol, timeframe, actualStart, actualEnd, limit);
    const liquidity = this.getLiquidityObjects(runIdOrDbName, symbol, timeframe, actualStart, actualEnd, limit);

    // Merge standard events and liquidity objects into a single candidates array for visualizer drawing
    const candidates = [...events, ...liquidity];

    return {
      candles,
      candidates
    };
  }
}

module.exports = QueryEngine;
