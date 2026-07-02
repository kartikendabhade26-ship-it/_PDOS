// PrimitiveManager.js
// Orchestrates creation, update, and deletion of custom Lightweight Charts series primitives

import { SwingPrimitive } from './renderers/SwingPrimitive';

export class PrimitiveManager {
  constructor(series) {
    this._series = series;
    this._primitives = new Map(); // Map<eventId, primitiveInstance>
  }

  /**
   * Sync active swings data with attached primitives.
   * Employs object identity to avoid detaching/re-attaching unmodified objects.
   * @param {Array} swingsData - Swings candidate events
   */
  sync(swingsData) {
    if (!this._series) return;

    const incomingKeys = new Set();

    // 1. Process incoming swings (create or update)
    swingsData.forEach((swing) => {
      const eventId = swing.id || `${swing.time}_${swing.price}_${swing.label}`;
      incomingKeys.add(eventId);

      const color = swing.color || (swing.type === 'high' ? '#f23645' : '#089981');

      if (!this._primitives.has(eventId)) {
        // Create new swing primitive and attach
        const prim = new SwingPrimitive(
          swing.time,
          swing.price,
          swing.label,
          { isHigh: swing.type === 'high', color }
        );
        this._series.attachPrimitive(prim);
        this._primitives.set(eventId, prim);
      } else {
        // Update existing primitive if needed
        const prim = this._primitives.get(eventId);
        prim.update({
          time: swing.time,
          price: swing.price,
          label: swing.label,
          options: { isHigh: swing.type === 'high', color }
        });
      }
    });

    // 2. Cleanup stale swings (not present in incoming list)
    for (const [eventId, prim] of this._primitives.entries()) {
      if (!incomingKeys.has(eventId)) {
        try {
          this._series.detachPrimitive(prim);
        } catch (err) {
          // Ignored: series might have been modified
        }
        this._primitives.delete(eventId);
      }
    }
  }

  /**
   * Clear all attached primitives from the series.
   */
  clear() {
    if (!this._series) return;
    for (const prim of this._primitives.values()) {
      try {
        this._series.detachPrimitive(prim);
      } catch (err) {
        // Ignored: series might have been disposed
      }
    }
    this._primitives.clear();
  }
}
