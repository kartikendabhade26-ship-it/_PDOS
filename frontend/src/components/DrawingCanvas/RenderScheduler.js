/**
 * RenderScheduler.js
 * Coalesces rendering requests from multiple sources into a single requestAnimationFrame render pass.
 * Marks canvas layers as dirty and handles execution.
 */
export default class RenderScheduler {
  constructor(layerManager) {
    this.layerManager = layerManager;
    this.scheduled = false;
    this.rafId = null;          // [Bug 1] track rAF handle for cancellation
    this.preRenderFns = [];     // [Bug 3] per-frame state-update hooks
  }

  // [Bug 3] Register a function to run once at the start of each scheduled
  // frame, before any dirty layer is rendered. Returns an unsubscribe fn.
  addPreRender(fn) {
    this.preRenderFns.push(fn);
    return () => {
      const i = this.preRenderFns.indexOf(fn);
      if (i >= 0) this.preRenderFns.splice(i, 1);
    };
  }

  markDirty(layerName) {
    this.layerManager.setDirty(layerName, true);
    this.schedule();
  }

  markAllDirty() {
    this.layerManager.setAllDirty();
    this.schedule();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.rafId = requestAnimationFrame(() => {
      this.scheduled = false;
      this.rafId = null;
      // [Bug 3] Run pre-render hooks once per frame
      for (let i = 0; i < this.preRenderFns.length; i++) {
        try {
          this.preRenderFns[i]();
        } catch (e) {
          // swallow errors to protect render loop
        }
      }
      this.layerManager.renderDirty();
    });
  }

  // [Bug 1] Cancel any pending rAF and detach preRender hooks.
  // Call on unmount to prevent stale renders.
  cleanup() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.scheduled = false;
    this.preRenderFns = [];
  }
}
