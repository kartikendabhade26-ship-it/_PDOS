/**
 * algo/engines/BaseEngine.js
 * Abstract base class for all PDOS detection engines.
 * Provides the common constructor interface (timeframe, symbol)
 * and enforces the detect / updateState / validate / serialize contract.
 * All logic lives in subclasses — this class has no detection logic.
 */

class BaseEngine {
  constructor(timeframe = 1, symbol = '') {
    this.timeframe = timeframe;
    this.symbol = symbol;
  }

  /**
   * Primary detection pass — must be overridden by subclasses.
   * @param {Array} bars - Array of OHLCV bar objects
   * @param {Object} options - Engine-specific option flags
   * @param {Object} context - Shared pre-computed context (swings, liquidity, etc.)
   * @returns {Array} Raw detected event objects
   */
  detect(bars, options = {}, context = {}) {
    throw new Error(`${this.constructor.name}.detect() not implemented`);
  }

  /**
   * State update pass for existing active events.
   * @param {Array} activeEvents - Currently open/active events
   * @param {Array} bars - Current bar window
   * @param {Object} context - Shared context
   * @returns {Array} Updated event objects
   */
  updateState(activeEvents, bars, context = {}) {
    return [];
  }

  /**
   * Validate an event before persisting.
   * @param {Object} event - Raw detected event
   * @returns {{ isValid: boolean, reason: string }}
   */
  validate(event) {
    return { isValid: true, reason: '' };
  }

  /**
   * Serialize an event to the structure_events DB schema.
   * @param {Object} event - Raw detected event
   * @returns {Object} DB-ready event record
   */
  serialize(event) {
    return event;
  }
}

module.exports = BaseEngine;
