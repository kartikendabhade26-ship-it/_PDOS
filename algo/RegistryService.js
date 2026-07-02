/**
 * algo/RegistryService.js
 * Registry Service Layer. Delegates all data storage/read commands to the active repository adapter.
 */

const SqliteRegistryRepository = require('./repositories/SqliteRegistryRepository');

// Load active adapter implementation (can be swapped in configurations)
const activeRepository = new SqliteRegistryRepository();

class RegistryService {
  static getRepository() {
    return activeRepository;
  }

  static executeInTransaction(callback, dbName) {
    this.getRepository().executeInTransaction(callback, dbName);
  }

  static clearRunData(dbName, runId) {
    this.getRepository().clearRunData(dbName, runId);
  }

  static deleteBars(dbName, symbol) {
    this.getRepository().deleteBars(dbName, symbol);
  }

  // --- Candlestick Methods ---
  static insertBars(dbName, symbol, timeframe, bars) {
    this.getRepository().insertBars(dbName, symbol, timeframe, bars);
  }

  static getCandles(dbName, symbol, timeframe, start, end, limit) {
    return this.getRepository().getCandles(dbName, symbol, timeframe, start, end, limit);
  }

  // --- Concept / Event Methods ---
  static insertEvents(dbName, runId, events) {
    this.getRepository().insertEvents(dbName, runId, events);
  }

  static getEvents(dbName, runId, symbol, timeframe, start, end, limit) {
    return this.getRepository().getEvents(dbName, runId, symbol, timeframe, start, end, limit);
  }

  static updateEventState(dbName, runId, eventId, state, invalidatedAt) {
    this.getRepository().updateEventState(dbName, runId, eventId, state, invalidatedAt);
  }

  static getEventDetails(dbName, runId, eventId) {
    return this.getRepository().getEventDetails(dbName, runId, eventId);
  }

  // --- Relationship Methods ---
  static insertRelationships(dbName, runId, relationships) {
    this.getRepository().insertRelationships(dbName, runId, relationships);
  }

  static getEventRelationships(dbName, runId, eventId) {
    return this.getRepository().getEventRelationships(dbName, runId, eventId);
  }

  // --- Outcome Methods ---
  static insertOutcomes(dbName, runId, outcomes) {
    this.getRepository().insertOutcomes(dbName, runId, outcomes);
  }

  // --- Context Snapshot Methods ---
  static insertContexts(dbName, runId, contexts) {
    this.getRepository().insertContexts(dbName, runId, contexts);
  }

  // --- Liquidity Object Methods ---
  static insertLiquidityObjects(dbName, runId, liquidity) {
    this.getRepository().insertLiquidityObjects(dbName, runId, liquidity);
  }

  static getLiquidityObjects(dbName, runId, symbol, timeframe, start, end, limit) {
    return this.getRepository().getLiquidityObjects(dbName, runId, symbol, timeframe, start, end, limit);
  }

  // --- Human Validation Methods ---
  static saveValidation(dbName, runId, validation) {
    this.getRepository().saveValidation(dbName, runId, validation);
  }

  static getValidation(dbName, runId, eventId) {
    return this.getRepository().getValidation(dbName, runId, eventId);
  }

  // --- Advanced Research Queries ---
  static getResearchQuery(dbName, runId, filterSql, params, limit, offset, sortBy, sortOrder) {
    return this.getRepository().getResearchQuery(dbName, runId, filterSql, params, limit, offset, sortBy, sortOrder);
  }

  static countResearchQuery(dbName, runId, filterSql, params) {
    return this.getRepository().countResearchQuery(dbName, runId, filterSql, params);
  }

  // --- Checkpoints Methods ---
  static saveCheckpoint(dbName, runId, symbol, checkpoint) {
    this.getRepository().saveCheckpoint(dbName, runId, symbol, checkpoint);
  }

  static getCheckpoint(dbName, runId, symbol) {
    return this.getRepository().getCheckpoint(dbName, runId, symbol);
  }
}

module.exports = RegistryService;
