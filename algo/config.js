// algo/config.js
module.exports = {
  symbols: {
    'NQ_Historical_Data': {
      liquidityTolerance: 2.0, // Configurable structural tolerance for NQ (matches TakingProphets 2.0 handles threshold)
    },
    'default': {
      liquidityTolerance: 2.0
    }
  }
};
