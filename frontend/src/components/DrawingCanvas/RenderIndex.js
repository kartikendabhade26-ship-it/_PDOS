import RendererRegistry from './rendererRegistry';

/**
 * RenderIndex.js
 * A generic temporal index that categorizes and slices renderable candidates
 * without hardcoding any specific market concepts.
 */
export default class RenderIndex {
  constructor() {
    this.allObjects = [];
    this.pointObjects = [];
    this.intervalObjects = [];
  }

  rebuild(candidates) {
    this.allObjects = candidates || [];
    
    // Sort chronologically by start time
    this.allObjects.sort((a, b) => {
      const ta = a.timeStart !== undefined ? a.timeStart : a.time;
      const tb = b.timeStart !== undefined ? b.timeStart : b.time;
      return ta - tb;
    });

    this.pointObjects = [];
    this.intervalObjects = [];

    this.allObjects.forEach(obj => {
      const renderer = RendererRegistry.get(obj.type);
      const renderType = renderer?.renderType || 'point';

      if (renderType === 'interval') {
        this.intervalObjects.push(obj);
      } else {
        this.pointObjects.push(obj);
      }
    });
  }

  getVisible(minTime, maxTime, limitTime, terminatedTimes) {
    const visible = [];

    // 1. Binary search point objects within [minTime, maxTime]
    let low = 0;
    let high = this.pointObjects.length - 1;
    let startIdx = this.pointObjects.length;
    let endIdx = -1;

    // Find first index where time >= minTime
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const objTime = this.pointObjects[mid].timeStart !== undefined
        ? this.pointObjects[mid].timeStart
        : this.pointObjects[mid].time;
      if (objTime >= minTime) {
        startIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Find last index where time <= maxTime
    low = 0;
    high = this.pointObjects.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const objTime = this.pointObjects[mid].timeStart !== undefined
        ? this.pointObjects[mid].timeStart
        : this.pointObjects[mid].time;
      if (objTime <= maxTime) {
        endIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) {
        const obj = this.pointObjects[i];
        const t0 = obj.timeStart !== undefined ? obj.timeStart : obj.time;
        if (t0 <= limitTime) {
          visible.push(obj);
        }
      }
    }

    // 2. Query interval objects that overlap [minTime, maxTime]
    this.intervalObjects.forEach(obj => {
      const t0 = obj.timeStart !== undefined ? obj.timeStart : obj.time;
      if (t0 > limitTime) return; // Future object in replay

      // Fetch termination time
      let t1 = obj.timeEnd !== undefined ? obj.timeEnd : null;
      if (t1 === null && terminatedTimes && terminatedTimes.has(obj.id)) {
        t1 = terminatedTimes.get(obj.id);
      }
      if (t1 === null || t1 === undefined) {
        t1 = Infinity;
      }

      // Overlap condition
      if (t0 <= maxTime && t1 >= minTime) {
        visible.push(obj);
      }
    });

    return visible;
  }
}
