// ChartEventBus.js
// Throttled pub/sub event broker for low-latency visual synchronization

const listeners = new Set();
let lastEmit = 0;

export const ChartEventBus = {
  /**
   * Publish an event to all subscribers.
   * Throttled specifically for high-frequency CrosshairMove events to maintain a 16ms frame budget.
   * @param {Object} event - { type: string, payload: any, sourceId: string }
   */
  emit(event) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    if (event.type === 'CrosshairMove') {
      if (now - lastEmit < 16) return;
      lastEmit = now;
    }

    listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (err) {
        console.error('[ChartEventBus] Error fanning out event:', err);
      }
    });
  },

  /**
   * Subscribe to the global event broker.
   * @param {Function} callback - Callback function(event)
   * @returns {Function} Unsubscribe teardown function
   */
  subscribe(callback) {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }
};
