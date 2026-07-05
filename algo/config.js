// algo/config.js
module.exports = {
  analysisBars: 15000, // Configurable Analysis Window size for Analysis Mode
  symbols: {
    'NQ_Historical_Data': {
      liquidityTolerance: 2.0, // Configurable structural tolerance for NQ (matches TakingProphets 2.0 handles threshold)
      analysisBars: 15000
    },
    'default': {
      liquidityTolerance: 2.0,
      analysisBars: 15000
    }
  }
};
