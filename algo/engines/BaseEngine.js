/**
 * algo/engines/BaseEngine.js
 * Base Engine Contract. Defines standard interface for all PDOS Price Engines.
 */

class BaseEngine {
  /**
   * Run primitive candidate detection on a series of bars.
   * @param {Array} bars - Raw or aggregated price bars
   * @param {Object} options - Detection parameters (tolerances, thresholds)
   * @param {Object} context - Supporting precomputed data (swings, ATR)
   * @returns {Array<Object>} List of candidate event objects
   */
  detect(bars, options = {}, context = {}) {
    throw new Error("detect() must be implemented by engine subclass");
  }

  /**
   * Update the state lifecycle of active events (sweeps, mitigation, reclaims, breakout archiving).
   * @param {Array<Object>} activeEvents - Active events to trace
   * @param {Array} bars - Historical/streaming price bars
   * @param {Object} context - ATR, volatility, and SMA values
   * @returns {Array<Object>} List of state transition records
   */
  updateState(activeEvents, bars, context = {}) {
    throw new Error("updateState() must be implemented by engine subclass");
  }

  /**
   * Validate a single event against mathematical or logical rules.
   * @param {Object} event - Event object to check
   * @returns {Object} { isValid: boolean, reason: string }
   */
  validate(event) {
    return { isValid: true, reason: "" };
  }

  /**
   * Serialize the engine event into the standard database schema record.
   * @param {Object} event - Event object to serialize
   * @returns {Object} DB insert fields
   */
  serialize(event) {
    throw new Error("serialize() must be implemented by engine subclass");
  }
}

module.exports = BaseEngine;
