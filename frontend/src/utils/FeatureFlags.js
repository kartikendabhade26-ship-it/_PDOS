// FeatureFlags.js
// Configures and exposes feature flags to toggle rendering backends dynamically

const flags = {
  'primitive_manager.swings': 'shadow', // 'off' | 'shadow' | 'on'
  'primitive_manager.liquidity': 'off',  // 'off' | 'shadow' | 'on'
  'legacy_canvas_fallback': 'on'        // 'off' | 'on'
};

export const FeatureFlags = {
  /**
   * Get the current state of a feature flag.
   * @param {string} flag - Flag name
   * @returns {string} State of the flag ('off', 'shadow', 'on')
   */
  get(flag) {
    return flags[flag] || 'off';
  },

  /**
   * Set a feature flag state.
   * @param {string} flag - Flag name
   * @param {string} state - Flag state
   */
  set(flag, state) {
    flags[flag] = state;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('feature_flag_changed', {
        detail: { flag, state }
      }));
    }
  }
};
