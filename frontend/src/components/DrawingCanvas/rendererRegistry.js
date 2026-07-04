import SwingRenderer from './renderers/SwingRenderer';
import LiquidityObjectRenderer from './renderers/LiquidityObjectRenderer';
import DealingRangeRenderer from './renderers/DealingRangeRenderer';

class RendererRegistry {
  constructor() {
    this.renderers = {
      swing: new SwingRenderer(),
      strong_swing: new SwingRenderer(),
      swing_high: new SwingRenderer(),   // STH/ITH/LTH
      swing_low: new SwingRenderer(),    // STL/ITL/LTL
      liquidity: new LiquidityObjectRenderer(),
      liquidity_object: new LiquidityObjectRenderer(),
      dealing_range: new DealingRangeRenderer()
    };
  }

  get(type) {
    const key = (type || '').toLowerCase();
    return this.renderers[key] || null;
  }
}

export default new RendererRegistry();
