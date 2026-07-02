/**
 * LayerManager.js
 * Manages multiple transparent canvas layers dynamically, allowing
 * layers to be registered, unregistered, and updated.
 */
export default class LayerManager {
  constructor() {
    this.layers = new Map();
    this.sortedLayers = [];
  }

  registerLayer(name, canvas, renderFn, zIndex = 0) {
    const existing = this.layers.get(name);
    if (existing && existing.canvas === canvas) {
      existing.renderFn = renderFn;
      existing.zIndex = zIndex;
      return;
    }
    this.layers.set(name, {
      canvas,
      renderFn,
      zIndex,
      dirty: true
    });
    this._rebuildSorted();
  }

  unregisterLayer(name) {
    this.layers.delete(name);
    this._rebuildSorted();
  }

  _rebuildSorted() {
    this.sortedLayers = Array.from(this.layers.entries())
      .map(([name, layer]) => ({ name, ...layer }))
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  getLayer(name) {
    return this.layers.get(name);
  }

  setDirty(name, isDirty) {
    const layer = this.layers.get(name);
    if (layer) {
      layer.dirty = isDirty;
    }
  }

  setAllDirty() {
    for (const layer of this.layers.values()) {
      layer.dirty = true;
    }
  }

  renderDirty() {
    this.sortedLayers.forEach(layerRef => {
      const layer = this.layers.get(layerRef.name);
      if (layer && layer.dirty && layer.canvas) {
        const ctx = layer.canvas.getContext('2d');
        if (ctx) {
          layer.renderFn(ctx, layer.canvas);
          layer.dirty = false;
        }
      }
    });
  }
}
