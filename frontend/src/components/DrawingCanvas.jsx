import React, { useRef, useEffect, useState, useMemo } from 'react';
import { getESTInfo } from '../utils/sessions';
import { TrendLine } from './DrawingCanvas/tools/TrendLine';
import { getEventVisualConfig, hexToRGBA } from '../utils/themeResolver';
import { DEFAULT_VISIBILITY } from './DrawingSettingsModal';
import RendererRegistry from './DrawingCanvas/rendererRegistry';
import ChartProjectionService from './DrawingCanvas/ChartProjectionService';
import RenderIndex from './DrawingCanvas/RenderIndex';
import LayerManager from './DrawingCanvas/LayerManager';
import RenderScheduler from './DrawingCanvas/RenderScheduler';
import { FeatureFlags } from '../utils/FeatureFlags';
import { PrimitiveManager } from './DrawingCanvas/PrimitiveManager';

export function isDrawingVisible(shape, timeframe) {
  if (!shape) return false;
  if (!shape.visibility) return true; // Visible by default

  const vis = shape.visibility;

  if (timeframe < 60) {
    const minutesOption = vis.Minutes;
    if (!minutesOption) return true;
    if (!minutesOption.visible) return false;
    const minVal = minutesOption.min !== undefined ? minutesOption.min : 1;
    const maxVal = minutesOption.max !== undefined ? minutesOption.max : 59;
    return timeframe >= minVal && timeframe <= maxVal;
  } else if (timeframe >= 60 && timeframe < 1440) {
    const hoursOption = vis.Hours;
    if (!hoursOption) return true;
    if (!hoursOption.visible) return false;
    const hours = timeframe / 60;
    const minVal = hoursOption.min !== undefined ? hoursOption.min : 1;
    const maxVal = hoursOption.max !== undefined ? hoursOption.max : 24;
    return hours >= minVal && hours <= maxVal;
  } else if (timeframe >= 1440) {
    const daysOption = vis.Days;
    if (!daysOption) return true;
    if (!daysOption.visible) return false;
    const days = timeframe / 1440;
    const minVal = daysOption.min !== undefined ? daysOption.min : 1;
    const maxVal = daysOption.max !== undefined ? daysOption.max : 365;
    return days >= minVal && days <= maxVal;
  }

  return true;
}

const isTargetInOverlayOrModal = (target) => {
  if (!target) return false;
  return !!(
    target.tagName === 'INPUT' || 
    target.tagName === 'TEXTAREA' || 
    target.closest('.floating-toolbar-tv') || 
    target.closest('.settings-modal-tv') || 
    target.closest('.tv-settings-modal') ||
    target.closest('.tv-settings-overlay') ||
    target.closest('.modal-overlay') ||
    target.closest('.tv-popup')
  );
};

// Custom cursor: expand/reposition icon (two diagonal arrows) — shown on drawing endpoint handles
// Drawn as an inline SVG with white outline so it's visible on both light and dark chart backgrounds.
const _ENDPOINT_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="6" y1="6" x2="18" y2="18"/><polyline points="6,11 6,6 11,6"/><polyline points="18,13 18,18 13,18"/></g><g stroke="#131722" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="6" y1="6" x2="18" y2="18"/><polyline points="6,11 6,6 11,6"/><polyline points="18,13 18,18 13,18"/></g></svg>`;
const ENDPOINT_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(_ENDPOINT_CURSOR_SVG)}") 12 12, nwse-resize`;

export default function DrawingCanvas({
  chart,
  chartContainer,
  series,
  allBars,
  timeframe,
  activeTool,
  setActiveTool,
  drawings,
  setDrawings,
  selectedDrawing,
  setSelectedDrawing,
  magnetMode,
  lockDrawings,
  hideDrawings,
  showSessions,
  onAddUndoState,
  floatingToolbarPos,
  setFloatingToolbarPos,
  isToolbarPinned,
  defaultToolStyles,
  onOpenSettings,
  // New props for Algo Candidates overlay
  showAlgoZones = false,
  algoCandidates = [],
  selectedAlgoCandidate = null,
  onSelectAlgoCandidate = null,
  selectedConcept = '',
  replayMode = false,
  replayIndex = 0,
  narrativeMode = false,
  narrativeFocusRangeId = null,
  setNarrativeFocusRangeId = null,
  viewMode = 'narrative',
  analysisLayers = {},
  debugOverlayFilters = null,
  debugMode = false,
  symbol = '',
  onRenderCompleted = null
}) {
  const canvasRef = useRef(null);
  const isMountedRef = useRef(true);

  // Core services
  const projectionServiceRef = useRef(new ChartProjectionService());
  const renderIndexRef = useRef(new RenderIndex());
  const layerManagerRef = useRef(new LayerManager());
  const schedulerRef = useRef(new RenderScheduler(layerManagerRef.current));
  const primitiveManagerRef = useRef(null);

  const updateReplayTerminationsRef = useRef(null);
  const updateNarrativeContextRef = useRef(null);
  
  const currentNarrativeContextRef = useRef(null);
  const algoCandidatesMapRef = useRef(new Map());

  // Dynamic canvas layers
  const [layersConfig, setLayersConfig] = useState([
    { name: 'GridLayer', zIndex: 5 },
    { name: 'ZonesLayer', zIndex: 10 },
    { name: 'StructureLayer', zIndex: 15 },
    { name: 'LiquidityLayer', zIndex: 20 },
    { name: 'SwingsLayer', zIndex: 25 },
    { name: 'DrawingsLayer', zIndex: 30 },
    { name: 'InteractiveLayer', zIndex: 40 }
  ]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (schedulerRef.current) {
        schedulerRef.current.cleanup();
      }
    };
  }, []);

  useEffect(() => {
    const unsub = schedulerRef.current.addPreRender(() => {
      if (updateReplayTerminationsRef.current) updateReplayTerminationsRef.current();
      if (updateNarrativeContextRef.current) updateNarrativeContextRef.current();
    });
    return unsub;
  }, []);

  const [isDrawing, setIsDrawing] = useState(false);
  const isInvalidationPendingRef = useRef(false);
  const [inlineTextInput, setInlineTextInput] = useState(null);
  const dragStateRef = useRef(null); // { type: 'handle'|'body', index: number, pointIdx: number, startPoints: [], startCoords: {x,y} }
  const snappedPosRef = useRef(null);
  const priceLinesRef = useRef({}); // { [drawingId]: priceLine }
  const priceLineSeriesRef = useRef(null);
  
  const [rulerActive, setRulerActive] = useState(null); // { p1, p2 }

  // Snapshot refs for mouse handler speed
  const localDrawingsRef = useRef(drawings);
  const activeToolRef = useRef(activeTool);
  const selectedDrawingRef = useRef(selectedDrawing);
  const magnetModeRef = useRef(magnetMode);
  const lockDrawingsRef = useRef(lockDrawings);
  const hideDrawingsRef = useRef(hideDrawings);
  const isDrawingRef = useRef(isDrawing);
  const showSessionsRef = useRef(showSessions);
  const timeframeRef = useRef(timeframe);
  const mousePosRef = useRef(null); // { x, y }
  const onOpenSettingsRef = useRef(onOpenSettings);
  onOpenSettingsRef.current = onOpenSettings;
  const defaultToolStylesRef = useRef(defaultToolStyles);
  defaultToolStylesRef.current = defaultToolStyles;
  
  // Refs for Algo Candidates overlay props to keep callbacks fresh
  const showAlgoZonesRef = useRef(showAlgoZones);
  showAlgoZonesRef.current = showAlgoZones;
  const algoCandidatesRef = useRef(algoCandidates);
  algoCandidatesRef.current = algoCandidates;
  const selectedAlgoCandidateRef = useRef(selectedAlgoCandidate);
  selectedAlgoCandidateRef.current = selectedAlgoCandidate;
  const selectedConceptRef = useRef(selectedConcept);
  selectedConceptRef.current = selectedConcept;
  const narrativeModeRef = useRef(narrativeMode);
  narrativeModeRef.current = narrativeMode;
  const narrativeFocusRangeIdRef = useRef(narrativeFocusRangeId);
  narrativeFocusRangeIdRef.current = narrativeFocusRangeId;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const analysisLayersRef = useRef(analysisLayers);
  analysisLayersRef.current = analysisLayers;
  const debugOverlayFiltersRef = useRef(debugOverlayFilters);
  debugOverlayFiltersRef.current = debugOverlayFilters;
  const debugModeRef = useRef(debugMode);
  debugModeRef.current = debugMode;
  const replayModeRef = useRef(replayMode);
  replayModeRef.current = replayMode;
  const replayIndexRef = useRef(replayIndex);
  replayIndexRef.current = replayIndex;

  const liquidityStatesRef = useRef({
    bars: null,
    candidates: null,
    lastProcessedIndex: 0,
    terminatedTimes: new Map(), // eventId -> bar.time of first touch
    activeIds: new Set(),
    candidatesByTime: new Map(), // bar.time -> cand[]
    candidatesMap: new Map(),    // id -> cand (O(1) lookup)
    t0Cache: new Map(),          // cand.id -> startBarTime (cached per dataset)
    bisectLeft: (allBars, targetTime) => {
      let lo = 0, hi = allBars.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (allBars[mid].time < targetTime) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
  });

  // Recreate primitive manager when series changes
  useEffect(() => {
    if (primitiveManagerRef.current) {
      primitiveManagerRef.current.clear();
    }
    if (series) {
      primitiveManagerRef.current = new PrimitiveManager(series);
    } else {
      primitiveManagerRef.current = null;
    }
    return () => {
      if (primitiveManagerRef.current) {
        primitiveManagerRef.current.clear();
      }
    };
  }, [series]);

  // Dynamic feature flags change listener
  useEffect(() => {
    const handleFlagChanged = (e) => {
      const { flag, state } = e.detail;
      if (flag === 'primitive_manager.swings') {
        const cands = algoCandidates || [];
        if (primitiveManagerRef.current) {
          if (state === 'on' || state === 'shadow') {
            const swings = cands.filter(c => 
              c.type === 'swing' || c.type === 'strong_swing' || c.type === 'swing_high' || c.type === 'swing_low'
            );
            primitiveManagerRef.current.sync(swings);
          } else {
            primitiveManagerRef.current.clear();
          }
        }
        scheduleDraw();
      }
    };

    window.addEventListener('feature_flag_changed', handleFlagChanged);
    return () => window.removeEventListener('feature_flag_changed', handleFlagChanged);
  }, [algoCandidates]);


  // --- PRE-COMPUTE LIQUIDITY TERMINATION (runs once per data load, NOT 60fps) ---
  // Populates terminatedTimes + t0Cache so the renderer knows where each line ends,
  // in both live mode and replay mode.
  useEffect(() => {
    const state = liquidityStatesRef.current;
    const bars  = allBars || [];

    const cands = algoCandidates || [];

    // Rebuild candidates Map for O(1) lookups
    const map = algoCandidatesMapRef.current;
    map.clear();
    cands.forEach(c => map.set(c.id, c));

    // Full reset for new dataset
    state.bars = bars;
    state.candidates = cands;
    state.lastProcessedIndex = 0;
    state.terminatedTimes.clear();
    state.activeIds.clear();
    state.candidatesByTime.clear();
    state.t0Cache.clear();
    state.candidatesMap = new Map();

    // Rebuild RenderIndex and Projection datasets even if empty to prevent stale states
    projectionServiceRef.current.updateDataset(bars, timeframe);
    renderIndexRef.current.rebuild(cands);

    // Sync series primitives using PrimitiveManager if feature flag is active
    const swingsFlag = FeatureFlags.get('primitive_manager.swings');
    if (primitiveManagerRef.current) {
      if (swingsFlag === 'on' || swingsFlag === 'shadow') {
        const swings = cands.filter(c => 
          c.type === 'swing' || c.type === 'strong_swing' || c.type === 'swing_high' || c.type === 'swing_low'
        );
        primitiveManagerRef.current.sync(swings);
      } else {
        primitiveManagerRef.current.clear();
      }
    }

    if (bars.length === 0 || cands.length === 0) {
      scheduleDraw();
      return;
    }

    // Build candidatesMap and t0Cache; index each by its confirmation bar time
    cands.forEach(cand => {
      if (cand.type !== 'liquidity' && cand.type !== 'liquidity_object') return;
      state.candidatesMap.set(cand.id, cand);
      const isOld = cand.time < bars[0].time;
      let t0;
      if (isOld) {
        t0 = bars[0].time;
      } else {
        const originIdx = state.bisectLeft(bars, cand.time);
        t0 = (originIdx + 1 < bars.length) ? bars[originIdx + 1].time : null;
      }
      if (t0 != null) {
        state.t0Cache.set(cand.id, t0);
        if (!state.candidatesByTime.has(t0)) state.candidatesByTime.set(t0, []);
        state.candidatesByTime.get(t0).push(cand);
      }
    });

    // Sweep ALL bars once to find first-touch termination points
    // This runs synchronously but only when data changes (not 60fps)
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const list = state.candidatesByTime.get(bar.time);
      if (list) list.forEach(c => state.activeIds.add(c.id));
      if (state.activeIds.size > 0) {
        for (const id of state.activeIds) {
          const cand = state.candidatesMap.get(id);
          if (!cand) { state.activeIds.delete(id); continue; }
          const price = cand.priceHigh !== undefined ? cand.priceHigh : (cand.levelPrice || cand.priceLow);
          const side  = cand.properties?.liquiditySide;
          const isBuySide = side === 'buy_side' || cand.direction === 'bearish' || cand.concept_label?.toLowerCase() === 'bsl';
          if (isBuySide ? bar.high >= price : bar.low <= price) {
            state.terminatedTimes.set(id, bar.time);
            state.activeIds.delete(id);
          }
        }
      }
    }
    state.lastProcessedIndex = bars.length;

    scheduleDraw();
  }, [allBars, algoCandidates, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep local refs in sync with props/state
  activeToolRef.current = activeTool;
  selectedDrawingRef.current = selectedDrawing;
  magnetModeRef.current = magnetMode;
  lockDrawingsRef.current = lockDrawings;
  hideDrawingsRef.current = hideDrawings;
  isDrawingRef.current = isDrawing;
  showSessionsRef.current = showSessions;
  timeframeRef.current = timeframe;

  useEffect(() => {
    if (!dragStateRef.current) {
      localDrawingsRef.current = drawings;
      scheduleDraw();
    }
  }, [drawings]);

  useEffect(() => {
    projectionServiceRef.current.updateChartState(chart, series);
    scheduleDraw();
  }, [chart, series]);

  const allBarsRef = useRef(allBars);
  allBarsRef.current = allBars;

  const dragStartPosRef = useRef(null);
  const tempPointsRef = useRef([]);
  const scheduleDraw = () => {
    if (!isMountedRef.current) return;
    schedulerRef.current.markAllDirty();
  };



  // Canvas is kept pointer-events: none at all times so click-throughs natively flow to the chart,
  // while we capture and intercept drawing/dragging events at the container level.

  // Debug interval disabled in production to prevent console noise


  const updateCanvasSize = () => {
    const container = chartContainer;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    const backingWidth = Math.round(newWidth * dpr);
    const backingHeight = Math.round(newHeight * dpr);

    layerManagerRef.current.layers.forEach(layer => {
      const canvas = layer.canvas;
      if (canvas) {
        if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
          canvas.width = backingWidth;
          canvas.height = backingHeight;
        }
        canvas.style.width = `${newWidth}px`;
        canvas.style.height = `${newHeight}px`;
      }
    });

    projectionServiceRef.current.invalidateCache();
    schedulerRef.current.markAllDirty();

    if (!isInvalidationPendingRef.current) {
      isInvalidationPendingRef.current = true;
      setTimeout(() => {
        isInvalidationPendingRef.current = false;
        if (!isMountedRef.current) return;
        projectionServiceRef.current.invalidateCache();
        schedulerRef.current.markAllDirty();
        if (onRenderCompleted) {
          onRenderCompleted();
        }
      }, 0);
    }
  };

  useEffect(() => {
    if (!chart || !series || !chartContainer) return;

    const handleViewportChange = () => {
      projectionServiceRef.current.invalidateCache();
      schedulerRef.current.markAllDirty();

      if (!isInvalidationPendingRef.current) {
        isInvalidationPendingRef.current = true;
        setTimeout(() => {
          isInvalidationPendingRef.current = false;
          if (!isMountedRef.current) return;
          projectionServiceRef.current.invalidateCache();
          schedulerRef.current.markAllDirty();
          if (onRenderCompleted) {
            onRenderCompleted();
          }
        }, 0);
      }
    };

    try {
      chart.timeScale().subscribeVisibleLogicalRangeChange(handleViewportChange);
    } catch (e) {
      console.warn('[DrawingCanvas] Error subscribing to visible logical range change:', e);
    }

    // Set canvas size immediately
    updateCanvasSize();

    // Resize observer for canvas size matching
    const observer = new ResizeObserver(() => {
      updateCanvasSize();
      schedulerRef.current.markAllDirty();
    });
    observer.observe(chartContainer);

    // Keyboard state tracking to refresh canvas (for dynamic Ctrl/Shift rendering feedback)
    const handleKeyDown = (ev) => {
      if (ev.key === 'Control' || ev.key === 'Shift') {
        schedulerRef.current.markDirty('InteractiveLayer');
      }
    };
    const handleKeyUp = (ev) => {
      if (ev.key === 'Control' || ev.key === 'Shift') {
        schedulerRef.current.markDirty('InteractiveLayer');
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: true });
    window.addEventListener('keyup', handleKeyUp, { passive: true });

    // Call draw immediately
    schedulerRef.current.markAllDirty();
    if (onRenderCompleted) {
      setTimeout(onRenderCompleted, 100);
    }

    return () => {
      try {
        if (chart) {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleViewportChange);
        }
      } catch (e) {}
      observer.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [chart, series, chartContainer]);

  // Redraw when drawing states change
  useEffect(() => {
    scheduleDraw();
  }, [drawings, selectedDrawing, hideDrawings, showSessions, timeframe, showAlgoZones, algoCandidates, selectedAlgoCandidate, inlineTextInput, replayMode, replayIndex, narrativeMode, narrativeFocusRangeId, viewMode, analysisLayers, debugOverlayFilters]);

  // Deselect selected drawing if it becomes invisible on timeframe change
  useEffect(() => {
    if (selectedDrawing !== null && selectedDrawing !== undefined) {
      const shape = drawings[selectedDrawing];
      if (shape && !isDrawingVisible(shape, timeframe)) {
        setSelectedDrawing(null);
      }
    }
  }, [timeframe, drawings, selectedDrawing, setSelectedDrawing]);

  // Immediately set crosshair cursor when a drawing tool is activated (TV behavior)
  useEffect(() => {
    if (!chartContainer) return;
    if (activeTool) {
      chartContainer.style.cursor = 'crosshair';
    } else {
      chartContainer.style.cursor = 'default';
    }
  }, [activeTool, chartContainer]);


  // Sync native price lines for Horizontal Lines and Horizontal Rays
  useEffect(() => {
    if (!series) return;

    try {
      if (priceLineSeriesRef.current !== series) {
        priceLinesRef.current = {};
        priceLineSeriesRef.current = series;
      }

      const activeIds = new Set();

      const getReplayTimeLimit = () => {
        if (!replayModeRef.current || replayIndexRef.current <= 0) return Infinity;
        const currentBar = allBarsRef.current[replayIndexRef.current - 1];
        return currentBar ? currentBar.time : Infinity;
      };
      const limit = getReplayTimeLimit();

      if (!hideDrawings) {
        drawings.forEach((shape) => {
          // Skip future drawings in replay mode
          if (shape.points && shape.points.length > 0) {
            const firstPoint = shape.points[0];
            if (firstPoint && firstPoint.time > limit) return;
          }

          if (!isDrawingVisible(shape, timeframe)) return;

          if (shape.type === 'horizontal-line' || shape.type === 'ray') {
            const id = shape.id;
            if (!id) return;
            activeIds.add(id);

            const price = shape.points[0].price;
            const color = shape.color || '#2962ff';
            
            let lineStyle = 0; // Solid
            if (shape.lineStyle === 'dashed') lineStyle = 1;
            else if (shape.lineStyle === 'dotted') lineStyle = 2;

            const lineWidth = shape.type === 'horizontal-line' ? (shape.width || 2) : 0;

            const options = {
              price,
              color,
              lineWidth,
              lineStyle,
              axisLabelVisible: true,
              title: ''
            };

            let priceLine = priceLinesRef.current[id];
            if (!priceLine) {
              priceLine = series.createPriceLine(options);
              priceLinesRef.current[id] = priceLine;
            } else {
              priceLine.applyOptions(options);
            }
          }
        });
      }

      // Remove price lines that are no longer active
      Object.keys(priceLinesRef.current).forEach((id) => {
        if (!activeIds.has(id)) {
          const priceLine = priceLinesRef.current[id];
          try {
            series.removePriceLine(priceLine);
          } catch (e) {}
          delete priceLinesRef.current[id];
        }
      });
    } catch (e) {
      console.warn('[DrawingCanvas] Error during price line sync:', e);
    }

    return () => {
      try {
        if (series) {
          Object.keys(priceLinesRef.current).forEach((id) => {
            const priceLine = priceLinesRef.current[id];
            try {
              series.removePriceLine(priceLine);
            } catch (e) {}
          });
        }
      } catch (e) {}
      priceLinesRef.current = {};
    };
  }, [drawings, hideDrawings, series, replayMode, replayIndex, timeframe]);



  // Map drawing units to pixel coordinates
  const pointToCoords = (point) => {
    return projectionServiceRef.current.pointToCoords(point);
  };

  // Map pixel coordinates to time/price
  const coordsToPoint = (x, y) => {
    if (!chart || !series) {
      console.log("[coordsToPoint] No chart or series");
      return null;
    }
    const timeScale = chart.timeScale();
    const logical = timeScale.coordinateToLogical(x);
    if (logical === null) {
      console.log("[coordsToPoint] coordinateToLogical returned null for x:", x);
      return null;
    }

    let price = null;
    try {
      price = series.coordinateToPrice(y);
    } catch (e) {
      return null;
    }
    if (price === null) {
      console.log("[coordsToPoint] coordinateToPrice returned null for y:", y);
      return null;
    }

    const bars = allBarsRef.current;
    if (!bars || bars.length === 0) {
      console.log("[coordsToPoint] allBarsRef is empty or undefined");
      return null;
    }

    let time = null;
    const lastIdx = bars.length - 1;
    const lastBar = bars[lastIdx];

    if (logical <= lastIdx) {
      const idx = Math.max(0, Math.min(lastIdx, Math.round(logical)));
      time = bars[idx].time;
    } else {
      const barDuration = timeframeRef.current * 60;
      const diff = logical - lastIdx;
      time = lastBar.time + Math.round(diff) * barDuration;
    }

    const point = { time, price };
    return point;
  };

  // Snapping calculations (Magnet Mode)
  const getSnappedPoint = (x, y) => {
    if (!chart || !series) return null;
    const timeScale = chart.timeScale();
    const logical = timeScale.coordinateToLogical(x);
    if (logical === null) return null;

    const bars = allBarsRef.current;
    if (!bars || bars.length === 0) return null;

    const lastIdx = bars.length - 1;
    const idx = Math.max(0, Math.min(lastIdx, Math.round(logical)));
    const bar = bars[idx];

    // Convert OHLC prices to Y coordinates
    const yOpen = series.priceToCoordinate(bar.open);
    const yHigh = series.priceToCoordinate(bar.high);
    const yLow = series.priceToCoordinate(bar.low);
    const yClose = series.priceToCoordinate(bar.close);
    const xBar = timeScale.logicalToCoordinate(idx);

    if (xBar === null) return null;

    // Find the closest price point
    const points = [
      { price: bar.open, y: yOpen, label: 'O' },
      { price: bar.high, y: yHigh, label: 'H' },
      { price: bar.low, y: yLow, label: 'L' },
      { price: bar.close, y: yClose, label: 'C' }
    ];

    let closest = null;
    let minDist = Infinity;

    for (const pt of points) {
      const dist = Math.sqrt((x - xBar) ** 2 + (y - pt.y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }

    // Snap if mouse is within 24 pixels
    if (minDist < 24) {
      return {
        x: xBar,
        y: closest.y,
        time: bar.time,
        price: closest.price
      };
    }

    return null;
  };

  // Vector helpers for hit detection
  const getDistance = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  const getDistanceToSegment = (px, py, x1, y1, x2, y2) => {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return getDistance(px, py, x1, y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return getDistance(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
  };

  // Extends a line defined by p1->p2 to the canvas viewport edges.
  // Returns { x1, y1, x2, y2 } of the clipped line.
  // extendLeft: extend behind p1 to left edge. extendRight: extend past p2 to right edge.
  const extendLineToViewport = (p1, p2, extendLeft, extendRight, w, h) => {
    let { x: x1, y: y1 } = p1;
    let { x: x2, y: y2 } = p2;

    const dx = x2 - x1;
    const dy = y2 - y1;

    // Helper: find t param where line crosses a vertical/horizontal boundary
    const intersectX = (targetX) => (dx !== 0 ? (targetX - x1) / dx : null);
    const intersectY = (targetY) => (dy !== 0 ? (targetY - y1) / dy : null);

    const getYatX = (t) => y1 + t * dy;
    const getXatY = (t) => x1 + t * dx;

    // Find all candidate t values for each edge
    const candidates = [];
    const tLeft = intersectX(0);
    if (tLeft !== null) {
      const yAtLeft = getYatX(tLeft);
      if (yAtLeft >= 0 && yAtLeft <= h) candidates.push({ t: tLeft, x: 0, y: yAtLeft });
    }
    const tRight = intersectX(w);
    if (tRight !== null) {
      const yAtRight = getYatX(tRight);
      if (yAtRight >= 0 && yAtRight <= h) candidates.push({ t: tRight, x: w, y: yAtRight });
    }
    const tTop = intersectY(0);
    if (tTop !== null) {
      const xAtTop = getXatY(tTop);
      if (xAtTop >= 0 && xAtTop <= w) candidates.push({ t: tTop, x: xAtTop, y: 0 });
    }
    const tBottom = intersectY(h);
    if (tBottom !== null) {
      const xAtBottom = getXatY(tBottom);
      if (xAtBottom >= 0 && xAtBottom <= w) candidates.push({ t: tBottom, x: xAtBottom, y: h });
    }

    // Sort by t param
    candidates.sort((a, b) => a.t - b.t);

    let startPt = { x: x1, y: y1 };
    let endPt = { x: x2, y: y2 };

    if (extendLeft && candidates.length > 0) {
      // Use the leftmost (smallest t) intersection that is behind p1 (t < 0)
      const behind = candidates.filter(c => c.t < 0);
      if (behind.length > 0) {
        startPt = behind[behind.length - 1]; // largest t that is still < 0
      }
    }
    if (extendRight && candidates.length > 0) {
      // Use rightmost (largest t) intersection that is past p2 (t > 1)
      const ahead = candidates.filter(c => c.t > 1);
      if (ahead.length > 0) {
          endPt = ahead[0]; // smallest t that is > 1
      }
    }

    return { x1: startPt.x, y1: startPt.y, x2: endPt.x, y2: endPt.y };
  };

  // Compute angle in degrees of a line (p1 → p2) relative to horizontal
  const getLineDegrees = (x1, y1, x2, y2) => {
    const deg = Math.atan2(-(y2 - y1), x2 - x1) * (180 / Math.PI);
    return deg;
  };

  // Find all shapes whose body is hit by cursor, sorted topmost first
  const findAllHits = (x, y) => {
    if (lockDrawingsRef.current) return [];

    const hits = [];

    for (let sIdx = localDrawingsRef.current.length - 1; sIdx >= 0; sIdx--) {
      const shape = localDrawingsRef.current[sIdx];
      if (!shape.points || shape.points.length === 0) continue;
      if (!isDrawingVisible(shape, timeframeRef.current)) continue;

      if (shape.type === 'trendline') {
        const canvas = canvasRef.current;
        const w = canvas ? (canvas.clientWidth || canvas.width) : 2000;
        const h = canvas ? (canvas.clientHeight || canvas.height) : 1000;
        const hit = TrendLine.hitTest(x, y, shape, pointToCoords, w, h, false);
        if (hit && hit.type === 'body') {
          hits.push({ type: 'body', shapeIdx: sIdx });
        }
      } else {
        const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
        if (coords.length === 0) continue;

        if (shape.type === 'horizontal-line') {
          if (Math.abs(y - coords[0].y) < 6) hits.push({ type: 'body', shapeIdx: sIdx });
        } else if (shape.type === 'ray') {
          if (Math.abs(y - coords[0].y) < 6) hits.push({ type: 'body', shapeIdx: sIdx });
        } else if (shape.type === 'rectangle' && coords.length >= 2) {
          const canvas = canvasRef.current;
          const w = canvas ? (canvas.clientWidth || canvas.width) : 2000;
          let minX = Math.min(coords[0].x, coords[1].x);
          let maxX = Math.max(coords[0].x, coords[1].x);
          if (shape.extendLeft) minX = 0;
          if (shape.extendRight) maxX = w;
          const minY = Math.min(coords[0].y, coords[1].y);
          const maxY = Math.max(coords[0].y, coords[1].y);

          const onBorder =
            (Math.abs(x - minX) < 6 && y >= minY && y <= maxY) ||
            (Math.abs(x - maxX) < 6 && y >= minY && y <= maxY) ||
            (Math.abs(y - minY) < 6 && x >= minX && x <= maxX) ||
            (Math.abs(y - maxY) < 6 && x >= minX && x <= maxX);

          const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;

          if (onBorder || inside) hits.push({ type: 'body', shapeIdx: sIdx });
        } else if ((shape.type === 'position-long' || shape.type === 'position-short') && coords.length >= 3) {
          const c0 = coords[0];
          const c1 = coords[1];
          const c2 = coords[2];
          const minX = Math.min(c0.x, c1.x);
          const maxX = Math.max(c0.x, c1.x);
          const minY = Math.min(c0.y, c1.y, c2.y);
          const maxY = Math.max(c0.y, c1.y, c2.y);

          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            hits.push({ type: 'body', shapeIdx: sIdx });
          }
        } else if (shape.type === 'fibonacci' && coords.length >= 2) {
          const y1 = coords[0].y;
          const y2 = coords[1].y;
          const p1 = shape.points[0].price;
          const p2 = shape.points[1].price;
          const minX = Math.min(coords[0].x, coords[1].x);
          const maxX = Math.max(coords[0].x, coords[1].x);

          const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
          for (const r of ratios) {
            const price = p1 + r * (p2 - p1);
            const ly = series.priceToCoordinate(price);
            if (ly !== null && Math.abs(y - ly) < 6 && x >= minX && x <= maxX) {
              hits.push({ type: 'body', shapeIdx: sIdx });
              break;
            }
          }
        } else if (shape.type === 'text') {
          const textWidth = (shape.text || '').length * 7 + 16;
          const textHeight = 24;
          const tx = coords[0].x - textWidth / 2;
          const ty = coords[0].y - textHeight / 2;
          if (x >= tx && x <= tx + textWidth && y >= ty && y <= ty + textHeight) {
            hits.push({ type: 'body', shapeIdx: sIdx });
          }
        } else if (shape.type === 'brush') {
          for (let i = 0; i < coords.length - 1; i++) {
            const d = getDistanceToSegment(x, y, coords[i].x, coords[i].y, coords[i+1].x, coords[i+1].y);
            if (d < 8) {
              hits.push({ type: 'body', shapeIdx: sIdx });
              break;
            }
          }
        }
      }
    }

    return hits;
  };

  // Find shape or control point under cursor
  // NOTE: uses *Ref.current values throughout — this function is called from inside stale
  // event handler closures (useEffect deps=[chartContainer,chart,series]) so plain state
  // variables like selectedDrawing/lockDrawings would be stale. Refs are always live.
  const findHit = (x, y) => {
    if (lockDrawingsRef.current) return null;

    // 1. Check handles of selected drawing first
    const selIdx = selectedDrawingRef.current;
    if (selIdx !== null) {
      const shape = localDrawingsRef.current[selIdx];
      if (shape && shape.points && isDrawingVisible(shape, timeframeRef.current)) {
        if (shape.type === 'rectangle' && shape.points.length >= 2) {
          const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
          if (coords.length >= 2) {
            const x1 = coords[0].x, y1 = coords[0].y;
            const x2 = coords[1].x, y2 = coords[1].y;
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;

            const handles = [
              { x: minX, y: minY, idx: 0, desc: 'top-left' },
              { x: midX, y: minY, idx: 4, desc: 'top-middle' },
              { x: maxX, y: minY, idx: 1, desc: 'top-right' },
              { x: maxX, y: midY, idx: 5, desc: 'right-middle' },
              { x: maxX, y: maxY, idx: 2, desc: 'bottom-right' },
              { x: midX, y: maxY, idx: 6, desc: 'bottom-middle' },
              { x: minX, y: maxY, idx: 3, desc: 'bottom-left' },
              { x: minX, y: midY, idx: 7, desc: 'left-middle' }
            ];
            for (let i = 0; i < handles.length; i++) {
              if (getDistance(x, y, handles[i].x, handles[i].y) < 8) {
                return { type: 'handle', shapeIdx: selIdx, pointIdx: handles[i].idx, cornerDesc: handles[i].desc };
              }
            }
          }
        } else if ((shape.type === 'position-long' || shape.type === 'position-short') && shape.points.length >= 3) {
          const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
          if (coords.length >= 3) {
            const c0 = coords[0];
            const c1 = coords[1];
            const c2 = coords[2];
            const handles = [
              { x: c0.x, y: c0.y, idx: 0 },
              { x: (c0.x + c1.x) / 2, y: c1.y, idx: 1 },
              { x: (c0.x + c2.x) / 2, y: c2.y, idx: 2 },
              { x: c1.x, y: c0.y, idx: 3 }
            ];
            for (let i = 0; i < handles.length; i++) {
              if (getDistance(x, y, handles[i].x, handles[i].y) < 8) {
                return { type: 'handle', shapeIdx: selIdx, pointIdx: handles[i].idx };
              }
            }
          }
        } else if (shape.type === 'trendline') {
          const canvas = canvasRef.current;
          const w = canvas ? (canvas.clientWidth || canvas.width) : 2000;
          const h = canvas ? (canvas.clientHeight || canvas.height) : 1000;
          const hit = TrendLine.hitTest(x, y, shape, pointToCoords, w, h, true);
          if (hit && hit.type === 'handle') {
            return { type: 'handle', shapeIdx: selIdx, pointIdx: hit.pointIdx };
          }
        } else if (shape.type === 'ray') {
          // Anchor handle clamped to visible canvas — always reachable even if anchor is scrolled off-screen left
          const c = pointToCoords(shape.points[0]);
          if (c) {
            const hx = Math.max(4, c.x);
            if (getDistance(x, y, hx, c.y) < 8) {
              return { type: 'handle', shapeIdx: selIdx, pointIdx: 0 };
            }
          }
        } else {
          for (let i = 0; i < shape.points.length; i++) {
            const coords = pointToCoords(shape.points[i]);
            if (coords && getDistance(x, y, coords.x, coords.y) < 8) {
              return { type: 'handle', shapeIdx: selIdx, pointIdx: i };
            }
          }
        }
      }
    }

    // 2. Check shapes body hit
    const hits = findAllHits(x, y);
    if (hits.length > 0) {
      if (selIdx !== null) {
        const currentHitIndex = hits.findIndex(h => h.shapeIdx === selIdx);
        if (currentHitIndex !== -1) {
          return hits[currentHitIndex];
        }
      }
      return hits[0];
    }

  // Check hit on algo candidates if overlay is enabled
    if (showAlgoZonesRef.current && algoCandidatesRef.current) {
      const candidates = algoCandidatesRef.current;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const t0 = cand.timeStart || (cand.time - timeframeRef.current * 60);
        const t1 = cand.timeEnd || (cand.time + timeframeRef.current * 60);
        const coords0 = pointToCoords({ time: t0, price: cand.priceHigh });
        const coords1 = pointToCoords({ time: t1, price: cand.priceLow });
        if (coords0 && coords1) {
          const rx0 = Math.min(coords0.x, coords1.x);
          const rx1 = Math.max(coords0.x, coords1.x);
          const ry0 = Math.min(coords0.y, coords1.y);
          const ry1 = Math.max(coords0.y, coords1.y);
          
          if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) {
            return { type: 'algoCandidate', candidate: cand, index: i };
          }
        }
      }
    }

    return null;
  };

  const findTextHit = (x, y) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    for (let sIdx = localDrawingsRef.current.length - 1; sIdx >= 0; sIdx--) {
      const shape = localDrawingsRef.current[sIdx];
      if (!isDrawingVisible(shape, timeframeRef.current)) continue;

      if (shape.type === 'rectangle' && shape.points && shape.points.length >= 2) {
        const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
        if (coords.length >= 2) {
          const canvasWidth = canvas.clientWidth || canvas.width;
          let leftX = Math.min(coords[0].x, coords[1].x);
          let rightX = Math.max(coords[0].x, coords[1].x);
          if (shape.extendLeft) leftX = 0;
          if (shape.extendRight) rightX = canvasWidth;

          const rx0 = Math.round(leftX);
          const ry0 = Math.round(Math.min(coords[0].y, coords[1].y));
          const rx1 = Math.round(rightX);
          const ry1 = Math.round(Math.max(coords[0].y, coords[1].y));
          const rh = ry1 - ry0;
          const rw = rx1 - rx0;

          const isSelected = selectedDrawingRef.current === sIdx;
          const hit = findHit(x, y);
          const isHovered = hit && hit.shapeIdx === sIdx;

          const hasText = shape.text && shape.text.trim() !== '';
          if (hasText || isSelected || isHovered) {
            const textString = hasText ? shape.text : '+ Add text';
            ctx.save();
            let fontStyle = '';
            if (shape.italic) fontStyle += 'italic ';
            if (shape.bold) fontStyle += '600 ';
            const fontSize = shape.fontSize || 12;
            ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;
            const textW = ctx.measureText(textString).width;
            ctx.restore();

            const padding = 8;
            const textHalign = shape.textHalign || 'right';
            const width = Math.max(textW + 20, 120);

            let textStartX;
            let inputX;
            if (textHalign === 'left') {
              textStartX = rx0 + padding;
              inputX = rx0 + padding;
            } else if (textHalign === 'center') {
              textStartX = rx0 + rw / 2 - textW / 2;
              inputX = rx0 + rw / 2 - width / 2;
            } else {
              textStartX = rx1 - padding - textW;
              inputX = rx1 - padding - width;
            }

            const textValign = shape.textValign || 'middle';
            let textMinY;
            if (textValign === 'top') {
              textMinY = ry0 + 6;
            } else if (textValign === 'bottom') {
              textMinY = ry1 - 6 - fontSize;
            } else {
              textMinY = ry0 + rh / 2 - fontSize / 2;
            }

            if (x >= textStartX && x <= textStartX + textW && y >= textMinY && y <= textMinY + fontSize) {
              return {
                shapeIdx: sIdx,
                x: inputX,
                y: textMinY - 2,
                width: width,
                height: fontSize + 4,
                fontSize,
                italic: shape.italic,
                bold: shape.bold,
                color: shape.textColor || '#ffffff',
                value: hasText ? shape.text : '',
                originalText: shape.text || '',
                textAlign: textHalign,
                rx0,
                rx1,
                rw,
                padding
              };
            }
          }
        }
      }

      if (shape.type === 'trendline' && shape.points && shape.points.length >= 2) {
        const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
        if (coords.length >= 2) {
          const midX = (coords[0].x + coords[1].x) / 2;
          const midY = (coords[0].y + coords[1].y) / 2;

          const isSelected = selectedDrawingRef.current === sIdx;
          const hit = findHit(x, y);
          const isHovered = hit && hit.shapeIdx === sIdx;

          const hasText = shape.text && shape.text.trim() !== '';
          if (hasText || isSelected || isHovered) {
            const textString = hasText ? shape.text : '+ Add text';
            ctx.save();
            let fontStyle = '';
            if (shape.italic) fontStyle += 'italic ';
            if (shape.bold) fontStyle += '600 ';
            const fontSize = shape.fontSize || 12;
            ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;
            const textW = ctx.measureText(textString).width;
            ctx.restore();

            const textHalign = shape.textHalign || 'center';
            const textValign = shape.textValign || 'top';

            const pLeft = coords[0].x <= coords[1].x ? coords[0] : coords[1];
            const pRight = coords[0].x <= coords[1].x ? coords[1] : coords[0];

            // Calculate line angle from left to right (always in [-pi/2, pi/2] range)
            const angle = Math.atan2(pRight.y - pLeft.y, pRight.x - pLeft.x);

            let basePoint;
            if (textHalign === 'left') {
              basePoint = pLeft;
            } else if (textHalign === 'right') {
              basePoint = pRight;
            } else {
              basePoint = { x: midX, y: midY };
            }

            // Transform cursor coordinate to the rotated space
            const dx = x - basePoint.x;
            const dy = y - basePoint.y;
            const rx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
            const ry = dx * Math.sin(-angle) + dy * Math.cos(-angle);

            let xOffset, textAlign;
            if (textHalign === 'left') {
              xOffset = 8;
              textAlign = 'left';
            } else if (textHalign === 'right') {
              xOffset = -8;
              textAlign = 'right';
            } else { // center
              xOffset = 0;
              textAlign = 'center';
            }

            let textBaseline, verticalOffset;
            if (textValign === 'top') {
              verticalOffset = -8;
              textBaseline = 'bottom';
            } else if (textValign === 'bottom') {
              verticalOffset = 8;
              textBaseline = 'top';
            } else { // middle
              verticalOffset = 0;
              textBaseline = 'middle';
            }

            // In rotated coordinates:
            const textStartX = textAlign === 'left' ? xOffset : (textAlign === 'right' ? xOffset - textW : xOffset - textW / 2);
            const textMinY = textBaseline === 'bottom' ? verticalOffset - fontSize : (textBaseline === 'top' ? verticalOffset : verticalOffset - fontSize / 2);
            const width = Math.max(textW + 20, 120);

            if (rx >= textStartX && rx <= textStartX + textW && ry >= textMinY && ry <= textMinY + fontSize) {
              const centerY_rotated = textMinY + fontSize / 2;
              
              let inputX, inputY;
              if (textAlign === 'left') {
                const leftEdgeX_rotated = textStartX;
                const leftEdgeX_screen = basePoint.x + leftEdgeX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const leftEdgeY_screen = basePoint.y + leftEdgeX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                inputX = leftEdgeX_screen;
                inputY = leftEdgeY_screen - (fontSize + 4) / 2;
              } else if (textAlign === 'right') {
                const rightEdgeX_rotated = textStartX + textW;
                const rightEdgeX_screen = basePoint.x + rightEdgeX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const rightEdgeY_screen = basePoint.y + rightEdgeX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                inputX = rightEdgeX_screen - width;
                inputY = rightEdgeY_screen - (fontSize + 4) / 2;
              } else {
                const centerX_rotated = textStartX + textW / 2;
                const centerX_screen = basePoint.x + centerX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const centerY_screen = basePoint.y + centerX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                inputX = centerX_screen - width / 2;
                inputY = centerY_screen - (fontSize + 4) / 2;
              }

              return {
                shapeIdx: sIdx,
                isTrendLine: true,
                basePoint,
                xOffset,
                verticalOffset,
                angle,
                fontSize,
                italic: shape.italic,
                bold: shape.bold,
                color: shape.textColor || '#ffffff',
                value: hasText ? shape.text : '',
                originalText: shape.text || '',
                textAlign: textAlign,
                textValign: textValign,
                textHalign: textHalign,
                x: inputX,
                y: inputY,
                width: width,
                height: fontSize + 4,
                rx0: inputX,
                rx1: inputX + width,
                rw: width,
                padding: 10
              };
            }
          }
        }
      }
    }
    return null;
  };

  // Helper to query dimensions of the chart pane, price scale and time scale from the DOM
  const getChartDimensions = () => {
    const canvas = canvasRef.current;
    if (!canvas || !chartContainer) return { paneWidth: 0, paneHeight: 0, priceScaleWidth: 0, timeScaleHeight: 0 };

    const width = chartContainer.clientWidth;
    const height = chartContainer.clientHeight;

    const canvases = chartContainer.querySelectorAll('canvas');
    let priceScaleWidth = 62; // fallback default
    let timeScaleHeight = 26; // fallback default

    canvases.forEach(c => {
      const cWidth = c.clientWidth;
      const cHeight = c.clientHeight;
      if (cWidth > 0 && cHeight > 0) {
        if (cWidth < 100 && cHeight > 100) {
          priceScaleWidth = cWidth;
        } else if (cWidth > 100 && cHeight < 50) {
          timeScaleHeight = cHeight;
        }
      }
    });

    const paneWidth = width - priceScaleWidth;
    const paneHeight = height - timeScaleHeight;

    return { paneWidth, paneHeight, priceScaleWidth, timeScaleHeight };
  };

  // --- MOUSE PROCESSORS (CALLED BY CAPTURE-PHASE LISTENERS) ---

  const processMouseDown = (e, x, y, hit) => {
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };

    const isMagnetActive = magnetModeRef.current || e.ctrlKey;
    let targetPoint = (isMagnetActive && snappedPosRef.current) ? snappedPosRef.current : coordsToPoint(x, y);
    if (!targetPoint) return;

    const activeToolValue = activeToolRef.current;

    if (activeToolValue) {
      onAddUndoState();
      setSelectedDrawing(null);

      if (activeToolValue === 'position-long' || activeToolValue === 'position-short') {
        const startTime = targetPoint.time;
        const entryPrice = targetPoint.price;
        let defaultOffset = entryPrice * 0.01;
        if (series && chartContainer) {
          const pTop = series.coordinateToPrice(0);
          const pBottom = series.coordinateToPrice(chartContainer.clientHeight);
          if (pTop !== null && pBottom !== null) {
            defaultOffset = Math.abs(pTop - pBottom) * 0.1;
          }
        }
        const tpPrice = activeToolValue === 'position-long' ? (entryPrice + defaultOffset) : (entryPrice - defaultOffset);
        const slPrice = activeToolValue === 'position-long' ? (entryPrice - defaultOffset / 2) : (entryPrice + defaultOffset / 2);
        const durationSeconds = 20 * timeframeRef.current * 60;
        const endTime = startTime + durationSeconds;

        const newShape = {
          id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
          type: activeToolValue,
          points: [
            { time: startTime, price: entryPrice },
            { time: endTime, price: tpPrice },
            { time: endTime, price: slPrice }
          ],
          color: activeToolValue === 'position-long' ? '#089981' : '#f23645',
          width: 1.5,
          opacity: 1.0,
          lineStyle: 'solid'
        };
        setDrawings([...localDrawingsRef.current, newShape]);
        setSelectedDrawing(localDrawingsRef.current.length);
        setActiveTool(null);
        return;
      }

      if (activeToolValue === 'ruler') {
        if (!isDrawingRef.current) {
          setIsDrawing(true);
          tempPointsRef.current = [targetPoint, targetPoint];
          scheduleDraw();
        } else {
          setIsDrawing(false);
          tempPointsRef.current = [];
          setActiveTool(null);
          scheduleDraw();
        }
        return;
      }

      if (activeToolValue === 'trendline' || activeToolValue === 'rectangle' || activeToolValue === 'fibonacci') {
        if (!isDrawingRef.current) {
          setIsDrawing(true);
          tempPointsRef.current = [targetPoint, targetPoint];
          scheduleDraw();
        } else {
          const startPt = tempPointsRef.current[0] || targetPoint;
          
          let finalTargetPoint = targetPoint;
          if (e.shiftKey && tempPointsRef.current.length > 0) {
            if (activeToolValue === 'trendline') {
              finalTargetPoint = { ...finalTargetPoint, price: startPt.price };
            } else {
              const startCoords = pointToCoords(startPt);
              if (startCoords) {
                const dx = x - startCoords.x;
                const dy = y - startCoords.y;
                const angle = Math.atan2(dy, dx);
                const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
                const dist = Math.sqrt(dx * dx + dy * dy);
                const snappedX = startCoords.x + dist * Math.cos(snapAngle);
                const snappedY = startCoords.y + dist * Math.sin(snapAngle);
                const constrainedPt = coordsToPoint(snappedX, snappedY);
                if (constrainedPt) {
                  finalTargetPoint = constrainedPt;
                }
              }
            }
          }

          const defaults = defaultToolStyles?.[activeToolValue] || {};
          const isRect = activeToolValue === 'rectangle';
          const isTrend = activeToolValue === 'trendline';
          const newShape = {
            id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
            type: activeToolValue,
            points: [startPt, finalTargetPoint],
            // Core styles
            color: defaults.color || '#2962ff',
            width: defaults.width || 2,
            opacity: defaults.opacity !== undefined ? defaults.opacity : (isRect ? 0.15 : 1.0),
            lineStyle: defaults.lineStyle || 'solid',
            
            // Text defaults
            textColor: defaults.textColor || '#ffffff',
            textOpacity: defaults.textOpacity !== undefined ? defaults.textOpacity : 1.0,
            fontSize: defaults.fontSize || 12,
            bold: defaults.bold || false,
            italic: defaults.italic || false,
            textHalign: defaults.textHalign || (isRect ? 'right' : 'center'),
            textValign: defaults.textValign || (isRect ? 'middle' : 'top'),

            // Extensions / Angle
            extendLeft: defaults.extendLeft !== undefined ? defaults.extendLeft : false,
            extendRight: defaults.extendRight !== undefined ? defaults.extendRight : false,
            showAngle: defaults.showAngle !== undefined ? defaults.showAngle : false,
            showPriceLabel: defaults.showPriceLabel !== undefined ? defaults.showPriceLabel : (isTrend ? true : false),

            ...(isRect ? {
              showBackground: defaults.showBackground !== undefined ? defaults.showBackground : true,
              backgroundColor: defaults.backgroundColor || defaults.color || '#2962ff',
              backgroundOpacity: defaults.backgroundOpacity !== undefined ? defaults.backgroundOpacity : (defaults.opacity !== undefined ? defaults.opacity : 0.15),
              borderColor: defaults.borderColor || defaults.color || '#2962ff',
              borderOpacity: defaults.borderOpacity !== undefined ? defaults.borderOpacity : 1.0,
              borderWidth: defaults.borderWidth || defaults.width || 2,
              borderStyle: defaults.borderStyle || defaults.lineStyle || 'solid',
              
              // Middle line
              showMiddleLine: defaults.showMiddleLine !== undefined ? defaults.showMiddleLine : false,
              middleLineColor: defaults.middleLineColor || '#000000',
              middleLineOpacity: defaults.middleLineOpacity !== undefined ? defaults.middleLineOpacity : 1.0,
              middleLineWidth: defaults.middleLineWidth || 1,
              middleLineStyle: defaults.middleLineStyle || 'solid',

              // Trade Position configuration
              showAsTrade: defaults.showAsTrade !== undefined ? defaults.showAsTrade : false,
              tradeDirection: defaults.tradeDirection || 'long'
            } : {})
          };
          setDrawings([...localDrawingsRef.current, newShape]);
          setIsDrawing(false);
          tempPointsRef.current = [];
          setSelectedDrawing(localDrawingsRef.current.length);
          setActiveTool(null);
        }
      } else if (activeToolValue === 'horizontal-line' || activeToolValue === 'ray') {
        const defaults = defaultToolStyles?.[activeToolValue] || {};
        const newShape = {
          id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
          type: activeToolValue,
          points: [targetPoint],
          color: defaults.color || '#2962ff',
          width: defaults.width || 2,
          lineStyle: defaults.lineStyle || 'solid'
        };
        setDrawings([...localDrawingsRef.current, newShape]);
        setSelectedDrawing(localDrawingsRef.current.length);
        setActiveTool(null);
      } else if (activeToolValue === 'text') {
        const textStr = prompt("Enter text annotation:");
        if (textStr) {
          const defaults = defaultToolStyles?.text || {};
          const newShape = {
            id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
            type: 'text',
            points: [targetPoint],
            text: textStr,
            color: defaults.color || '#ffffff',
            fontSize: defaults.fontSize || 12
          };
          setDrawings([...localDrawingsRef.current, newShape]);
          setSelectedDrawing(localDrawingsRef.current.length);
        }
        setActiveTool(null);
      } else if (activeToolValue === 'brush') {
        setIsDrawing(true);
        tempPointsRef.current = [targetPoint];
        scheduleDraw();
      } else if (activeToolValue === 'eraser') {
        const shapeHit = findHit(x, y);
        if (shapeHit && shapeHit.shapeIdx !== undefined) {
          const copy = [...localDrawingsRef.current];
          copy.splice(shapeHit.shapeIdx, 1);
          setDrawings(copy);
          setSelectedDrawing(null);
        }
        setActiveTool(null);
      }
    } else {
      if (hit) {
        if (hit.type === 'algoCandidate') {
          setSelectedDrawing(null);
          if (onSelectAlgoCandidate) {
            onSelectAlgoCandidate(hit.candidate);
          }
          return;
        }

        onAddUndoState();
        
        if (selectedDrawingRef.current !== hit.shapeIdx) {
          setSelectedDrawing(hit.shapeIdx);
          if (!isToolbarPinned) {
            setFloatingToolbarPos({ x: e.clientX, y: Math.max(e.clientY - 60, 50) });
          }
        } else {
          // If already selected, cycle through overlapping shapes
          const hits = findAllHits(x, y);
          if (hits.length > 1) {
            const currentIdx = hits.findIndex(h => h.shapeIdx === hit.shapeIdx);
            if (currentIdx !== -1) {
              const nextHit = hits[(currentIdx + 1) % hits.length];
              setSelectedDrawing(nextHit.shapeIdx);
              if (!isToolbarPinned) {
                setFloatingToolbarPos({ x: e.clientX, y: Math.max(e.clientY - 60, 50) });
              }
              // If dragging, redirect drag state to the newly selected shape
              if (dragStateRef.current && dragStateRef.current.type === 'body') {
                const nextShape = localDrawingsRef.current[nextHit.shapeIdx];
                dragStateRef.current = {
                  type: 'body',
                  index: nextHit.shapeIdx,
                  startPoints: JSON.parse(JSON.stringify(nextShape.points)),
                  startCoords: { x, y }
                };
              }
            }
          }
        }

        if (hit.type === 'handle') {
          const shape = localDrawingsRef.current[hit.shapeIdx];

          // Trendline midpoint handle → translate both points (TV behavior: drag middle = move whole line)
          if (shape && shape.type === 'trendline' && hit.pointIdx === 'mid') {
            dragStateRef.current = {
              type: 'body',
              index: hit.shapeIdx,
              startPoints: JSON.parse(JSON.stringify(shape.points)),
              startCoords: { x, y }
            };
          } else {
            let rectangleBounds = {};
            if (shape && shape.type === 'rectangle' && shape.points.length >= 2) {
              const pts = shape.points;
              const leftIdx = pts[0].time <= pts[1].time ? 0 : 1;
              const rightIdx = leftIdx === 0 ? 1 : 0;
              const topIdx = pts[0].price >= pts[1].price ? 0 : 1;
              const bottomIdx = topIdx === 0 ? 1 : 0;
              rectangleBounds = { leftIdx, rightIdx, topIdx, bottomIdx };
            }

            dragStateRef.current = {
              type: 'handle',
              index: hit.shapeIdx,
              pointIdx: hit.pointIdx,
              cornerDesc: hit.cornerDesc,
              ...rectangleBounds
            };
          }
        } else {
          const shape = localDrawingsRef.current[hit.shapeIdx];
          dragStateRef.current = {
            type: 'body',
            index: hit.shapeIdx,
            startPoints: JSON.parse(JSON.stringify(shape.points)),
            startCoords: { x, y }
          };
        }
      } else {
        setSelectedDrawing(null);
      }
    }
  };

  const processMouseMove = (e, x, y) => {
    let needsDraw = false;
    const activeToolValue = activeToolRef.current;

    // Snapping logic (magnet mode triggers on setting OR holding Ctrl key)
    let newSnapped = null;
    const isMagnetActive = magnetModeRef.current || e.ctrlKey;
    if (isMagnetActive && (activeToolValue || dragStateRef.current)) {
      newSnapped = getSnappedPoint(x, y);
    }
    
    if (newSnapped !== snappedPosRef.current) {
      snappedPosRef.current = newSnapped;
      needsDraw = true;
    }

    let targetPoint = snappedPosRef.current ? snappedPosRef.current : coordsToPoint(x, y);

    // Apply Shift key straight horizontal/vertical/45-degree angle lock for drawings
    if (e.shiftKey && tempPointsRef.current.length > 0 && activeToolValue !== 'brush' && activeToolValue !== 'eraser' && activeToolValue !== 'text') {
      if (activeToolValue === 'trendline') {
        const startPt = tempPointsRef.current[0];
        targetPoint = { ...targetPoint, price: startPt.price };
      } else {
        const startPt = tempPointsRef.current[0];
        const startCoords = pointToCoords(startPt);
        if (startCoords) {
          const dx = x - startCoords.x;
          const dy = y - startCoords.y;
          const angle = Math.atan2(dy, dx);
          const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const snappedX = startCoords.x + dist * Math.cos(snapAngle);
          const snappedY = startCoords.y + dist * Math.sin(snapAngle);
          const constrainedPt = coordsToPoint(snappedX, snappedY);
          if (constrainedPt) {
            targetPoint = constrainedPt;
          }
        }
      }
    }

    if (isDrawingRef.current && activeToolValue && targetPoint) {
      if (activeToolValue === 'brush') {
        tempPointsRef.current = [...tempPointsRef.current, targetPoint];
        needsDraw = true;
      } else if (tempPointsRef.current.length > 0) {
        tempPointsRef.current = [tempPointsRef.current[0], targetPoint];
        needsDraw = true;
      }
    }

    const dragState = dragStateRef.current;
    if (dragState && targetPoint) {
      const shapeIdx = dragState.index;
      if (dragState.type === 'handle') {
        const copy = [...localDrawingsRef.current];
        const shape = copy[shapeIdx];
        
        let constrainedTargetPoint = targetPoint;
        if (e.shiftKey && shape.type === 'trendline') {
          const anchorIdx = dragState.pointIdx === 0 ? 1 : 0;
          const anchorPt = shape.points[anchorIdx];
          constrainedTargetPoint = {
            ...constrainedTargetPoint,
            price: anchorPt.price
          };
        }

        if ((shape.type === 'position-long' || shape.type === 'position-short') && dragState.pointIdx !== undefined) {
          const ptIdx = dragState.pointIdx;
          if (ptIdx === 0) {
            const deltaPrice = constrainedTargetPoint.price - shape.points[0].price;
            const deltaTime = constrainedTargetPoint.time - shape.points[0].time;
            shape.points[0].price = constrainedTargetPoint.price;
            shape.points[0].time = constrainedTargetPoint.time;
            shape.points[1].price += deltaPrice;
            shape.points[1].time += deltaTime;
            shape.points[2].price += deltaPrice;
            shape.points[2].time += deltaTime;
          } else if (ptIdx === 1) {
            shape.points[1].price = constrainedTargetPoint.price;
          } else if (ptIdx === 2) {
            shape.points[2].price = constrainedTargetPoint.price;
          } else if (ptIdx === 3) {
            shape.points[1].time = constrainedTargetPoint.time;
            shape.points[2].time = constrainedTargetPoint.time;
          }
        } else if (shape.type === 'rectangle' && dragState.cornerDesc) {
          const desc = dragState.cornerDesc;
          const leftIdx = dragState.leftIdx !== undefined ? dragState.leftIdx : (shape.points[0].time <= shape.points[1].time ? 0 : 1);
          const rightIdx = dragState.rightIdx !== undefined ? dragState.rightIdx : (leftIdx === 0 ? 1 : 0);
          const topIdx = dragState.topIdx !== undefined ? dragState.topIdx : (shape.points[0].price >= shape.points[1].price ? 0 : 1);
          const bottomIdx = dragState.bottomIdx !== undefined ? dragState.bottomIdx : (topIdx === 0 ? 1 : 0);

          if (desc === 'top-left') {
            shape.points[leftIdx].time = constrainedTargetPoint.time;
            shape.points[topIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'top-right') {
            shape.points[rightIdx].time = constrainedTargetPoint.time;
            shape.points[topIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'bottom-left') {
            shape.points[leftIdx].time = constrainedTargetPoint.time;
            shape.points[bottomIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'bottom-right') {
            shape.points[rightIdx].time = constrainedTargetPoint.time;
            shape.points[bottomIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'top-middle') {
            shape.points[topIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'bottom-middle') {
            shape.points[bottomIdx].price = constrainedTargetPoint.price;
          } else if (desc === 'left-middle') {
            shape.points[leftIdx].time = constrainedTargetPoint.time;
          } else if (desc === 'right-middle') {
            shape.points[rightIdx].time = constrainedTargetPoint.time;
          }
        } else {
          copy[shapeIdx].points[dragState.pointIdx] = constrainedTargetPoint;
        }
        localDrawingsRef.current = copy;
        needsDraw = true;
      } else if (dragState.type === 'body') {
        const dxCoord = x - dragState.startCoords.x;
        const dyCoord = y - dragState.startCoords.y;

        const copy = [...localDrawingsRef.current];
        const newPoints = dragState.startPoints.map(origPt => {
          const ptCoord = pointToCoords(origPt);
          if (!ptCoord) return origPt;
          const movedPt = coordsToPoint(ptCoord.x + dxCoord, ptCoord.y + dyCoord);
          return movedPt ? movedPt : origPt;
        });

        copy[shapeIdx].points = newPoints;
        localDrawingsRef.current = copy;
        needsDraw = true;
      }
    }

    if (needsDraw) {
      scheduleDraw();
    }
  };

  const processMouseUp = (e, x, y) => {
    const wasDragging = !!dragStateRef.current;
    const activeToolValue = activeToolRef.current;

    if (isDrawingRef.current && activeToolValue) {
      const startPos = dragStartPosRef.current;
      const dragDistance = startPos
        ? Math.sqrt((e.clientX - startPos.x) ** 2 + (e.clientY - startPos.y) ** 2)
        : 0;

      if (dragDistance > 5) {
        const isMagnetActive = magnetModeRef.current || e.ctrlKey;
        let targetPoint = (isMagnetActive && snappedPosRef.current) ? snappedPosRef.current : coordsToPoint(x, y);

        if (e.shiftKey && tempPointsRef.current.length > 0 && activeToolValue !== 'brush' && activeToolValue !== 'eraser' && activeToolValue !== 'text') {
          if (activeToolValue === 'trendline') {
            const startPt = tempPointsRef.current[0];
            targetPoint = { ...targetPoint, price: startPt.price };
          } else {
            const startPt = tempPointsRef.current[0];
            const startCoords = pointToCoords(startPt);
            if (startCoords) {
              const dx = x - startCoords.x;
              const dy = y - startCoords.y;
              const angle = Math.atan2(dy, dx);
              const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
              const dist = Math.sqrt(dx * dx + dy * dy);
              const snappedX = startCoords.x + dist * Math.cos(snapAngle);
              const snappedY = startCoords.y + dist * Math.sin(snapAngle);
              const constrainedPt = coordsToPoint(snappedX, snappedY);
              if (constrainedPt) {
                targetPoint = constrainedPt;
              }
            }
          }
        }

        if (targetPoint) {
          if (activeToolValue === 'trendline' || activeToolValue === 'rectangle' || activeToolValue === 'fibonacci') {
            const startPt = tempPointsRef.current[0] || targetPoint;
            const defaults = defaultToolStyles?.[activeToolValue] || {};
            const isRect = activeToolValue === 'rectangle';
            const isTrend = activeToolValue === 'trendline';
            const newShape = {
              id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
              type: activeToolValue,
              points: [startPt, targetPoint],
              // Core styles
              color: defaults.color || '#2962ff',
              width: defaults.width || 2,
              opacity: defaults.opacity !== undefined ? defaults.opacity : (isRect ? 0.15 : 1.0),
              lineStyle: defaults.lineStyle || 'solid',
              
              // Text defaults
              textColor: defaults.textColor || '#ffffff',
              textOpacity: defaults.textOpacity !== undefined ? defaults.textOpacity : 1.0,
              fontSize: defaults.fontSize || 12,
              bold: defaults.bold || false,
              italic: defaults.italic || false,
              textHalign: defaults.textHalign || (isRect ? 'right' : 'center'),
              textValign: defaults.textValign || (isRect ? 'middle' : 'top'),

              // Extensions / Angle
              extendLeft: defaults.extendLeft !== undefined ? defaults.extendLeft : false,
              extendRight: defaults.extendRight !== undefined ? defaults.extendRight : false,
              showAngle: defaults.showAngle !== undefined ? defaults.showAngle : false,
              showPriceLabel: defaults.showPriceLabel !== undefined ? defaults.showPriceLabel : (isTrend ? true : false),

              ...(isRect ? {
                showBackground: defaults.showBackground !== undefined ? defaults.showBackground : true,
                backgroundColor: defaults.backgroundColor || defaults.color || '#2962ff',
                backgroundOpacity: defaults.backgroundOpacity !== undefined ? defaults.backgroundOpacity : (defaults.opacity !== undefined ? defaults.opacity : 0.15),
                borderColor: defaults.borderColor || defaults.color || '#2962ff',
                borderOpacity: defaults.borderOpacity !== undefined ? defaults.borderOpacity : 1.0,
                borderWidth: defaults.borderWidth || defaults.width || 2,
                borderStyle: defaults.borderStyle || defaults.lineStyle || 'solid',
                
                // Middle line
                showMiddleLine: defaults.showMiddleLine !== undefined ? defaults.showMiddleLine : false,
                middleLineColor: defaults.middleLineColor || '#000000',
                middleLineOpacity: defaults.middleLineOpacity !== undefined ? defaults.middleLineOpacity : 1.0,
                middleLineWidth: defaults.middleLineWidth || 1,
                middleLineStyle: defaults.middleLineStyle || 'solid',

                // Trade Position configuration
                showAsTrade: defaults.showAsTrade !== undefined ? defaults.showAsTrade : false,
                tradeDirection: defaults.tradeDirection || 'long'
              } : {})
            };
            setDrawings([...localDrawingsRef.current, newShape]);
            setIsDrawing(false);
            tempPointsRef.current = [];
            setSelectedDrawing(localDrawingsRef.current.length);
            if (!isToolbarPinned) {
              setFloatingToolbarPos({ x: e.clientX, y: Math.max(e.clientY - 60, 50) });
            }
            setActiveTool(null);
          } else if (activeToolValue === 'ruler') {
            setIsDrawing(false);
            tempPointsRef.current = [];
            setActiveTool(null);
            scheduleDraw();
          }
        }
      }
    }

    if (isDrawingRef.current && activeToolValue === 'brush') {
      setIsDrawing(false);
      const defaults = defaultToolStyles?.brush || {};
      setDrawings([...localDrawingsRef.current, {
        id: 'draw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
        type: 'brush',
        points: tempPointsRef.current,
        color: defaults.color || '#2962ff',
        width: defaults.width || 2,
        lineStyle: 'solid'
      }]);
      tempPointsRef.current = [];
      setActiveTool(null);
    }

    if (wasDragging) {
      setDrawings([...localDrawingsRef.current]);
      dragStateRef.current = null;
    }
  };

  // --- CAPTURE-PHASE EVENT ATTACHMENT ---

  useEffect(() => {
    if (!chartContainer) return;

    const handleMouseDownCapture = (e) => {
      if (isTargetInOverlayOrModal(e.target)) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas || !chart || !series) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;


      const timeScale = chart.timeScale();
      const logical = timeScale.coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      const isInsidePane = logical !== null && price !== null;

      if (!isInsidePane) {
        return;
      }

      // Prioritize handles over text
      const hit = findHit(x, y);
      if (hit && hit.type === 'handle') {
        e.stopPropagation();
        e.preventDefault();
        processMouseDown(e, x, y, hit);
        return;
      }

      // Text hit comes next
      const textHit = findTextHit(x, y);
      if (textHit) {
        e.stopPropagation();
        e.preventDefault();
        setInlineTextInput(textHit);
        return;
      }

      const isDrawingOrToolActive = activeToolRef.current || hit;

      if (isDrawingOrToolActive) {
        e.stopPropagation();
        e.preventDefault();
        processMouseDown(e, x, y, hit);
      } else {
        // Deselect currently selected drawing when clicking empty space
        setSelectedDrawing(null);
        if (onSelectAlgoCandidate) {
          onSelectAlgoCandidate(null);
        }
      }
    };

    const handleMouseMoveCapture = (e) => {

      const isDrawingActive = isDrawingRef.current && activeToolRef.current;
      const isDraggingActive = !!dragStateRef.current;

      if (!isDrawingActive && !isDraggingActive && isTargetInOverlayOrModal(e.target)) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.pointerEvents = 'none';
        }
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas || !chart || !series) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      mousePosRef.current = { x, y };

      // Update magnet snapped position on hover or draw
      let newSnapped = null;
      const isMagnetActive = magnetModeRef.current || e.ctrlKey;
      if (isMagnetActive) {
        newSnapped = getSnappedPoint(x, y);
      }
      if (newSnapped !== snappedPosRef.current) {
        snappedPosRef.current = newSnapped;
      }

      const hasActiveTool = !!activeToolRef.current;

      if (isDrawingActive || isDraggingActive) {
        e.stopPropagation();
        e.preventDefault();

        if (canvas) {
          canvas.style.pointerEvents = 'auto';
          if (isDrawingActive) {
            canvas.style.cursor = 'crosshair';
          } else if (isDraggingActive) {
            const dragType = dragStateRef.current.type;
            const cornerDesc = dragStateRef.current.cornerDesc;
            const pIdx = dragStateRef.current.pointIdx;
            if (dragType === 'handle') {
              if (cornerDesc === 'top-left' || cornerDesc === 'bottom-right') {
                canvas.style.cursor = 'nwse-resize';
              } else if (cornerDesc === 'top-right' || cornerDesc === 'bottom-left') {
                canvas.style.cursor = 'nesw-resize';
              } else if (cornerDesc === 'top-middle' || cornerDesc === 'bottom-middle') {
                canvas.style.cursor = 'ns-resize';
              } else if (cornerDesc === 'left-middle' || cornerDesc === 'right-middle') {
                canvas.style.cursor = 'ew-resize';
              } else if (pIdx === 'mid') {
                canvas.style.cursor = 'move';
              } else {
                // Endpoint handle (trendline p1/p2, ray anchor) — custom expand icon
                canvas.style.cursor = ENDPOINT_CURSOR;
              }
            } else {
              canvas.style.cursor = 'move';
            }
          }
        }

        processMouseMove(e, x, y);
      } else {

        const hit = findHit(x, y);
        const textHit = findTextHit(x, y);
        if (hasActiveTool) {
          if (canvas) {
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'crosshair';
          }
          chartContainer.style.cursor = 'crosshair';
        } else if (hit && hit.type === 'handle') {
          let neededCursor = ENDPOINT_CURSOR;
          if (hit.cornerDesc === 'top-left' || hit.cornerDesc === 'bottom-right') {
            neededCursor = 'nwse-resize';
          } else if (hit.cornerDesc === 'top-right' || hit.cornerDesc === 'bottom-left') {
            neededCursor = 'nesw-resize';
          } else if (hit.cornerDesc === 'top-middle' || hit.cornerDesc === 'bottom-middle') {
            neededCursor = 'ns-resize';
          } else if (hit.cornerDesc === 'left-middle' || hit.cornerDesc === 'right-middle') {
            neededCursor = 'ew-resize';
          } else if (hit.pointIdx === 'mid') {
            neededCursor = 'move';
          }

          if (canvas) {
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = neededCursor;
          }
          chartContainer.style.cursor = neededCursor;
        } else if (textHit) {
          if (canvas) {
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'text';
          }
          chartContainer.style.cursor = 'text';
        } else if (hit) {
          let neededCursor = 'default';
          if (hit.type === 'body') {
            neededCursor = 'move';
          }

          if (canvas) {
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = neededCursor;
          }
          chartContainer.style.cursor = neededCursor;
        } else {
          if (canvas) {
            canvas.style.pointerEvents = 'none';
            canvas.style.cursor = 'default';
          }
          chartContainer.style.cursor = 'default';
        }
        schedulerRef.current.markDirty('InteractiveLayer');
      }
    };

    const handleMouseUpCapture = (e) => {

      const isDrawingActive = isDrawingRef.current && activeToolRef.current;
      const isDraggingActive = !!dragStateRef.current;

      if (!isDrawingActive && !isDraggingActive && isTargetInOverlayOrModal(e.target)) {
        return;
      }

      if (isDrawingActive || isDraggingActive) {
        e.stopPropagation();
        e.preventDefault();

        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          processMouseUp(e, x, y);
        }
      }
    };

    const handleMouseLeave = () => {
      mousePosRef.current = null;
      snappedPosRef.current = null;
      chartContainer.style.cursor = 'default';
      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = 'none';
        canvasRef.current.style.cursor = 'default';
      }
      schedulerRef.current.markDirty('InteractiveLayer');
    };

    const handleDblClickCapture = (e) => {
      if (isTargetInOverlayOrModal(e.target)) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas || !chart || !series) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const hit = findHit(x, y);
      if (hit && hit.shapeIdx !== undefined) {
        e.stopPropagation();
        e.preventDefault();
        
        // Select the drawing and trigger settings opening
        setSelectedDrawing(hit.shapeIdx);
        if (onOpenSettingsRef.current) {
          onOpenSettingsRef.current();
        }
      }
    };

    chartContainer.addEventListener('mousedown', handleMouseDownCapture, true);
    chartContainer.addEventListener('mousemove', handleMouseMoveCapture, true);
    chartContainer.addEventListener('mouseup', handleMouseUpCapture, true);
    chartContainer.addEventListener('dblclick', handleDblClickCapture, true);
    chartContainer.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      chartContainer.removeEventListener('mousedown', handleMouseDownCapture, true);
      chartContainer.removeEventListener('mousemove', handleMouseMoveCapture, true);
      chartContainer.removeEventListener('mouseup', handleMouseUpCapture, true);
      chartContainer.removeEventListener('dblclick', handleDblClickCapture, true);
      chartContainer.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [chartContainer, chart, series]);

  // --- VERTICAL PRICE SCALE RENDER MONITOR LOOP ---

  useEffect(() => {
    if (!chart || !series || !chartContainer) return;

    let lastTopPrice = null;
    let lastBottomPrice = null;
    let animationFrameId;

    const checkPriceScale = () => {
      if (series) {
        try {
          const topPrice = series.coordinateToPrice(0);
          const bottomPrice = series.coordinateToPrice(chartContainer.clientHeight);
          if (topPrice !== lastTopPrice || bottomPrice !== lastBottomPrice) {
            lastTopPrice = topPrice;
            lastBottomPrice = bottomPrice;
            scheduleDraw();
          }
        } catch (e) {
          // Series might be disposed, ignore
        }
      }
      animationFrameId = requestAnimationFrame(checkPriceScale);
    };

    animationFrameId = requestAnimationFrame(checkPriceScale);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [chart, series, chartContainer]);

  // --- CANVAS RENDERING (2D DRAW) ---

  const drawSessionShading = (ctx) => {
    if (!showSessionsRef.current || !chart || !series || !chartContainer) return;
    const timeScale = chart.timeScale();
    const bars = allBarsRef.current;
    if (!bars || bars.length === 0) return;

    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;

    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(bars.length - 1, Math.ceil(range.to));
    const barSpacing = timeScale.options().barSpacing;
    const height = chartContainer.clientHeight;

    // Draw session columns
    for (let i = from; i <= to; i++) {
      const bar = bars[i];
      if (!bar.estSession) continue;

      const coords = pointToCoords(bar);
      if (!coords) continue;

      let color = 'rgba(255,255,255,0)';
      if (bar.estSession === 'london') color = 'rgba(41, 98, 255, 0.06)';
      else if (bar.estSession === 'ny-am') color = 'rgba(19, 23, 34, 0.02)';
      else if (bar.estSession === 'ny-pm') color = 'rgba(170, 0, 255, 0.03)';

      ctx.fillStyle = color;
      ctx.fillRect(coords.x - barSpacing / 2, 0, barSpacing + 0.5, height);
    }

    // Draw vertical session lines & texts
    for (let i = from; i <= to; i++) {
      const bar = bars[i];
      if (!bar.isMidnightOpen && !bar.isNewsOpen) continue;

      const coords = pointToCoords(bar);
      if (!coords) continue;

      ctx.save();
      ctx.strokeStyle = bar.isMidnightOpen ? 'rgba(130, 0, 200, 0.5)' : 'rgba(200, 100, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(coords.x, 0);
      ctx.lineTo(coords.x, height);
      ctx.stroke();

      // Draw label text
      ctx.restore();
      ctx.fillStyle = bar.isMidnightOpen ? '#8200c8' : '#c86400';
      ctx.font = '500 9px Outfit';
      ctx.fillText(bar.isMidnightOpen ? 'Midnight Open' : '8:30 Open', coords.x + 5, height - 40);
    }
  };

  const updateReplayTerminations = () => {
    const bars = allBarsRef.current || [];
    const isReplay = replayModeRef.current;
    const currentReplayIndex = isReplay ? (replayIndexRef.current || 0) : bars.length;
    const state = liquidityStatesRef.current;

    if (isReplay) {
      const candidates = algoCandidatesRef.current || [];
      const needsReset =
        state.replayBars !== bars ||
        state.replayCandidates !== candidates ||
        currentReplayIndex < (state.replayLastIndex || 0);

      if (needsReset) {
        state.replayBars = bars;
        state.replayCandidates = candidates;
        state.replayLastIndex = 0;
        state.replayTerminated = new Map();
        state.replayActive = new Set();
        state.replayByTime = new Map();
        
        candidates.forEach(cand => {
          if (cand.type !== 'liquidity' && cand.type !== 'liquidity_object') return;
          const t0 = state.t0Cache.get(cand.id);
          if (t0 == null) return;
          if (!state.replayByTime.has(t0)) state.replayByTime.set(t0, []);
          state.replayByTime.get(t0).push(cand);
        });
      }

      const fromIdx = state.replayLastIndex || 0;
      const toIdx = Math.min(currentReplayIndex, bars.length);
      if (fromIdx < toIdx) {
        const cmap = state.candidatesMap || new Map();
        for (let i = fromIdx; i < toIdx; i++) {
          const bar = bars[i];
          if (!bar) continue;
          const list = state.replayByTime.get(bar.time);
          if (list) list.forEach(c => state.replayActive.add(c.id));
          if (state.replayActive.size > 0) {
            for (const id of state.replayActive) {
              const cand = cmap.get(id);
              if (!cand) { state.replayActive.delete(id); continue; }
              const price = cand.priceHigh !== undefined ? cand.priceHigh : (cand.levelPrice || cand.priceLow);
              const side = cand.properties?.liquiditySide;
              const isBuySide = side === 'buy_side' || cand.direction === 'bearish' || cand.concept_label?.toLowerCase() === 'bsl';
              if (isBuySide ? bar.high >= price : bar.low <= price) {
                state.replayTerminated.set(id, bar.time);
                state.replayActive.delete(id);
              }
            }
          }
        }
        state.replayLastIndex = toIdx;
      }
      state.terminatedTimes = state.replayTerminated;
    }
  };

  const lastNarrativeLimitRef = useRef(-1);
  const updateNarrativeContext = () => {
    const limit = getReplayTimeLimit();
    if (lastNarrativeLimitRef.current === limit && currentNarrativeContextRef.current !== null) {
      return;
    }
    lastNarrativeLimitRef.current = limit;
    currentNarrativeContextRef.current = getReplayNarrativeContext(algoCandidatesRef.current || [], limit);
  };

  updateReplayTerminationsRef.current = updateReplayTerminations;
  updateNarrativeContextRef.current = updateNarrativeContext;

  const getReplayTimeLimit = () => {
    if (!replayModeRef.current || replayIndexRef.current <= 0) return Infinity;
    const currentBar = allBarsRef.current[replayIndexRef.current - 1];
    return currentBar ? currentBar.time : Infinity;
  };

  const getVisibleTimeBounds = () => {
    const bars = allBarsRef.current;
    if (!bars || bars.length === 0 || !chart) return null;
    try {
      const timeScale = chart.timeScale();
      const visibleLogicalRange = timeScale.getVisibleLogicalRange();
      if (visibleLogicalRange) {
        const lastIdx = bars.length - 1;
        const fromIdx = Math.max(0, Math.min(lastIdx, Math.round(visibleLogicalRange.from) - 100));
        const toIdx = Math.max(0, Math.min(lastIdx, Math.round(visibleLogicalRange.to) + 100));
        return {
          minVisibleTime: bars[fromIdx].time,
          maxVisibleTime: bars[toIdx].time
        };
      }
    } catch (e) {}
    return null;
  };

  const checkIsFaded = (cand, limit) => {
    const isNarrativeActive = narrativeModeRef.current;
    if (!isNarrativeActive) return false;

    const context = currentNarrativeContextRef.current;
    if (!context) return false;

    const activeRangeId = context.properties?.activeRangeId;
    const focusRangeId = narrativeFocusRangeIdRef.current || activeRangeId;
    
    if (cand.id === focusRangeId || `${cand.id}_delivery_leg` === focusRangeId) return false;
    
    const focusRangeObj = algoCandidatesMapRef.current.get(focusRangeId) ||
                          algoCandidatesRef.current.find(c => c.id === focusRangeId);
    if (focusRangeObj) {
      const nestedRangeIds = focusRangeObj.properties?.nestedRanges || [];
      if (nestedRangeIds.includes(cand.id)) return false;
      
      const activePdArrayIds = focusRangeObj.properties?.activePdArrays || [];
      if (activePdArrayIds.includes(cand.id)) return false;
      
      const anchorLiqId = focusRangeObj.properties?.deliveryState?.anchor_liquidity_id;
      const targetLiqId = focusRangeObj.properties?.deliveryState?.target_liquidity_id;
      if (cand.id === anchorLiqId || cand.id === targetLiqId) return false;
    }

    return true;
  };

  const renderGridLayer = (ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    drawSessionShading(ctx);
    ctx.restore();
  };

  const renderMarketObjectsLayer = (layerName, ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!showAlgoZonesRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    const limit = getReplayTimeLimit();
    const bounds = getVisibleTimeBounds();
    if (bounds) {
      const visibleObjects = renderIndexRef.current.getVisible(
        bounds.minVisibleTime,
        bounds.maxVisibleTime,
        limit,
        liquidityStatesRef.current.terminatedTimes
      );

      const swingsFlag = FeatureFlags.get('primitive_manager.swings');

      // Read toolbar toggle states
      const showDealingRanges = debugOverlayFiltersRef.current?.dealingRanges !== false;
      const showSwings        = debugOverlayFiltersRef.current?.swings !== false;
      const showLiquidity     = debugOverlayFiltersRef.current?.liquidity !== false;

      const filtered = visibleObjects.filter(obj => {
        const isSwing = obj.type === 'swing' || obj.type === 'strong_swing' || obj.type === 'swing_high' || obj.type === 'swing_low';
        const isLiquidity = obj.type === 'liquidity' || obj.type === 'liquidity_object';
        const isDealingRange = obj.type === 'dealing_range';

        // Hide if toggled off in toolbar
        if (!showDealingRanges && isDealingRange) return false;
        if (!showSwings && isSwing) return false;
        if (!showLiquidity && isLiquidity) return false;

        // Hide swings that are handled by PrimitiveManager (native series markers)
        if (isSwing && swingsFlag === 'on') {
          return false;
        }

        const renderer = RendererRegistry.get(obj.type);
        const targetLayer = renderer?.layer || 'ZonesLayer';
        return targetLayer === layerName;
      });


      const labelOccupied = new Set();
      let selectedDrawn = false;
      
      filtered.forEach(obj => {
        // Sort/Label Occupied Claim check (swings vs other)
        const isSelected = selectedAlgoCandidateRef.current && selectedAlgoCandidateRef.current.id === obj.id;
        if (isSelected) selectedDrawn = true;
        
        // Hide faded ones in narrative mode
        const isFaded = checkIsFaded(obj, limit);
        if (isFaded && !debugModeRef.current && (obj.type === 'intent' || obj.type === 'displacement')) {
          return;
        }

        const candWithFade = { ...obj, faded: isFaded };
        drawAlgoCandidateWithCtx(ctx, candWithFade, isSelected, labelOccupied);
      });

      // Draw virtual delivery leg in narrative mode if active and not already drawn
      if (layerName === 'ZonesLayer' && narrativeModeRef.current) {
        const activeRangeId = currentNarrativeContextRef.current?.properties?.activeRangeId;
        const focusRangeId = narrativeFocusRangeIdRef.current || activeRangeId;
        const focusRangeObj = algoCandidatesRef.current.find(c => c.id === focusRangeId);
        if (focusRangeObj && focusRangeObj.timeStart <= limit) {
          const deliveryLegId = `${focusRangeId}_delivery_leg`;
          const t0 = focusRangeObj.timeStart;
          const t1 = focusRangeObj.timeEnd || limit;
          if (t0 <= bounds.maxVisibleTime && t1 >= bounds.minVisibleTime) {
            const virtualLeg = {
              ...focusRangeObj,
              id: deliveryLegId,
              type: 'delivery_leg',
              faded: false
            };
            drawAlgoCandidateWithCtx(ctx, virtualLeg, false, labelOccupied);
          }
        }
      }

      // Force rendering the selected candidate if it isn't in the default list
      if (!selectedDrawn && selectedAlgoCandidateRef.current) {
        const selectedType = selectedAlgoCandidateRef.current.type;
        const renderer = RendererRegistry.get(selectedType);
        const targetLayer = renderer?.layer || 'ZonesLayer';
        if (targetLayer === layerName) {
          const selectedTime = selectedAlgoCandidateRef.current.timeStart !== undefined 
            ? selectedAlgoCandidateRef.current.timeStart 
            : selectedAlgoCandidateRef.current.time;
          if (selectedTime <= limit) {
            drawAlgoCandidateWithCtx(ctx, selectedAlgoCandidateRef.current, true, labelOccupied);
          }
        }
      }
    }

    ctx.restore();
  };

  const renderDrawingsLayer = (ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hideDrawingsRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    const limit = getReplayTimeLimit();

    localDrawingsRef.current.forEach((shape, index) => {
      if (shape.points && shape.points.length > 0) {
        const firstPoint = shape.points[0];
        if (firstPoint && firstPoint.time > limit) return;
      }

      if (!isDrawingVisible(shape, timeframeRef.current)) return;

      const isSelected = selectedDrawingRef.current === index;
      try {
        drawShape(ctx, shape, isSelected, index);
      } catch (e) {
        console.warn('[drawShape] error rendering shape', shape.type, e);
      }
    });

    ctx.restore();
  };

  const renderInteractiveLayer = (ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Draw active drawing preview
    if (isDrawingRef.current && activeToolRef.current) {
      const defaults = defaultToolStylesRef.current?.[activeToolRef.current] || {};
      const isRect = activeToolRef.current === 'rectangle';
      const isTrend = activeToolRef.current === 'trendline';
      const previewShape = {
        type: activeToolRef.current,
        points: tempPointsRef.current,
        color: defaults.color || '#2962ff',
        width: defaults.width || 2,
        opacity: defaults.opacity !== undefined ? defaults.opacity : (isRect ? 0.15 : 1.0),
        lineStyle: defaults.lineStyle || 'solid',
        
        textColor: defaults.textColor || '#ffffff',
        textOpacity: defaults.textOpacity !== undefined ? defaults.textOpacity : 1.0,
        fontSize: defaults.fontSize || 12,
        bold: defaults.bold || false,
        italic: defaults.italic || false,
        textHalign: defaults.textHalign || (isRect ? 'right' : 'center'),
        textValign: defaults.textValign || (isRect ? 'middle' : 'top'),

        extendLeft: defaults.extendLeft !== undefined ? defaults.extendLeft : false,
        extendRight: defaults.extendRight !== undefined ? defaults.extendRight : false,
        showAngle: defaults.showAngle !== undefined ? defaults.showAngle : false,
        showPriceLabel: defaults.showPriceLabel !== undefined ? defaults.showPriceLabel : (isTrend ? true : false),

        ...(isRect ? {
          showBackground: defaults.showBackground !== undefined ? defaults.showBackground : true,
          backgroundColor: defaults.backgroundColor || defaults.color || '#2962ff',
          backgroundOpacity: defaults.backgroundOpacity !== undefined ? defaults.backgroundOpacity : (defaults.opacity !== undefined ? defaults.opacity : 0.15),
          borderColor: defaults.borderColor || defaults.color || '#2962ff',
          borderOpacity: defaults.borderOpacity !== undefined ? defaults.borderOpacity : 1.0,
          borderWidth: defaults.borderWidth || defaults.width || 2,
          borderStyle: defaults.borderStyle || defaults.lineStyle || 'solid',
          
          showMiddleLine: defaults.showMiddleLine !== undefined ? defaults.showMiddleLine : false,
          middleLineColor: defaults.middleLineColor || '#000000',
          middleLineOpacity: defaults.middleLineOpacity !== undefined ? defaults.middleLineOpacity : 1.0,
          middleLineWidth: defaults.middleLineWidth || 1,
          middleLineStyle: defaults.middleLineStyle || 'solid',

          showAsTrade: defaults.showAsTrade !== undefined ? defaults.showAsTrade : false,
          tradeDirection: defaults.tradeDirection || 'long'
        } : {})
      };
      drawShape(ctx, previewShape, false, -1);
    }

    // 2. Draw snapping circle
    const snappedPos = snappedPosRef.current;
    if (snappedPos) {
      ctx.beginPath();
      ctx.arc(snappedPos.x, snappedPos.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#00e5ff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 3. Draw crosshair cursor and axis labels
    const mousePos = mousePosRef.current;
    if (mousePos && !hideDrawingsRef.current) {
      const { paneWidth, paneHeight, priceScaleWidth, timeScaleHeight } = getChartDimensions();
      const timeScale = chart.timeScale();

      const cx = snappedPos ? snappedPos.x : mousePos.x;
      const cy = snappedPos ? snappedPos.y : mousePos.y;

      if (cx >= 0 && cx <= paneWidth && cy >= 0 && cy <= paneHeight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120, 123, 134, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Vertical
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, paneHeight);
        ctx.stroke();

        // Horizontal
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(paneWidth, cy);
        ctx.stroke();

        // Price Label
        const price = snappedPos ? snappedPos.price : series.coordinateToPrice(cy);
        if (price !== null && price !== undefined) {
          const label = price.toFixed(2);
          ctx.setLineDash([]);
          ctx.font = '500 11px Outfit, sans-serif';
          
          const labelPad = 6;
          const labelH = 18;
          const tw = ctx.measureText(label).width + labelPad * 2;
          const tx = paneWidth;
          const ty = cy - labelH / 2;

          ctx.fillStyle = '#1e222d';
          ctx.fillRect(tx, ty, priceScaleWidth, labelH);

          ctx.strokeStyle = '#787b86';
          ctx.lineWidth = 1;
          ctx.strokeRect(tx, ty, priceScaleWidth, labelH);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, tx + labelPad, cy + 4);
        }

        // Time Label
        const bars = allBarsRef.current;
        if (bars && bars.length > 0) {
          const logical = timeScale.coordinateToLogical(cx);
          if (logical !== null) {
            let time = null;
            const lastIdx = bars.length - 1;
            const lastBar = bars[lastIdx];
            if (logical <= lastIdx) {
              const idx = Math.max(0, Math.min(lastIdx, Math.round(logical)));
              time = bars[idx].time;
            } else {
              const barDuration = timeframeRef.current * 60;
              const diff = logical - lastIdx;
              time = lastBar.time + Math.round(diff) * barDuration;
            }

            if (time) {
              const est = getESTInfo(time);
              const dateObj = new Date(time * 1000);
              const monthName = dateObj.toLocaleString('en-US', { month: 'short', timeZone: 'America/New_York' });
              const dayNum = dateObj.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
              const label = `${dayNum} ${monthName} '${String(dateObj.getFullYear()).substring(2)}  ${est.timeStr}`;
              
              ctx.setLineDash([]);
              ctx.font = '500 11px Outfit, sans-serif';
              
              const labelPad = 8;
              const labelH = 18;
              const tw = ctx.measureText(label).width + labelPad * 2;
              const tx = cx - tw / 2;
              const ty = paneHeight;

              ctx.fillStyle = '#1e222d';
              ctx.beginPath();
              ctx.roundRect(tx, ty, tw, labelH, 2);
              ctx.fill();

              ctx.strokeStyle = '#787b86';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(tx, ty, tw, labelH, 2);
              ctx.stroke();

              ctx.fillStyle = '#ffffff';
              ctx.fillText(label, tx + labelPad, ty + 13);
            }
          }
        }
        ctx.restore();
      }
    }

    // 4. Selection handles
    if (selectedDrawingRef.current !== null && selectedDrawingRef.current >= 0) {
      const shape = localDrawingsRef.current[selectedDrawingRef.current];
      if (shape && !hideDrawingsRef.current && isDrawingVisible(shape, timeframeRef.current)) {
        drawSelectionHandles(ctx, shape);
      }
    }

    ctx.restore();
  };

  const renderLayerContent = (name, ctx, canvas) => {
    if (name === 'GridLayer') {
      renderGridLayer(ctx, canvas);
    } else if (name === 'DrawingsLayer') {
      renderDrawingsLayer(ctx, canvas);
    } else if (name === 'InteractiveLayer') {
      renderInteractiveLayer(ctx, canvas);
    } else {
      renderMarketObjectsLayer(name, ctx, canvas);
    }
  };

  const drawAlgoCandidateWithCtx = (ctx, cand, isSelected, labelOccupied) => {
    const renderer = RendererRegistry.get(cand.type);
    if (!renderer) {
      if (debugModeRef.current) {
        drawInteractionDebug(ctx, cand, isSelected);
      }
      return;
    }

    const limit = getReplayTimeLimit();

    let statefulLiquidity = null;
    if (cand.type === 'liquidity' || cand.type === 'liquidity_object') {
      const state = liquidityStatesRef.current;
      const endBarTime = state.terminatedTimes.has(cand.id) ? state.terminatedTimes.get(cand.id) : null;

      const bars = allBarsRef.current || [];
      let startBarTime = state.t0Cache.get(cand.id);
      if (startBarTime === undefined) {
        const isOld = bars.length > 0 && cand.time < bars[0].time;
        if (isOld) {
          startBarTime = bars.length > 0 ? bars[0].time : cand.time;
        } else {
          const originIdx = state.bisectLeft(bars, cand.time);
          startBarTime = (originIdx + 1 < bars.length) ? bars[originIdx + 1].time : null;
        }
        state.t0Cache.set(cand.id, startBarTime ?? null);
      }
      statefulLiquidity = { startBarTime: startBarTime ?? null, endBarTime };
    }

    const utils = {
      pointToCoords: projectionServiceRef.current.pointToCoords.bind(projectionServiceRef.current),
      getChartDimensions,
      timeframe: timeframeRef.current,
      allBars: allBarsRef.current,
      replayMode: replayModeRef.current,
      replayIndex: replayIndexRef.current,
      limit,
      debugMode: debugModeRef.current,
      viewMode: viewModeRef.current,
      takenLiqOpacity: debugOverlayFiltersRef.current?.takenLiqOpacity ?? 0.25,
      statefulLiquidity,
      labelOccupied: labelOccupied || null
    };

    const config = getEventVisualConfig(cand, selectedConceptRef.current);
    try {
      const projected = renderer.project(cand, utils);
      ctx.save();
      if (cand.faded && 
          cand.type !== 'swing' && 
          cand.type !== 'strong_swing' && 
          cand.type !== 'swing_high' && 
          cand.type !== 'swing_low' &&
          cand.type !== 'liquidity' &&
          cand.type !== 'liquidity_object') {
        ctx.globalAlpha = 0.10;
      }
      renderer.draw(ctx, projected, config, isSelected);
      ctx.restore();
    } catch (e) {
      console.warn('[DrawingCanvas] Error rendering candidate:', cand.type, e);
    }
  };


  const drawInteractionDebug = (ctx, cand, isSelected) => {
    const isSweep = cand.type === 'sweep';
    const isTake = cand.type === 'take';
    const isTouch = cand.type === 'touch';
    if (!isSweep && !isTake && !isTouch) return;

    if (replayModeRef.current && replayIndexRef.current > 0) {
      const currentBar = allBarsRef.current[replayIndexRef.current - 1];
      if (currentBar && cand.time > currentBar.time) return;
    }

    const price = cand.priceHigh !== undefined ? cand.priceHigh : cand.priceLow;
    const coords = pointToCoords({ time: cand.time, price });
    if (!coords) return;

    ctx.save();
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeStyle = '#ffffff';

    if (isSweep) {
      ctx.fillStyle = '#ffa726';
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, isSelected ? 6 : 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 9px Outfit, sans-serif';
      ctx.fillStyle = '#ffa726';
      ctx.fillText('● Sweep', coords.x + 8, coords.y + 3);
    } else if (isTake) {
      ctx.fillStyle = '#ab47bc';
      const size = isSelected ? 10 : 7;
      ctx.fillRect(coords.x - size/2, coords.y - size/2, size, size);
      ctx.strokeRect(coords.x - size/2, coords.y - size/2, size, size);

      ctx.font = 'bold 9px Outfit, sans-serif';
      ctx.fillStyle = '#ab47bc';
      ctx.fillText('■ Take', coords.x + 8, coords.y + 3);
    } else if (isTouch) {
      ctx.fillStyle = '#29b6f6';
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, isSelected ? 4 : 2.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.font = '9px Outfit, sans-serif';
      ctx.fillStyle = '#29b6f6';
      ctx.fillText('• Touch', coords.x + 6, coords.y + 3);
    }
    ctx.restore();
  };



  const drawShape = (ctx, shape, isSelected, index) => {
    if (!shape.points || shape.points.length === 0) return;

    const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
    if (coords.length === 0) return;

    ctx.strokeStyle = hexToRGBA(shape.color || '#2962ff', shape.opacity !== undefined ? shape.opacity : 1.0);
    ctx.lineWidth = shape.width || 2;

    if (shape.lineStyle === 'dashed') {
      ctx.setLineDash([6, 6]);
    } else if (shape.lineStyle === 'dotted') {
      ctx.setLineDash([2, 3]);
    } else {
      ctx.setLineDash([]);
    }

    if ((shape.type === 'position-long' || shape.type === 'position-short') && coords.length >= 3) {
      const c0 = coords[0];
      const c1 = coords[1];
      const c2 = coords[2];

      const rx0 = Math.round(Math.min(c0.x, c1.x));
      const rx1 = Math.round(Math.max(c0.x, c1.x));
      const ryEntry = Math.round(c0.y);
      const ryTP = Math.round(c1.y);
      const rySL = Math.round(c2.y);
      const rw = rx1 - rx0;

      const isLong = shape.type === 'position-long';
      const targetColor = '#089981'; // green
      const riskColor = '#f23645'; // red

      // Target Box
      ctx.save();
      ctx.fillStyle = hexToRGBA(targetColor, 0.2);
      ctx.fillRect(rx0, Math.min(ryEntry, ryTP), rw, Math.abs(ryEntry - ryTP));
      ctx.strokeStyle = hexToRGBA(targetColor, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(rx0, Math.min(ryEntry, ryTP), rw, Math.abs(ryEntry - ryTP));
      ctx.restore();

      // Risk Box
      ctx.save();
      ctx.fillStyle = hexToRGBA(riskColor, 0.2);
      ctx.fillRect(rx0, Math.min(ryEntry, rySL), rw, Math.abs(ryEntry - rySL));
      ctx.strokeStyle = hexToRGBA(riskColor, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(rx0, Math.min(ryEntry, rySL), rw, Math.abs(ryEntry - rySL));
      ctx.restore();

      // Entry Line
      ctx.save();
      ctx.strokeStyle = '#2962ff'; // Blue entry line
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(rx0, ryEntry);
      ctx.lineTo(rx1, ryEntry);
      ctx.stroke();
      ctx.restore();

      // Stats Pill
      ctx.save();
      const entryPrice = shape.points[0].price;
      const tpPrice = shape.points[1].price;
      const slPrice = shape.points[2].price;
      const targetSize = Math.abs(tpPrice - entryPrice);
      const riskSize = Math.abs(slPrice - entryPrice);
      const rrRatio = riskSize > 0 ? (targetSize / riskSize).toFixed(2) : '0.00';

      const statsText = `${isLong ? 'LONG' : 'SHORT'} | R:R: ${rrRatio} | Target: ${targetSize.toFixed(2)} | Stop: ${riskSize.toFixed(2)}`;
      ctx.font = '600 10px Outfit, sans-serif';
      const textW = ctx.measureText(statsText).width;
      const pillW = textW + 16;
      const pillH = 20;
      const pillX = rx0 + rw / 2 - pillW / 2;
      const pillY = ryEntry - pillH / 2;

      ctx.fillStyle = 'rgba(28, 32, 48, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(statsText, rx0 + rw / 2, ryEntry);
      ctx.restore();

      // Axis labels for TP, SL and Entry
      const { paneWidth } = getChartDimensions();
      if (paneWidth > 0) {
        const drawTaggedPriceLabel = (price, cy, color, tag) => {
          const label = `${tag}: ${price.toFixed(2)}`;
          ctx.save();
          ctx.setLineDash([]);
          ctx.font = 'bold 9px Outfit, sans-serif';
          const lp = 4, lh = 18;
          ctx.fillStyle = color;
          ctx.fillRect(paneWidth, cy - lh / 2, 70, lh);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, paneWidth + lp, cy + 3.5);
          ctx.restore();
        };

        drawTaggedPriceLabel(tpPrice, ryTP, targetColor, 'TP');
        drawTaggedPriceLabel(slPrice, rySL, riskColor, 'SL');
        drawTaggedPriceLabel(entryPrice, ryEntry, '#2962ff', 'ENTRY');
      }

      // Draw handles if selected
      if (isSelected) {
        const handles = [
          { x: c0.x, y: c0.y }, // Entry
          { x: (c0.x + c1.x) / 2, y: c1.y }, // TP
          { x: (c0.x + c2.x) / 2, y: c2.y }, // SL
          { x: c1.x, y: c0.y } // Duration
        ];
        handles.forEach(h => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
      }
    } else if (shape.type === 'trendline') {
      const canvas = canvasRef.current;
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      TrendLine.draw(ctx, shape, isSelected, pointToCoords, w, h);

      // Trendline text annotation rendering
      if (coords.length >= 2) {
        const midX = (coords[0].x + coords[1].x) / 2;
        const midY = (coords[0].y + coords[1].y) / 2;

        const shapeIndex = index !== undefined && index !== null ? index : localDrawingsRef.current.indexOf(shape);
        const hasActualText = shape.text && shape.text.trim() !== '';

        const isHovered = mousePosRef.current && (() => {
          const hit = findHit(mousePosRef.current.x, mousePosRef.current.y);
          return hit && hit.shapeIdx === shapeIndex;
        })();

        const showPlaceholder = !hasActualText && (isSelected || isHovered);
        const isEditingThisShape = inlineTextInput && inlineTextInput.shapeIdx === shapeIndex;
        const rawTextToDraw = (hasActualText && !isEditingThisShape) ? shape.text : ((showPlaceholder && !isEditingThisShape) ? '+ Add text' : null);

        if (rawTextToDraw) {
          ctx.save();
          let fontStyle = '';
          if (shape.italic) fontStyle += 'italic ';
          if (shape.bold) fontStyle += '600 ';
          const fontSize = shape.fontSize || 12;
          ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;

          const textHalign = shape.textHalign || 'center';
          const textValign = shape.textValign || 'top';

          const pLeft = coords[0].x <= coords[1].x ? coords[0] : coords[1];
          const pRight = coords[0].x <= coords[1].x ? coords[1] : coords[0];

          // Calculate line angle from left to right (always in [-pi/2, pi/2] range)
          const angle = Math.atan2(pRight.y - pLeft.y, pRight.x - pLeft.x);

          let basePoint;
          if (textHalign === 'left') {
            basePoint = pLeft;
          } else if (textHalign === 'right') {
            basePoint = pRight;
          } else {
            basePoint = { x: midX, y: midY };
          }

          // Translate to basePoint and rotate to follow the line slope
          ctx.translate(basePoint.x, basePoint.y);
          ctx.rotate(angle);

          let xOffset, textAlign;
          if (textHalign === 'left') {
            xOffset = 8;
            textAlign = 'left';
          } else if (textHalign === 'right') {
            xOffset = -8;
            textAlign = 'right';
          } else { // center
            xOffset = 0;
            textAlign = 'center';
          }

          let textBaseline, verticalOffset;
          if (textValign === 'top') {
            verticalOffset = -8;
            textBaseline = 'bottom';
          } else if (textValign === 'bottom') {
            verticalOffset = 8;
            textBaseline = 'top';
          } else { // middle
            verticalOffset = 0;
            textBaseline = 'middle';
          }

          ctx.textAlign = textAlign;
          ctx.textBaseline = textBaseline;

          if (hasActualText) {
            ctx.fillStyle = hexToRGBA(shape.textColor || '#ffffff', shape.textOpacity !== undefined ? shape.textOpacity : 1.0);
          } else {
            ctx.fillStyle = 'rgba(120, 123, 134, 0.6)';
          }

          ctx.fillText(rawTextToDraw, xOffset, verticalOffset);
          ctx.restore();
        }
      }
    } else if (shape.type === 'horizontal-line') {
      // Native PriceLine renders the line; we only draw handles here if selected
    } else if (shape.type === 'ray') {
      // Use clientWidth (logical px) not .width (backing buffer) — fixes HiDPI/Retina clipping
      const rayEndX = canvasRef.current.clientWidth;
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      ctx.lineTo(rayEndX, coords[0].y);
      ctx.stroke();

      // Price label on Y-axis (TV behavior: ray always shows its price)
      if (shape.id) {
        const { paneWidth } = getChartDimensions();
        const price = shape.points[0].price;
        if (price !== undefined && paneWidth > 0) {
          const label = price.toFixed(2);
          ctx.save();
          ctx.setLineDash([]);
          ctx.font = '500 11px Outfit, sans-serif';
          const labelPad = 4;
          const labelH = 18;
          const labelW = ctx.measureText(label).width + labelPad * 2;
          ctx.fillStyle = shape.color || '#2962ff';
          ctx.fillRect(paneWidth, coords[0].y - labelH / 2, labelW, labelH);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, paneWidth + labelPad, coords[0].y + 4);
          ctx.restore();
        }
      }
    } else if (shape.type === 'rectangle' && coords.length >= 2) {
      const canvas = canvasRef.current;
      const w = canvas ? (canvas.clientWidth || canvas.width) : 2000;
      let leftX = Math.min(coords[0].x, coords[1].x);
      let rightX = Math.max(coords[0].x, coords[1].x);
      if (shape.extendLeft) leftX = 0;
      if (shape.extendRight) rightX = w;

      const rx0 = Math.round(leftX);
      const ry0 = Math.round(Math.min(coords[0].y, coords[1].y));
      const rx1 = Math.round(rightX);
      const ry1 = Math.round(Math.max(coords[0].y, coords[1].y));
      const rw = rx1 - rx0;
      const rh = ry1 - ry0;

      // Draw Background Fill & Borders
      if (shape.showAsTrade) {
        const midY = Math.round(ry0 + rh / 2);
        const isLong = shape.tradeDirection !== 'short';
        
        const targetColor = '#089981'; // green
        const stopColor = '#f23645'; // red
        
        const topColor = isLong ? targetColor : stopColor;
        const bottomColor = isLong ? stopColor : targetColor;

        // Upper half fill
        ctx.save();
        ctx.fillStyle = hexToRGBA(topColor, 0.18);
        ctx.fillRect(rx0, ry0, rw, midY - ry0);
        
        // Lower half fill
        ctx.fillStyle = hexToRGBA(bottomColor, 0.18);
        ctx.fillRect(rx0, midY, rw, ry1 - midY);
        ctx.restore();

        // Borders
        ctx.save();
        ctx.lineWidth = shape.borderWidth || shape.width || 2;
        ctx.strokeStyle = hexToRGBA(topColor, 0.6);
        ctx.strokeRect(rx0, ry0, rw, midY - ry0);
        
        ctx.strokeStyle = hexToRGBA(bottomColor, 0.6);
        ctx.strokeRect(rx0, midY, rw, ry1 - midY);
        ctx.restore();

        // Entry middle line
        ctx.save();
        ctx.strokeStyle = '#2962ff'; // blue entry line
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(rx0, midY);
        ctx.lineTo(rx1, midY);
        ctx.stroke();
        ctx.restore();

        // Draw stats pill in center
        const p1 = shape.points[0].price;
        const p2 = shape.points[1].price;
        const high = Math.max(p1, p2);
        const low = Math.min(p1, p2);
        const mid = (high + low) / 2;
        const targetSize = isLong ? (high - mid) : (mid - low);
        const riskSize = isLong ? (mid - low) : (high - mid);
        const ratio = riskSize > 0 ? (targetSize / riskSize).toFixed(2) : '0.00';
        const statsText = `${isLong ? 'LONG' : 'SHORT'} | Risk: ${riskSize.toFixed(2)} pts | Target: ${targetSize.toFixed(2)} pts | R:R: ${ratio}`;
        
        ctx.save();
        ctx.font = '600 11px Outfit, sans-serif';
        const tw = ctx.measureText(statsText).width;
        const px = rx0 + rw / 2 - tw / 2;
        const py = ry0 + rh / 2 - 10;
        
        // Draw stats pill background
        ctx.fillStyle = 'rgba(19, 23, 34, 0.85)';
        ctx.fillRect(px - 6, py - 6, tw + 12, 20);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 6, py - 6, tw + 12, 20);
        
        // Draw text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(statsText, px, py + 8);
        ctx.restore();
      } else {
        // Draw Background Fill
        if (shape.showBackground !== false) {
          const fillCol = shape.backgroundColor || shape.color || '#2962ff';
          const fillOp = shape.backgroundOpacity !== undefined ? shape.backgroundOpacity : (shape.fillOpacity !== undefined ? shape.fillOpacity : (shape.opacity !== undefined ? shape.opacity : 0.15));
          ctx.save();
          ctx.fillStyle = hexToRGBA(fillCol, fillOp);
          ctx.fillRect(rx0, ry0, rw, rh);
          ctx.restore();
        }

        // Draw Border
        if (shape.showBorder !== false) {
          const borderCol = shape.borderColor || shape.color || '#2962ff';
          const borderOp = shape.borderOpacity !== undefined ? shape.borderOpacity : 1.0;
          const borderWidth = shape.borderWidth || shape.width || 2;
          const borderStyle = shape.borderStyle || shape.lineStyle || 'solid';
          ctx.save();
          ctx.strokeStyle = hexToRGBA(borderCol, borderOp);
          ctx.lineWidth = borderWidth;
          if (borderStyle === 'dashed') {
            ctx.setLineDash([6, 6]);
          } else if (borderStyle === 'dotted') {
            ctx.setLineDash([2, 3]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.rect(rx0, ry0, rw, rh);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Check if we have text (either actual or placeholder)
      const shapeIndex = index !== undefined && index !== null ? index : localDrawingsRef.current.indexOf(shape);
      const hasActualText = shape.text && shape.text.trim() !== '';
      const isHovered = mousePosRef.current && (() => {
        const hit = findHit(mousePosRef.current.x, mousePosRef.current.y);
        return hit && hit.shapeIdx === shapeIndex;
      })();
      const showPlaceholder = !hasActualText && (isSelected || isHovered);
      const isEditingThisShape = inlineTextInput && inlineTextInput.shapeIdx === shapeIndex;
      const rawTextToDraw = (hasActualText && !isEditingThisShape) ? shape.text : ((showPlaceholder && !isEditingThisShape) ? '+ Add text' : null);

      let textStartX = rx1;
      let textW = 0;
      const fontSize = shape.fontSize || 12;

      if (rawTextToDraw) {
        ctx.save();
        let fontStyle = '';
        if (shape.italic) fontStyle += 'italic ';
        if (shape.bold) fontStyle += '600 ';
        ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;
        textW = ctx.measureText(rawTextToDraw).width;
        ctx.restore();

        const padding = 8;
        const textHalign = shape.textHalign || 'right';
        if (textHalign === 'left') {
          textStartX = rx0 + padding;
        } else if (textHalign === 'center') {
          textStartX = rx0 + rw / 2 - textW / 2;
        } else {
          textStartX = rx1 - padding - textW;
        }
      }

      // Hide text if the box is too narrow to contain it (zoomed out)
      const fitsWidth = !rawTextToDraw || Math.abs(rw) >= textW + 10;
      const textToDraw = (rawTextToDraw && fitsWidth) ? rawTextToDraw : null;

      // Draw Middle Line
      if (shape.showMiddleLine && !shape.showAsTrade) {
        const midY = Math.round(ry0 + rh / 2);
        const midCol = shape.middleLineColor || '#000000';
        const midOp = shape.middleLineOpacity !== undefined ? shape.middleLineOpacity : 1.0;
        const midWidth = shape.middleLineWidth || 1;
        const midStyle = shape.middleLineStyle || 'solid';
        ctx.save();
        ctx.strokeStyle = hexToRGBA(midCol, midOp);
        ctx.lineWidth = midWidth;
        if (midStyle === 'dashed') {
          ctx.setLineDash([6, 6]);
        } else if (midStyle === 'dotted') {
          ctx.setLineDash([2, 3]);
        } else {
          ctx.setLineDash([]);
        }

        const textValign = shape.textValign || 'middle';
        const textHalign = shape.textHalign || 'right';

        if (textToDraw && textValign === 'middle') {
          // Middle line splits or ends around text
          if (textHalign === 'right') {
            ctx.beginPath();
            ctx.moveTo(rx0, midY);
            ctx.lineTo(Math.max(rx0, textStartX - 4), midY);
            ctx.stroke();
          } else if (textHalign === 'left') {
            ctx.beginPath();
            ctx.moveTo(Math.min(rx1, textStartX + textW + 4), midY);
            ctx.lineTo(rx1, midY);
            ctx.stroke();
          } else if (textHalign === 'center') {
            ctx.beginPath();
            ctx.moveTo(rx0, midY);
            ctx.lineTo(Math.max(rx0, textStartX - 4), midY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(Math.min(rx1, textStartX + textW + 4), midY);
            ctx.lineTo(rx1, midY);
            ctx.stroke();
          }
        } else {
          // Draw fully across
          ctx.beginPath();
          ctx.moveTo(rx0, midY);
          ctx.lineTo(rx1, midY);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Y-axis price labels for top and bottom edges (TV behavior)
      if (shape.id) {
        const { paneWidth } = getChartDimensions();
        if (paneWidth > 0) {
          const p1 = shape.points[0].price;
          const p2 = shape.points[1].price;
          const topPrice = Math.max(p1, p2);
          const bottomPrice = Math.min(p1, p2);
          const topY = Math.min(ry0, ry1);
          const bottomY = Math.max(ry0, ry1);

          if (shape.showAsTrade) {
            const isLong = shape.tradeDirection !== 'short';
            const targetColor = '#089981'; // green
            const stopColor = '#f23645'; // red
            const entryColor = '#2962ff'; // blue
            const midPrice = (p1 + p2) / 2;
            const midY = Math.round(ry0 + rh / 2);

            const drawTaggedPriceLabel = (price, cy, color, tag) => {
              const label = `${tag}: ${price.toFixed(2)}`;
              ctx.save();
              ctx.setLineDash([]);
              ctx.font = 'bold 9px Outfit, sans-serif';
              const lp = 4, lh = 18;
              ctx.fillStyle = color;
              ctx.fillRect(paneWidth, cy - lh / 2, 70, lh); // fix label block width on axis
              ctx.fillStyle = '#ffffff';
              ctx.fillText(label, paneWidth + lp, cy + 3.5);
              ctx.restore();
            };

            drawTaggedPriceLabel(topPrice, topY, isLong ? targetColor : stopColor, isLong ? 'TP' : 'SL');
            drawTaggedPriceLabel(bottomPrice, bottomY, isLong ? stopColor : targetColor, isLong ? 'SL' : 'TP');
            drawTaggedPriceLabel(midPrice, midY, entryColor, 'ENTRY');
          } else {
            const drawRectPriceLabel = (price, cy) => {
              const label = price.toFixed(2);
              ctx.save();
              ctx.setLineDash([]);
              ctx.font = '500 11px Outfit, sans-serif';
              const lp = 4, lh = 18;
              const lw = ctx.measureText(label).width + lp * 2;
              ctx.fillStyle = shape.borderColor || shape.color || '#2962ff';
              ctx.fillRect(paneWidth, cy - lh / 2, lw, lh);
              ctx.fillStyle = '#ffffff';
              ctx.fillText(label, paneWidth + lp, cy + 4);
              ctx.restore();
            };

            drawRectPriceLabel(topPrice, topY);
            if (Math.abs(topY - bottomY) > 4) {
              drawRectPriceLabel(bottomPrice, bottomY);
            }
          }
        }
      }

      // Draw text label
      if (textToDraw) {
        const textValign = shape.textValign || 'middle';
        const textHalign = shape.textHalign || 'right';
        ctx.save();
        
        // Horizontal alignment
        let textX;
        ctx.textAlign = textHalign;
        if (textHalign === 'left') {
          textX = rx0 + 8;
        } else if (textHalign === 'center') {
          textX = rx0 + rw / 2;
        } else {
          textX = rx1 - 8;
        }

        // Vertical alignment
        let textY;
        if (textValign === 'top') {
          ctx.textBaseline = 'top';
          textY = ry0 + 6;
        } else if (textValign === 'bottom') {
          ctx.textBaseline = 'bottom';
          textY = ry1 - 6;
        } else {
          ctx.textBaseline = 'middle';
          textY = ry0 + rh / 2;
        }

        if (hasActualText) {
          ctx.fillStyle = hexToRGBA(shape.textColor || '#ffffff', shape.textOpacity !== undefined ? shape.textOpacity : 1.0);
        } else {
          ctx.fillStyle = 'rgba(120, 123, 134, 0.6)';
        }

        let fontStyle = '';
        if (shape.italic) fontStyle += 'italic ';
        if (shape.bold) fontStyle += '600 ';
        ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;
        ctx.fillText(textToDraw, textX, textY);
        ctx.restore();
      }
    } else if (shape.type === 'brush') {
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) {
        ctx.lineTo(coords[i].x, coords[i].y);
      }
      ctx.stroke();
    } else if (shape.type === 'fibonacci' && coords.length >= 2) {
      const y1 = coords[0].y;
      const y2 = coords[1].y;
      const p1 = shape.points[0].price;
      const p2 = shape.points[1].price;
      const minX = Math.min(coords[0].x, coords[1].x);
      const maxX = Math.max(coords[0].x, coords[1].x);

      // Draw base Trendline
      ctx.save();
      ctx.strokeStyle = '#787b86';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      ctx.lineTo(coords[1].x, coords[1].y);
      ctx.stroke();
      ctx.restore();

      // Fib levels
      const ratios = [
        { r: 0, label: '0.0%' },
        { r: 0.236, label: '23.6%' },
        { r: 0.382, label: '38.2%' },
        { r: 0.5, label: '50.0%' },
        { r: 0.618, label: '61.8%' },
        { r: 0.786, label: '78.6%' },
        { r: 1.0, label: '100.0%' }
      ];

      ratios.forEach(({ r, label }) => {
        const val = p1 + r * (p2 - p1);
        const ly = series.priceToCoordinate(val);
        if (ly === null) return;

        // Draw level line
        ctx.beginPath();
        ctx.moveTo(minX, ly);
        ctx.lineTo(maxX, ly);
        ctx.stroke();

        // Draw text label
        ctx.fillStyle = '#787b86';
        ctx.font = '10px Outfit';
        ctx.fillText(`${label} (${val.toFixed(2)})`, maxX + 6, ly + 3);
      });
    } else if (shape.type === 'text') {
      const txt = shape.text || '';
      ctx.font = '12px Outfit';
      const width = ctx.measureText(txt).width + 16;
      const height = 22;
      const tx = coords[0].x - width / 2;
      const ty = coords[0].y - height / 2;

      // Pill Background
      ctx.fillStyle = 'rgba(28, 32, 48, 0.85)';
      ctx.strokeStyle = varColor('--border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, width, height, 4);
      ctx.fill();
      ctx.stroke();

      // Text
      ctx.fillStyle = shape.color || '#ffffff';
      ctx.fillText(txt, tx + 8, ty + 15);
    } else if (shape.type === 'ruler' && coords.length >= 2) {
      // Draw temporary Ruler
      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      // Bounding box
      ctx.strokeRect(coords[0].x, coords[0].y, coords[1].x - coords[0].x, coords[1].y - coords[0].y);
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      ctx.lineTo(coords[1].x, coords[1].y);
      ctx.stroke();
      ctx.restore();

      // Calculations
      const p1 = shape.points[0].price;
      const p2 = shape.points[1].price;
      const pDiff = p2 - p1;
      const pPct = ((pDiff / p1) * 100).toFixed(2);

      // Find bars diff
      const bars = allBarsRef.current;
      let bDiff = 0;
      if (bars && bars.length > 0) {
        const i1 = bars.findIndex(b => b.time === shape.points[0].time);
        const i2 = bars.findIndex(b => b.time === shape.points[1].time);
        if (i1 !== -1 && i2 !== -1) {
          bDiff = i2 - i1;
        }
      }

      // Draw middle tooltip card
      const midX = (coords[0].x + coords[1].x) / 2;
      const midY = (coords[0].y + coords[1].y) / 2;

      const txt = `${pDiff >= 0 ? '+' : ''}${pDiff.toFixed(2)} (${pDiff >= 0 ? '+' : ''}${pPct}%)  ${Math.abs(bDiff)} bars`;
      
      ctx.font = '600 11px Outfit';
      const textWidth = ctx.measureText(txt).width + 16;

      ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
      ctx.beginPath();
      ctx.roundRect(midX - textWidth / 2, midY - 12, textWidth, 24, 4);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.fillText(txt, midX - textWidth / 2 + 8, midY + 4);
    }

    // Draw handles if shape is selected
    if (isSelected) {
      if (shape.type === 'rectangle' && coords.length >= 2) {
        const x1 = coords[0].x, y1 = coords[0].y;
        const x2 = coords[1].x, y2 = coords[1].y;
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        const handles = [
          { x: minX, y: minY },
          { x: midX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: midY },
          { x: maxX, y: maxY },
          { x: midX, y: maxY },
          { x: minX, y: maxY },
          { x: minX, y: midY }
        ];
        handles.forEach(c => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#2962ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
      } else if (shape.type === 'ray') {
        // Clamp anchor handle to visible area — always grabbable even when anchor is off-screen left
        const hx = Math.max(4, coords[0].x);
        const hy = coords[0].y;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = shape.color || '#2962ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      } else if (shape.type === 'position-long' || shape.type === 'position-short') {
        // Handles already drawn in shape specific render block above
      } else {
        coords.forEach((c) => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = shape.color || '#2962ff';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
      }
    }
  };

  // Helper colors
  const hexToRGBA = (hex, alpha) => {
    let r = 41, g = 98, b = 255;
    if (hex.startsWith('#')) {
      const cleanHex = hex.replace('#', '');
      r = parseInt(cleanHex.substring(0, 2), 16);
      g = parseInt(cleanHex.substring(2, 4), 16);
      b = parseInt(cleanHex.substring(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const varColor = (name) => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  const renderLayerContentRef = useRef(null);
  renderLayerContentRef.current = renderLayerContent;

  const layerRefCallbacks = useMemo(
    () => layersConfig.map((layer) => {
      const { name, zIndex } = layer;
      const cb = (el) => {
        if (el) {
          layerManagerRef.current.registerLayer(
            name,
            el,
            (ctx, canvas) => {
              if (renderLayerContentRef.current) {
                renderLayerContentRef.current(name, ctx, canvas);
              }
            },
            zIndex
          );
          if (name === 'InteractiveLayer') {
            canvasRef.current = el;
          }
        } else {
          layerManagerRef.current.unregisterLayer(name);
        }
      };
      return cb;
    }),
    [layersConfig]
  );

  return (
    <>
      <div 
        className="overlay-canvases-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        {layersConfig.map((layer, layerIdx) => (
          <canvas
            key={layer.name}
            ref={layerRefCallbacks[layerIdx]}
            className={`overlay-canvas layer-${layer.name.toLowerCase()}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: layer.name === 'InteractiveLayer' ? 'auto' : 'none',
              zIndex: layer.zIndex
            }}
          />
        ))}
      </div>
      {inlineTextInput && (
        <input
          type="text"
          style={{
            position: 'absolute',
            left: `${inlineTextInput.x}px`,
            top: `${inlineTextInput.y}px`,
            width: `${inlineTextInput.width}px`,
            height: `${inlineTextInput.height}px`,
            fontSize: `${inlineTextInput.fontSize}px`,
            fontStyle: inlineTextInput.italic ? 'italic' : 'normal',
            fontWeight: inlineTextInput.bold ? '600' : 'normal',
            color: inlineTextInput.color,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            padding: 0,
            margin: 0,
            zIndex: 10000,
            fontFamily: 'Outfit, sans-serif',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            textAlign: inlineTextInput.textAlign || 'left'
          }}
          value={inlineTextInput.value}
          onChange={e => {
            const val = e.target.value;
            const canvas = canvasRef.current;
            let textW = 0;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.save();
                let fontStyle = '';
                if (inlineTextInput.italic) fontStyle += 'italic ';
                if (inlineTextInput.bold) fontStyle += '600 ';
                ctx.font = `${fontStyle}${inlineTextInput.fontSize}px Outfit, sans-serif`;
                textW = ctx.measureText(val).width;
                ctx.restore();
              }
            }
            const width = Math.max(textW + 20, 120);
            
            let newX = inlineTextInput.x;
            let newY = inlineTextInput.y;
            if (inlineTextInput.isTrendLine) {
              const { basePoint, angle, fontSize, xOffset, verticalOffset, textAlign, textValign } = inlineTextInput;
              const textStartX = textAlign === 'left' ? xOffset : (textAlign === 'right' ? xOffset - textW : xOffset - textW / 2);
              
              let textBaseline;
              if (textValign === 'top') {
                textBaseline = 'bottom';
              } else if (textValign === 'bottom') {
                textBaseline = 'top';
              } else {
                textBaseline = 'middle';
              }
              const textMinY = textBaseline === 'bottom' ? verticalOffset - fontSize : (textBaseline === 'top' ? verticalOffset : verticalOffset - fontSize / 2);
              
              const centerY_rotated = textMinY + fontSize / 2;
              
              if (textAlign === 'left') {
                const leftEdgeX_rotated = textStartX;
                const leftEdgeX_screen = basePoint.x + leftEdgeX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const leftEdgeY_screen = basePoint.y + leftEdgeX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                newX = leftEdgeX_screen;
                newY = leftEdgeY_screen - (fontSize + 4) / 2;
              } else if (textAlign === 'right') {
                const rightEdgeX_rotated = textStartX + textW;
                const rightEdgeX_screen = basePoint.x + rightEdgeX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const rightEdgeY_screen = basePoint.y + rightEdgeX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                newX = rightEdgeX_screen - width;
                newY = rightEdgeY_screen - (fontSize + 4) / 2;
              } else {
                const centerX_rotated = textStartX + textW / 2;
                const centerX_screen = basePoint.x + centerX_rotated * Math.cos(angle) - centerY_rotated * Math.sin(angle);
                const centerY_screen = basePoint.y + centerX_rotated * Math.sin(angle) + centerY_rotated * Math.cos(angle);
                newX = centerX_screen - width / 2;
                newY = centerY_screen - (fontSize + 4) / 2;
              }
            } else {
              const { rx0, rx1, rw, padding, textAlign } = inlineTextInput;
              if (rx0 !== undefined && rx1 !== undefined && padding !== undefined) {
                if (textAlign === 'left') {
                  newX = rx0 + padding;
                } else if (textAlign === 'center') {
                  newX = rx0 + rw / 2 - width / 2;
                } else {
                  newX = rx1 - padding - width;
                }
              }
            }

            setInlineTextInput({
              ...inlineTextInput,
              value: val,
              width,
              x: newX,
              y: newY
            });

            // Live preview text update
            const copy = [...drawings];
            copy[inlineTextInput.shapeIdx] = {
              ...copy[inlineTextInput.shapeIdx],
              text: val
            };
            setDrawings(copy);
          }}
          onBlur={() => {
            onAddUndoState();
            setInlineTextInput(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.target.blur();
            } else if (e.key === 'Escape') {
              // Revert to original
              const copy = [...drawings];
              copy[inlineTextInput.shapeIdx] = {
                ...copy[inlineTextInput.shapeIdx],
                text: inlineTextInput.originalText
              };
              setDrawings(copy);
              setInlineTextInput(null);
            }
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          autoFocus
        />
      )}
    </>
  );
}

function getReplayNarrativeContext(algoCandidates, limit) {
  if (!algoCandidates || algoCandidates.length === 0) return null;

  // 1. Get all dealing ranges that have started up to limit
  const ranges = algoCandidates.filter(c => c.type === 'dealing_range' && c.timeStart <= limit);
  if (ranges.length === 0) return null;

  // Sort by timeStart descending (most recent first)
  ranges.sort((a, b) => b.timeStart - a.timeStart);

  // Active range is the first one that is developing (i.e. not completed/invalidated at limit)
  // Or fallback to the most recent completed range
  const activeRange = ranges.find(r => !r.timeEnd || limit < r.timeEnd) || ranges[0];
  if (!activeRange) return null;

  const rHigh = activeRange.priceHigh;
  const rLow = activeRange.priceLow;
  const rStart = activeRange.timeStart;
  const rEnd = activeRange.timeEnd && limit >= activeRange.timeEnd ? activeRange.timeEnd : limit;

  // Nested ranges (spatially and temporally inside activeRange up to limit)
  const nestedRanges = ranges.filter(r => 
    r.id !== activeRange.id &&
    r.priceLow >= rLow && 
    r.priceHigh <= rHigh && 
    r.timeStart >= rStart && 
    (r.timeEnd || r.timeStart) <= rEnd
  ).map(r => r.id);

  // Active PD arrays nested inside activeRange up to limit
  const activePdArrays = algoCandidates.filter(arr => 
    (arr.type === 'fvg' || arr.type === 'ifvg' || arr.type === 'ob' || arr.type === 'breaker' || arr.type === 'volume_imbalance' || arr.type === 'liquidity_void') &&
    arr.timeStart <= limit &&
    arr.priceLow >= rLow &&
    arr.priceHigh <= rHigh &&
    arr.time >= rStart &&
    arr.time <= rEnd
  ).map(arr => arr.id);

  return {
    id: `narrative_context_dynamic`,
    type: 'narrative_context',
    direction: activeRange.direction,
    time: activeRange.time,
    timeStart: rStart,
    timeEnd: activeRange.timeEnd && limit >= activeRange.timeEnd ? activeRange.timeEnd : null,
    priceHigh: rHigh,
    priceLow: rLow,
    barIndex: activeRange.barIndex,
    state: activeRange.timeEnd && limit >= activeRange.timeEnd ? activeRange.state : 'developing',
    properties: {
      activeRangeId: activeRange.id,
      activeRangeHigh: rHigh,
      activeRangeLow: rLow,
      equilibrium: activeRange.properties?.equilibrium || ((rHigh + rLow) / 2),
      deliveryState: activeRange.properties?.deliveryState || {},
      nestedRanges,
      activePdArrays
    }
  };
}
