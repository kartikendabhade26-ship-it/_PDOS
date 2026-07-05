// algo/profiler.js
class TelemetryProfiler {
  constructor() {
    this.reset();
  }

  reset() {
    this.stages = {};
    this.engines = {};
    this.counters = {
      barsProcessed: 0,
      eventsProduced: 0,
      dbReads: 0,
      dbWrites: 0
    };
  }

  startStage(stageName) {
    this.stages[stageName] = this.stages[stageName] || { totalMs: 0, startHr: null };
    this.stages[stageName].startHr = process.hrtime.bigint();
  }

  endStage(stageName) {
    if (this.stages[stageName] && this.stages[stageName].startHr) {
      const durationMs = Number(process.hrtime.bigint() - this.stages[stageName].startHr) / 1_000_000;
      this.stages[stageName].totalMs += durationMs;
      this.stages[stageName].startHr = null;
    }
  }

  startEnginePhase(engineName, timeframe, phaseName) {
    this.engines[engineName] = this.engines[engineName] || {};
    this.engines[engineName][timeframe] = this.engines[engineName][timeframe] || { totalMs: 0, phases: {} };
    this.engines[engineName][timeframe].phases[phaseName] = this.engines[engineName][timeframe].phases[phaseName] || { totalMs: 0, startHr: null };
    this.engines[engineName][timeframe].phases[phaseName].startHr = process.hrtime.bigint();
  }

  endEnginePhase(engineName, timeframe, phaseName) {
    const engine = this.engines[engineName]?.[timeframe];
    const phase = engine?.phases[phaseName];
    if (phase && phase.startHr) {
      const durationMs = Number(process.hrtime.bigint() - phase.startHr) / 1_000_000;
      phase.totalMs += durationMs;
      engine.totalMs += durationMs;
      phase.startHr = null;
    }
  }

  incrementCounter(counterName, amount = 1) {
    if (this.counters[counterName] !== undefined) {
      this.counters[counterName] += amount;
    }
  }

  report() {
    const reportData = {
      stages: {},
      engines: {},
      counters: { ...this.counters }
    };

    for (const [stageName, data] of Object.entries(this.stages)) {
      reportData.stages[stageName] = data.totalMs;
    }

    for (const [engineName, tfs] of Object.entries(this.engines)) {
      reportData.engines[engineName] = {};
      for (const [tf, tfData] of Object.entries(tfs)) {
        reportData.engines[engineName][tf] = {
          totalMs: tfData.totalMs,
          phases: {}
        };
        for (const [phaseName, phaseData] of Object.entries(tfData.phases)) {
          reportData.engines[engineName][tf].phases[phaseName] = phaseData.totalMs;
        }
      }
    }

    return reportData;
  }
}

const profiler = new TelemetryProfiler();
global.profiler = profiler;

module.exports = profiler;
