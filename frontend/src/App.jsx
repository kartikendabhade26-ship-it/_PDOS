import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, CrosshairMode, CandlestickSeries, BarSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { ChartEventBus } from './utils/ChartEventBus';
import { FeatureFlags } from './utils/FeatureFlags';
import {
  MousePointer,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  Type,
  Brush,
  Square,
  Compass,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
  Undo2,
  Redo2,
  Settings,
  Layers,
  Check,
  ChevronDown,
  Activity,
  BarChart2,
  X,
  Sun,
  Moon,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  History,

  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  GripVertical,

  // TradingView Pro toolbar icons (new)
  CandlestickChart,
  BarChart3,
  LineChart,
  LayoutGrid,
  Clock,
  Droplets,
  Sparkles,
  Maximize,
  Minimize
} from 'lucide-react';


import ChartSettingsModal from './components/ChartSettingsModal';
import ChartViewport from './components/ChartViewport';
import WatchlistSidebar from './components/WatchlistSidebar';

import { getESTInfo } from './utils/sessions';
import { aggregateDevelopingCandle } from './utils/replayAggregator';
import {
  saveDrawings,
  loadDrawings,
  savePreferences,
  loadPreferences
} from './utils/storage';
import { slidingWindowCache1, slidingWindowCache2 } from './utils/SlidingWindowCache';


function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export default function App() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeRef = useRef(null);
  const chartTargetRef = useRef(null);

  // Data State
  const [symbols, setSymbols] = useState([]);
  const [activeSymbol, setActiveSymbol] = useState('');
  const [activeResearchMode] = useState('interactive'); // Analysis Mode only
  const [limitBarsInteractive, setLimitBarsInteractive] = useState(80000); // Default 80k bars (options: 2 weeks = 20k, 1 month = 40k, 3 months = 120k)
  const [syncProgress, setSyncProgress] = useState(null);
  const [isProgressOverlayVisible, setIsProgressOverlayVisible] = useState(false);
  const userDismissedSyncRef = useRef(false);
  const [timeframe, setTimeframe] = useState(1); // minutes
  const [chartType, setChartType] = useState('candle');
  const [allBars, setAllBars] = useState([]);
  const [hudBar, setHudBar] = useState(null);

  // Drawing Tools State
  const [activeTool, setActiveTool] = useState(null);
  const [drawings, _setDrawings] = useState([]);

  // Default tool styles mapping (saved in local storage to remember drawing preferences)
  const [defaultToolStyles, setDefaultToolStyles] = useState(() => {
    try {
      const saved = localStorage.getItem('tv_default_tool_styles');
      return saved ? JSON.parse(saved) : {
        rectangle: { color: '#2962ff', width: 2, opacity: 0.15, lineStyle: 'solid' },
        trendline: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        'horizontal-line': { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        ray: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        fibonacci: { color: '#787b86', width: 1, opacity: 1.0, lineStyle: 'solid' },
        brush: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        text: { color: '#ffffff', fontSize: 12, opacity: 1.0 },
        'position-long': { color: '#089981', width: 1.5, opacity: 1.0, lineStyle: 'solid' },
        'position-short': { color: '#f23645', width: 1.5, opacity: 1.0, lineStyle: 'solid' }
      };
    } catch (e) {
      return {
        rectangle: { color: '#2962ff', width: 2, opacity: 0.15, lineStyle: 'solid' },
        trendline: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        'horizontal-line': { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        ray: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        fibonacci: { color: '#787b86', width: 1, opacity: 1.0, lineStyle: 'solid' },
        brush: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid' },
        text: { color: '#ffffff', fontSize: 12, opacity: 1.0 },
        'position-long': { color: '#089981', width: 1.5, opacity: 1.0, lineStyle: 'solid' },
        'position-short': { color: '#f23645', width: 1.5, opacity: 1.0, lineStyle: 'solid' }
      };
    }
  });

  const setDrawings = (newDrawingsOrFn) => {
    _setDrawings(prev => {
      const next = typeof newDrawingsOrFn === 'function' ? newDrawingsOrFn(prev) : newDrawingsOrFn;
      
      // Auto-remember drawing style preferences if they are changed
      if (prev.length === next.length) {
        for (let i = 0; i < prev.length; i++) {
          const p = prev[i];
          const n = next[i];
          if (p && n && p.id === n.id) {
            const styleKeys = [
              'color', 'width', 'opacity', 'lineStyle', 
              'textColor', 'textOpacity', 'fontSize', 'bold', 'italic', 'textHalign', 'textValign',
              'backgroundColor', 'backgroundOpacity', 'fillOpacity',
              'borderColor', 'borderWidth', 'borderOpacity', 'borderStyle',
              'extendLeft', 'extendRight', 'showAngle', 'showPriceLabel',
              'showMiddleLine', 'middleLineColor', 'middleLineWidth', 'middleLineStyle',
              'showAsTrade', 'tradeDirection'
            ];
            let changed = false;
            const updatedStyle = {};
            styleKeys.forEach(k => {
              if (p[k] !== n[k]) {
                changed = true;
                updatedStyle[k] = n[k];
              }
            });
            if (changed) {
              const toolType = n.type;
              if (toolType) {
                setDefaultToolStyles(d => {
                  const updated = {
                    ...d,
                    [toolType]: {
                      ...d[toolType],
                      ...updatedStyle
                    }
                  };
                  localStorage.setItem('tv_default_tool_styles', JSON.stringify(updated));
                  return updated;
                });
              }
              break;
            }
          }
        }
      }
      return next;
    });
  };
  const [selectedDrawing, setSelectedDrawing] = useState(null);
  const [floatingToolbarPos, setFloatingToolbarPos] = useState({ x: 100, y: 100 });
  const [isToolbarPinned, setIsToolbarPinned] = useState(false);
  const [isDrawingSettingsOpen, setIsDrawingSettingsOpen] = useState(false);

  // Undo/Redo Stacks
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Preferences (Saved in LocalStorage)
  const [magnetMode, setMagnetMode] = useState(false);
  const [lockDrawings, setLockDrawings] = useState(false);
  const [hideDrawings, setHideDrawings] = useState(false);
  const [showSessions, setShowSessions] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  // Theme Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('tv_dark_mode');
      return saved ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });

  // Chart Settings state for customization modal
  const [chartSettings, setChartSettings] = useState(() => {
    try {
      const defaults = {
        showCandleBody: true,
        showCandleBorders: true,
        showCandleWicks: true,
        upColor: '#66bb6a',
        downColor: '#000000',
        borderUpColor: '#000000',
        borderDownColor: '#000000',
        wickUpColor: '#000000',
        wickDownColor: '#000000',
        showOhlc: true,
        showGridLines: true,
        gridColor: '',
        bgColor: '#d0d4de',
        textColor: '#000000',
      };

      const saved = localStorage.getItem('tv_chart_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge defaults with saved settings so new keys are backfilled, 
        // while preserving existing user changes.
        return { ...defaults, ...parsed };
      }

      localStorage.setItem('tv_chart_settings', JSON.stringify(defaults));
      return defaults;
    } catch (e) {
      return {
        showCandleBody: true,
        showCandleBorders: true,
        showCandleWicks: true,
        upColor: '#66bb6a',
        downColor: '#000000',
        borderUpColor: '#000000',
        borderDownColor: '#000000',
        wickUpColor: '#000000',
        wickDownColor: '#000000',
        showOhlc: true,
        showGridLines: true,
        gridColor: '',
        bgColor: '#d0d4de',
        textColor: '#000000',
      };
    }
  });

  useEffect(() => {
    localStorage.setItem('tv_chart_settings', JSON.stringify(chartSettings));
  }, [chartSettings]);

  // Settings Modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [themeColor, setThemeColor] = useState('#2962ff');

  // Workspace and View Mode States
  const [workspaceTab, setWorkspaceTab] = useState('chart'); // 'chart' only
  const [debugOverlayFilters, setDebugOverlayFilters] = useState({
    swings: true,
    liquidity: true,
    structure: true,
    dealingRanges: true,
    takenLiqOpacity: 0.25   // alpha for taken (terminated) liquidity lines
  });

  // Algo Candidate select / zones display states
  const [selectedConcept, setSelectedConcept] = useState('');
  const [showAlgoZones, setShowAlgoZones] = useState(true); // default to true since Narrative Mode is active
  const [algoCandidates, setAlgoCandidates] = useState([]);
  const [algoCandidates2, setAlgoCandidates2] = useState([]);
  const [selectedAlgoCandidate, setSelectedAlgoCandidate] = useState(null);
  const [displayMode, setDisplayMode] = useState('default');
  const [narrativeMode, setNarrativeMode] = useState(true); // default to narrative mode
  const [narrativeFocusRangeId, setNarrativeFocusRangeId] = useState(null);
  const [viewMode, setViewMode] = useState('narrative');
  const [isLayersDropdownOpen, setIsLayersDropdownOpen] = useState(false);
  const [analysisLayers, setAnalysisLayers] = useState({
    swings: true,
    liquidity: true,
    structure: true,
    dealingRanges: true,
    showHistoricalRanges: false,
    intent: true,
    delivery: true
  });

  const [dealingRangeCalc, setDealingRangeCalc] = useState({
    active: false,
    elapsed: 0,
    estimated: 1.8,
    progress: 0
  });

  const handleLayerToggle = (key, checked) => {
    if (key === 'dealingRanges' && checked) {
      setDealingRangeCalc({
        active: true,
        elapsed: 0,
        estimated: 1.8,
        progress: 0
      });

      const startTime = Date.now();
      const duration = 1800; // 1.8s

      const interval = setInterval(() => {
        const elapsedMs = Date.now() - startTime;
        const progress = Math.min(100, (elapsedMs / duration) * 100);
        const elapsed = (elapsedMs / 1000);
        const estimated = Math.max(0, (duration - elapsedMs) / 1000);

        setDealingRangeCalc(prev => ({
          ...prev,
          elapsed,
          estimated,
          progress
        }));

        if (elapsedMs >= duration) {
          clearInterval(interval);
          setDealingRangeCalc({ active: false, elapsed: 0, estimated: 0, progress: 0 });
          setAnalysisLayers(prev => ({ ...prev, dealingRanges: true }));
          setDebugOverlayFilters(prev => ({ ...prev, dealingRanges: true }));
        }
      }, 50);
    } else {
      setAnalysisLayers(prev => ({
        ...prev,
        [key]: checked
      }));
      if (key === 'dealingRanges') {
        setDebugOverlayFilters(prev => ({
          ...prev,
          dealingRanges: checked
        }));
      }
    }
  };

  // Chart initialized callback indicator
  const [chartInitialized, setChartInitialized] = useState(false);
  
  // Right sidebar tab: 'market' | 'research' | 'chat'
  const [rightSidebarTab, setRightSidebarTab] = useState('market');

  // Fullscreen/Full-canvas layout toggle
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // --- AI SWINGS (TradingView Pro toolbar toggle, NEW) ---
  // When enabled, fetches high-confidence swings from /api/ai/swings and passes
  // AI Swings removed — aiSwingEngine.js deleted

  const [replayMode, setReplayMode] = useState(false);
  const [replayTimeOffset, setReplayTimeOffset] = useState(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1000); // ms per advance
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const replayTimerRef = useRef(null);
  const lastReplayTimeRef = useRef((() => {
    const saved = localStorage.getItem('tv_last_replay_time');
    if (!saved) return null;
    return /^\d+$/.test(saved) ? parseInt(saved, 10) : saved;
  })());
  const forceViewportResetRef = useRef(true);

  // --- SUB-CANDLE REPLAY STATES ---
  const [replayTimeframeOption, setReplayTimeframeOption] = useState('1m');
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const [currentBarStates, setCurrentBarStates] = useState([]);
  const [currentSubStep, setCurrentSubStep] = useState(0);

  // --- DUAL TIMEFRAME SPLIT LAYOUT STATES ---
  const [layout, setLayout] = useState('single');
  const [timeframe2, setTimeframe2] = useState(15);
  const [allBars2, setAllBars2] = useState([]);

  const [loadingState1, setLoadingState1] = useState({ candles: false, events: false });
  const [loadingState2, setLoadingState2] = useState({ candles: false, events: false });
  const [chart1Ready, setChart1Ready] = useState(false);
  const [chart2Ready, setChart2Ready] = useState(false);

  const container2Ref = useRef(null);
  const chart2Ref = useRef(null);
  const series2Ref = useRef(null);
  const volume2Ref = useRef(null);
  const chartTarget2Ref = useRef(null);

  const [replayToolbarPos, setReplayToolbarPos] = useState(() => {
    return { x: Math.max(100, window.innerWidth / 2 - 200), y: Math.max(100, window.innerHeight - 110) };
  });
  const [isReplayDragging, setIsReplayDragging] = useState(false);
  const replayDragStartRef = useRef({ x: 0, y: 0 });

  const handleReplayDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('.replay-switch')) return;
    e.preventDefault();
    setIsReplayDragging(true);
    replayDragStartRef.current = {
      x: e.clientX - replayToolbarPos.x,
      y: e.clientY - replayToolbarPos.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isReplayDragging) return;
      setReplayToolbarPos({
        x: e.clientX - replayDragStartRef.current.x,
        y: e.clientY - replayDragStartRef.current.y
      });
    };

    const handleMouseUp = () => {
      setIsReplayDragging(false);
    };

    if (isReplayDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isReplayDragging]);

  const getReplayStepSeconds = (opt) => {
    if (opt.endsWith('s')) {
      return parseInt(opt, 10);
    }
    if (opt.endsWith('m')) {
      return parseInt(opt, 10) * 60;
    }
    return 60;
  };

  const generateSubCandleStates = (bar, N) => {
    const states = [];
    const isBullish = bar.close >= bar.open;
    const firstExtreme = isBullish ? bar.low : bar.high;
    const secondExtreme = isBullish ? bar.high : bar.low;
    
    for (let i = 1; i <= N; i++) {
      const pct = i / N;
      let currentClose = bar.open;
      let currentHigh = bar.open;
      let currentLow = bar.open;
      
      if (N <= 1) {
        currentClose = bar.close;
        currentHigh = bar.high;
        currentLow = bar.low;
      } else {
        if (pct <= 0.33) {
          const t = pct / 0.33;
          currentClose = bar.open + (firstExtreme - bar.open) * t;
        } else if (pct <= 0.66) {
          const t = (pct - 0.33) / 0.33;
          currentClose = firstExtreme + (secondExtreme - firstExtreme) * t;
        } else {
          const t = (pct - 0.66) / 0.34;
          currentClose = secondExtreme + (bar.close - secondExtreme) * t;
        }
        
        if (pct <= 0.33) {
          currentHigh = Math.max(bar.open, currentClose);
          currentLow = Math.min(bar.open, currentClose);
        } else if (pct <= 0.66) {
          currentHigh = Math.max(bar.open, firstExtreme, currentClose);
          currentLow = Math.min(bar.open, firstExtreme, currentClose);
        } else {
          currentHigh = Math.max(bar.open, firstExtreme, secondExtreme, currentClose);
          currentLow = Math.min(bar.open, firstExtreme, secondExtreme, currentClose);
        }
        
        if (i < N) {
          const wobble = (Math.random() - 0.5) * (bar.high - bar.low) * 0.03;
          currentClose += wobble;
          currentHigh = Math.max(currentHigh, currentClose);
          currentLow = Math.min(currentLow, currentClose);
        } else {
          currentClose = bar.close;
          currentHigh = bar.high;
          currentLow = bar.low;
        }
      }
      
      states.push({
        time: bar.time,
        open: bar.open,
        high: currentHigh,
        low: currentLow,
        close: currentClose,
        volume: Math.round(bar.volume * pct)
      });
    }
    return states;
  };


  // Replay sub-candle states sync hook
  useEffect(() => {
    if (replayMode && allBars.length > 0 && allBars[replayIndex - 1]) {
      const chartTfSec = timeframe * 60;
      const stepSec = getReplayStepSeconds(replayTimeframeOption);
      if (stepSec < chartTfSec) {
        const N = Math.round(chartTfSec / stepSec);
        const curBar = allBars[replayIndex - 1];
        const states = generateSubCandleStates(curBar, N);
        setCurrentBarStates(states);
        if (currentSubStep >= states.length) {
          setCurrentSubStep(states.length - 1);
        }
      } else {
        setCurrentBarStates([]);
        setCurrentSubStep(0);
      }
    } else {
      setCurrentBarStates([]);
      setCurrentSubStep(0);
    }
  }, [replayIndex, replayMode, timeframe, replayTimeframeOption, allBars]);



  // Track last replay timestamp to survive timeframe and symbol changes, and page reloads
  useEffect(() => {
    if (replayMode && replayIndex > 0 && allBars[replayIndex - 1]) {
      const t = allBars[replayIndex - 1].time;
      lastReplayTimeRef.current = t;
      localStorage.setItem('tv_last_replay_time', String(t));
    }
  }, [replayIndex, replayMode, allBars]);

  const lastViewSymbolRef = useRef('');
  const lastViewTimeframeRef = useRef(0);
  const lastViewReplayModeRef = useRef(false);

  const checkAndResetViewportChange = () => {
    const symbolChanged = lastViewSymbolRef.current !== activeSymbol;
    const timeframeChanged = lastViewTimeframeRef.current !== timeframe;
    const replayModeToggled = lastViewReplayModeRef.current !== replayMode;
    const forcedReset = forceViewportResetRef.current;

    lastViewSymbolRef.current = activeSymbol;
    lastViewTimeframeRef.current = timeframe;
    lastViewReplayModeRef.current = replayMode;

    if (forcedReset) {
      forceViewportResetRef.current = false;
    }

    return symbolChanged || timeframeChanged || replayModeToggled || forcedReset;
  };

  // --- CONTINUOUS ACTION HANDLER FOR ZOOM/SCROLL ---
  const startContinuousAction = (e, actionFn) => {
    if (e.button !== 0 && e.type === 'mousedown') return; // only left click
    e.preventDefault();
    actionFn();
    
    // Delay before repeating starts
    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(actionFn, 50);
      const stop = () => {
        clearInterval(intervalId);
        window.removeEventListener('mouseup', stop);
        window.removeEventListener('touchend', stop);
      };
      window.addEventListener('mouseup', stop);
      window.addEventListener('touchend', stop);
    }, 250);

    const stopImmediate = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mouseup', stopImmediate);
      window.removeEventListener('touchend', stopImmediate);
    };
    window.addEventListener('mouseup', stopImmediate);
    window.addEventListener('touchend', stopImmediate);
  };

  // --- STARTUP: Load symbols & settings ---
  useEffect(() => {
    // Restore saved replay mode if possible, respecting active session status
    const savedSession = localStorage.getItem('tv_backtest_session');
    const savedReplayMode = localStorage.getItem('tv_replay_mode');
    if (savedSession) {
      if (savedReplayMode === 'false') {
        setReplayMode(false);
      } else {
        setReplayMode(true);
      }
    } else {
      setReplayMode(savedReplayMode === 'true');
    }

    // Load preferences
    const prefs = loadPreferences();
    setMagnetMode(prefs.magnetMode);
    setLockDrawings(prefs.lockDrawings);
    setShowSessions(prefs.showSessions !== undefined ? prefs.showSessions : true);

    // Fetch symbols with retry
    const fetchSymbols = (retriesLeft = 15) => {
      fetch('/api/symbols')
        .then(res => res.json())
        .then(data => {
          setSymbols(data);
          if (data.length > 0) {
            // Check if there's a last used symbol, or default to first
            const savedSymbol = localStorage.getItem('tv_last_symbol');
            const defaultSym = data.includes(savedSymbol) ? savedSymbol : data[0];
            setActiveSymbol(defaultSym);
          }
        })
        .catch(err => {
          console.error(`Error loading symbols from backend (retries left: ${retriesLeft}): `, err);
          if (retriesLeft > 0) {
            setTimeout(() => fetchSymbols(retriesLeft - 1), 2000);
          }
        });
    };
    fetchSymbols();




    // Sync default tool styles when modified externally (e.g. from modal settings dropdown)
    const handleDefaultsChanged = () => {
      try {
        const saved = localStorage.getItem('tv_default_tool_styles');
        if (saved) {
          setDefaultToolStyles(JSON.parse(saved));
        }
      } catch (e) {
        console.error(e);
      }
    };
    window.addEventListener('tv_default_styles_changed', handleDefaultsChanged);
    return () => {
      window.removeEventListener('tv_default_styles_changed', handleDefaultsChanged);
    };
  }, []);


  // --- UNIFIED DATA & EVENT TRANSACTION PIPELINE FOR CHART 1 ---
  useEffect(() => {
    if (!activeSymbol) {
      setAllBars([]);
      setAlgoCandidates([]);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    // Show loading overlay and lock redraw completion flag
    setLoadingState1({ candles: true, events: true });
    setChart1Ready(false);

    const tfSec = timeframe * 60;
    const capturedOffset = replayTimeOffset;

    // 1. Candles URL — limit matches the selected bar window (Bars selector in toolbar).
    // The sliding-window cache handles subsequent pan/zoom fetches.
    const candleLimit = limitBarsInteractive > 0 ? Math.min(limitBarsInteractive, 80000) : 15000;
    let dataUrl;
    if (capturedOffset) {
      const startSec = capturedOffset - candleLimit * tfSec;
      const endSec   = capturedOffset + 500  * tfSec;
      dataUrl = `/api/data?symbol=${activeSymbol}&timeframe=${timeframe}&start=${startSec}&end=${endSec}&limit=${candleLimit}&mode=${activeResearchMode}`;
    } else {
      dataUrl = `/api/data?symbol=${activeSymbol}&timeframe=${timeframe}&limit=${candleLimit}&mode=${activeResearchMode}`;
    }

    // 2. Events URL — reduced from 15000 to 5000 for faster initial load.
    const limit = 5000;
    const conceptParam = '';
    let eventsUrl;
    if (capturedOffset) {
      const startSec = capturedOffset - 8000 * tfSec;
      const endSec   = capturedOffset + 500  * tfSec;
      eventsUrl = `/api/events?symbol=${activeSymbol}&timeframe=${timeframe}&concept=${conceptParam}&limit=${limit}&display_mode=${displayMode}&start=${startSec}&end=${endSec}&mode=${activeResearchMode}`;
    } else {
      eventsUrl = `/api/events?symbol=${activeSymbol}&timeframe=${timeframe}&concept=${conceptParam}&limit=${limit}&display_mode=${displayMode}&mode=${activeResearchMode}`;
    }

    // Fetch both datasets concurrently for an atomic transaction commit
    Promise.all([
      fetch(dataUrl, { signal }).then(res => res.json()),
      fetch(eventsUrl, { signal }).then(res => res.json())
    ])
    .then(([candlesData, eventsData]) => {
      // Pre-compute EST sessions once to prevent massive lag during 60fps rendering
      for (let i = 0; i < candlesData.length; i++) {
        const est = getESTInfo(candlesData[i].time);
        candlesData[i].estSession = est.session;
        candlesData[i].isMidnightOpen = est.isMidnightOpen;
        candlesData[i].isNewsOpen = est.isNewsOpen;
      }

      // Batch state commit in React 18 transition
      React.startTransition(() => {
        if (candlesData.length > 0) {
          const minTime = candlesData[0].time;
          const maxTime = candlesData[candlesData.length - 1].time;
          slidingWindowCache1.clear();
          slidingWindowCache1.setRange(activeSymbol, timeframe, activeResearchMode || 'interactive', minTime, maxTime, candlesData, eventsData || []);
        }
        setAllBars(candlesData);
        setAlgoCandidates(eventsData || []);
        setHudBar(null);

        if (capturedOffset) {
          let targetIndex = candlesData.findIndex(b => b.time >= capturedOffset);
          if (targetIndex === -1) targetIndex = Math.max(0, candlesData.length - 201);
          targetIndex = Math.max(50, targetIndex);
          setReplayIndex(targetIndex + 1);
          forceViewportResetRef.current = true;
        }

        setLoadingState1({ candles: false, events: false });
      });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error("Chart 1 transaction fetch failed:", err);
      setLoadingState1({ candles: false, events: false });
    });

    return () => {
      controller.abort();
    };
  }, [activeSymbol, timeframe, displayMode, replayTimeOffset]);

  // --- UNIFIED DATA & EVENT TRANSACTION PIPELINE FOR CHART 2 ---
  useEffect(() => {
    if (!activeSymbol || layout !== 'split') {
      setAllBars2([]);
      setAlgoCandidates2([]);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    setLoadingState2({ candles: true, events: true });
    setChart2Ready(false);

    let dataUrl = `/api/data?symbol=${activeSymbol}&timeframe=${timeframe2}&limit=10000&mode=${activeResearchMode}`;
    
    const limit = 15000;
    const conceptParam = '';
    let eventsUrl;
    if (replayTimeOffset) {
      const tfSec = timeframe2 * 60;
      const startSec = replayTimeOffset - 8000 * tfSec;
      const endSec   = replayTimeOffset + 500  * tfSec;
      eventsUrl = `/api/events?symbol=${activeSymbol}&timeframe=${timeframe2}&concept=${conceptParam}&limit=${limit}&display_mode=${displayMode}&start=${startSec}&end=${endSec}&mode=${activeResearchMode}`;
    } else {
      eventsUrl = `/api/events?symbol=${activeSymbol}&timeframe=${timeframe2}&concept=${conceptParam}&limit=${limit}&display_mode=${displayMode}&mode=${activeResearchMode}`;
    }

    Promise.all([
      fetch(dataUrl, { signal }).then(res => res.json()),
      fetch(eventsUrl, { signal }).then(res => res.json())
    ])
    .then(([candlesData, eventsData]) => {
      for(let i=0; i < candlesData.length; i++) {
        const est = getESTInfo(candlesData[i].time);
        candlesData[i].estSession = est.session;
        candlesData[i].isMidnightOpen = est.isMidnightOpen;
        candlesData[i].isNewsOpen = est.isNewsOpen;
      }

      React.startTransition(() => {
        if (candlesData.length > 0) {
          const minTime = candlesData[0].time;
          const maxTime = candlesData[candlesData.length - 1].time;
          slidingWindowCache2.clear();
          slidingWindowCache2.setRange(activeSymbol, timeframe2, activeResearchMode || 'interactive', minTime, maxTime, candlesData, eventsData || []);
        }
        setAllBars2(candlesData);
        setAlgoCandidates2(eventsData || []);
        setLoadingState2({ candles: false, events: false });
      });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error("Chart 2 transaction fetch failed:", err);
      setLoadingState2({ candles: false, events: false });
    });

    return () => {
      controller.abort();
    };
  }, [activeSymbol, timeframe2, layout, displayMode, replayTimeOffset]);

  // Upstream candidates filtering - ensures each chart only renders events belonging to its exact symbol and timeframe
  const filteredAlgoCandidates = useMemo(() => {
    const targetTf = Number(timeframe);
    const targetSymbol = activeSymbol ? activeSymbol.toLowerCase() : '';
    return algoCandidates.filter(c => 
      Number(c.timeframe) === targetTf && 
      (!c.symbol || !targetSymbol || c.symbol.toLowerCase() === targetSymbol)
    );
  }, [algoCandidates, timeframe, activeSymbol]);

  const filteredAlgoCandidates2 = useMemo(() => {
    const targetTf = Number(timeframe2);
    const targetSymbol = activeSymbol ? activeSymbol.toLowerCase() : '';
    return algoCandidates2.filter(c => 
      Number(c.timeframe) === targetTf && 
      (!c.symbol || !targetSymbol || c.symbol.toLowerCase() === targetSymbol)
    );
  }, [algoCandidates2, timeframe2, activeSymbol]);

  // Jump to specific timestamp and auto-center
  const handleJumpToTime = (timestamp) => {
    if (!chartRef.current || allBars.length === 0) return;
    const timeScale = chartRef.current.timeScale();
    const idx = allBars.findIndex(b => b.time >= timestamp);
    if (idx !== -1) {
      if (replayMode) {
        setReplayIndex(idx + 1);
        setCurrentSubStep(0);
      }
      chartRef.current.priceScale('right').applyOptions({ autoScale: true });
      setTimeout(() => {
        const width = 150;
        const margin = 50;
        timeScale.setVisibleLogicalRange({
          from: idx - (width - margin),
          to: idx + margin
        });
      }, 50);
    }
  };

  // Scroll viewport when selectedAlgoCandidate changes
  useEffect(() => {
    if (chartRef.current && selectedAlgoCandidate && allBars.length > 0) {
      setTimeout(() => {
        if (!chartRef.current) return;
        const timeScale = chartRef.current.timeScale();
        timeScale.setVisibleRange({
          from: selectedAlgoCandidate.time - 45 * (timeframe * 60),
          to: selectedAlgoCandidate.time + 30 * (timeframe * 60)
        });
      }, 80);
    }
  }, [selectedAlgoCandidate, allBars, timeframe]);

  // Save validation status
  const saveExplorerLabel = async (status, notes) => {
    if (!selectedAlgoCandidate) return;
    const cand = selectedAlgoCandidate;

    try {
      const res = await fetch(`/api/validations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: cand.id, status, notes })
      });
      if (!res.ok) throw new Error(await res.text());

      // Update local state in place
      const updatedValidation = { status, notes };
      setAlgoCandidates(prev => prev.map(c => c.id === cand.id ? { ...c, validation: updatedValidation } : c));
      setSelectedAlgoCandidate(prev => prev && prev.id === cand.id ? { ...prev, validation: updatedValidation } : prev);
    } catch (err) {
      console.error("Error saving validation:", err);
      alert("Error saving validation: " + err.message);
    }
  };

  // Save preferences on state change
  useEffect(() => {
    savePreferences({
      magnetMode,
      lockDrawings,
      showSessions
    });
  }, [magnetMode, lockDrawings, showSessions]);

  useEffect(() => {
    localStorage.setItem('tv_dark_mode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [isDarkMode]);

  // Sync chart options when isDarkMode, chartSettings, or chartInitialized changes
  useEffect(() => {
    if (chartRef.current) {
      const gridColor = chartSettings.showGridLines
        ? (chartSettings.gridColor || (isDarkMode ? '#2a2e39' : '#e1e4eb'))
        : 'transparent';
      const bgColor = chartSettings.bgColor || (isDarkMode ? '#131722' : '#f0f3fa');

      chartRef.current.applyOptions({
        layout: {
          background: { color: bgColor },
          textColor: chartSettings.textColor || (isDarkMode ? '#b2b5be' : '#70737d'),
        },
        grid: {
          vertLines: { color: gridColor, visible: chartSettings.showGridLines },
          horzLines: { color: gridColor, visible: chartSettings.showGridLines },
        },
        rightPriceScale: {
          borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        },
        timeScale: {
          borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        }
      });
    }
  }, [isDarkMode, chartSettings, chartInitialized]);

  // Load drawings whenever activeSymbol changes
  useEffect(() => {
    if (activeSymbol) {
      localStorage.setItem('tv_last_symbol', activeSymbol);
      const loaded = loadDrawings(activeSymbol).map((d, index) => ({
        ...d,
        id: d.id || `draw_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 9)}`,
        lineStyle: d.lineStyle || 'solid'
      }));
      setDrawings(loaded);
      setSelectedDrawing(null);
      setUndoStack([]);
      setRedoStack([]);
    }
  }, [activeSymbol]);

  // Save drawings whenever drawings changes (debounced)
  useEffect(() => {
    if (activeSymbol) {
      const timeoutId = setTimeout(() => {
        saveDrawings(activeSymbol, drawings);
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [drawings, activeSymbol]);

  // Primary candlestick fetching is handled by the unified transaction hook above

  // --- INITIALIZE LIGHTWEIGHT CHART ---
  useEffect(() => {
    if (!chartTargetRef.current) return;

    // Clear target container to avoid duplication on React StrictMode dual-mounts
    chartTargetRef.current.innerHTML = '';

    // Create chart instance
    const gridColor = chartSettings.showGridLines
      ? (chartSettings.gridColor || (isDarkMode ? '#2a2e39' : '#e1e4eb'))
      : 'transparent';

    const chart = createChart(chartTargetRef.current, {
      layout: {
        background: { color: chartSettings.bgColor || (isDarkMode ? '#131722' : '#f0f3fa') },
        textColor: chartSettings.textColor || (isDarkMode ? '#b2b5be' : '#70737d'),
        fontFamily: "'Outfit', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor, visible: chartSettings.showGridLines },
        horzLines: { color: gridColor, visible: chartSettings.showGridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          labelVisible: true,
          color: isDarkMode ? '#787b86' : '#9598a1',
          width: 1,
          style: 2,
          labelBackgroundColor: isDarkMode ? '#363a45' : '#9598a1',
        },
        horzLine: {
          visible: true,
          labelVisible: true,
          color: isDarkMode ? '#787b86' : '#9598a1',
          width: 1,
          style: 2,
          labelBackgroundColor: isDarkMode ? '#363a45' : '#9598a1',
        },
      },
      rightPriceScale: {
        borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        scaleMargins: { top: 0.08, bottom: 0.2 },
        ensureEdgeTickMarksVisible: true,
      },
      timeScale: {
        borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const d = new Date(time * 1000);
          const h = String(d.getUTCHours()).padStart(2, '0');
          const m = String(d.getUTCMinutes()).padStart(2, '0');
          // Show HH:MM for intraday, hide seconds always
          if (tickMarkType === 0) return `${h}:${m}`;
          if (tickMarkType === 1) return `${h}:${m}`;
          if (tickMarkType === 2) {
            const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${mon}-${day}`;
          }
          return `${h}:${m}`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    chartRef.current = chart;

    // Add Volume pane at the bottom — colored by candle direction (green up / red down)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    // Subscribe to crosshair move for HUD OHLCV
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHudBar(null);
        return;
      }
      
      const bars = allBarsRef.current;
      if (!bars || bars.length === 0) return;

      // Find matching bar
      const bar = bars.find(b => b.time === param.time);
      if (bar) {
        // Calculate price diff/change
        const chg = bar.close - bar.open;
        const pct = ((chg / bar.open) * 100).toFixed(2);
        setHudBar({
          ...bar,
          change: chg,
          percent: pct
        });
      }
    });



    // Resize observer to handle container size changes dynamically (essential for flex/grid layouts)
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && chartRef.current) {
          try {
            chart.resize(width, height);
          } catch (e) {
            console.error("Error resizing chart:", e);
          }
        }
      }
    });

    if (chartTargetRef.current) {
      resizeObserver.observe(chartTargetRef.current);
    }

    setChartInitialized(true);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        try {
          chart.remove();
        } catch (e) {
          console.error("Error removing chart:", e);
        }
        chartRef.current = null;
      }
      seriesRef.current = null;
      volumeRef.current = null;
      setChartInitialized(false);
    };
  }, []);

  // Secondary candlestick fetching is handled by the unified transaction hook above

  const [chart2Initialized, setChart2Initialized] = useState(false);
  const [series2UpdateTick, setSeries2UpdateTick] = useState(0);
  const chart2InitPendingRef = useRef(false);
  const [chart2MountTick, setChart2MountTick] = useState(0);

  // Deferred chart2 init trigger: when layout switches to 'split', the DOM container
  // renders on the next frame. We use a mount-tick state to re-trigger init.
  useEffect(() => {
    if (layout === 'split' && chart2InitPendingRef.current && chartTarget2Ref.current) {
      setChart2MountTick(t => t + 1); // Trigger re-render so init effect can proceed
    }
  }); // No dep array — runs after every render until pending is cleared

  // --- INITIALIZE SECONDARY CHART ---
  // We need a two-phase init: first render the DOM container (layout='split'),
  // then on next tick the ref is populated and we can call createChart().
  useEffect(() => {
    // When leaving split mode, destroy chart 2
    if (layout !== 'split') {
      if (chart2Ref.current) {
        try { chart2Ref.current.remove(); } catch (e) {}
        chart2Ref.current = null;
        series2Ref.current = null;
        volume2Ref.current = null;
        chart2InitPendingRef.current = false;
        setChart2Initialized(false);
      }
      return;
    }

    // DOM not ready yet — schedule deferred init
    if (!chartTarget2Ref.current) {
      chart2InitPendingRef.current = true;
      return;
    }

    // Already initialized for this layout session — apply theme changes only
    if (chart2Ref.current && !chart2InitPendingRef.current) {
      const gridColor = chartSettings.showGridLines
        ? (chartSettings.gridColor || (isDarkMode ? '#2a2e39' : '#e1e4eb'))
        : 'transparent';
      chart2Ref.current.applyOptions({
        layout: {
          background: { color: chartSettings.bgColor || (isDarkMode ? '#131722' : '#f0f3fa') },
          textColor: chartSettings.textColor || (isDarkMode ? '#b2b5be' : '#70737d'),
        },
        grid: {
          vertLines: { color: gridColor, visible: chartSettings.showGridLines },
          horzLines: { color: gridColor, visible: chartSettings.showGridLines },
        },
        rightPriceScale: { borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc' },
        timeScale: { borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc' },
      });
      return;
    }

    chartTarget2Ref.current.innerHTML = '';
    const gridColor = chartSettings.showGridLines
      ? (chartSettings.gridColor || (isDarkMode ? '#2a2e39' : '#e1e4eb'))
      : 'transparent';

    const chart2 = createChart(chartTarget2Ref.current, {
      layout: {
        background: { color: chartSettings.bgColor || (isDarkMode ? '#131722' : '#f0f3fa') },
        textColor: chartSettings.textColor || (isDarkMode ? '#b2b5be' : '#70737d'),
        fontFamily: "'Outfit', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor, visible: chartSettings.showGridLines },
        horzLines: { color: gridColor, visible: chartSettings.showGridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true, labelVisible: true,
          color: isDarkMode ? '#787b86' : '#9598a1', width: 1, style: 2,
          labelBackgroundColor: isDarkMode ? '#363a45' : '#9598a1',
        },
        horzLine: {
          visible: true, labelVisible: true,
          color: isDarkMode ? '#787b86' : '#9598a1', width: 1, style: 2,
          labelBackgroundColor: isDarkMode ? '#363a45' : '#9598a1',
        },
      },
      rightPriceScale: {
        borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        scaleMargins: { top: 0.08, bottom: 0.2 },
        ensureEdgeTickMarksVisible: true,
      },
      timeScale: {
        borderColor: isDarkMode ? '#2a2e39' : '#d1d4dc',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });

    chart2Ref.current = chart2;

    const volumeSeries2 = chart2.addSeries(HistogramSeries, {
      color: 'rgba(38, 166, 154, 0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart2.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volume2Ref.current = volumeSeries2;

    const resizeObserver2 = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && chart2Ref.current) {
          try {
            chart2Ref.current.resize(width, height);
          } catch (e) {
            console.error("Error resizing chart 2:", e);
          }
        }
      }
    });

    if (container2Ref.current) {
      resizeObserver2.observe(container2Ref.current);
    }

    chart2InitPendingRef.current = false;
    setChart2Initialized(true);

    return () => {
      resizeObserver2.disconnect();
      if (chart2Ref.current) {
        try {
          chart2Ref.current.remove();
        } catch (e) {}
        chart2Ref.current = null;
        series2Ref.current = null;
        volume2Ref.current = null;
        setChart2Initialized(false);
      }
    };
  }, [layout, isDarkMode, chartSettings, chart2MountTick]);

  // --- VIEWPORT-BASED QUERY ENGINE SLIDING WINDOW CACHE ---
  const getCulledEvents = (candidates, replayTime) => {
    if (!replayTime) return candidates;
    return candidates.filter(e => {
      const eStart = e.timeStart || e.time;
      return eStart <= replayTime;
    });
  };

  const fetchViewportSlice = async (chartId, from, to) => {
    const symbol = activeSymbol;
    const tf = chartId === 1 ? timeframe : timeframe2;
    const cache = chartId === 1 ? slidingWindowCache1 : slidingWindowCache2;
    const setBars = chartId === 1 ? setAllBars : setAllBars2;
    const setEvents = chartId === 1 ? setAlgoCandidates : setAlgoCandidates2;

    const tfSec = tf * 60;
    const queryStart = from - 1000 * tfSec;
    const queryEnd = to + 1000 * tfSec;

    try {
      const mode = activeResearchMode || 'interactive';
      const url = `/api/query/visible-window?symbol=${symbol}&timeframe=${tf}&start=${queryStart}&end=${queryEnd}&mode=${mode}`;
      
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.candles) {
        for (let i = 0; i < data.candles.length; i++) {
          const est = getESTInfo(data.candles[i].time);
          data.candles[i].estSession = est.session;
          data.candles[i].isMidnightOpen = est.isMidnightOpen;
          data.candles[i].isNewsOpen = est.isNewsOpen;
        }

        cache.setRange(symbol, tf, mode, queryStart, queryEnd, data.candles, data.candidates);
        const finalEvents = getCulledEvents(cache.candidates, replayTimeOffset);

        React.startTransition(() => {
          setBars(cache.candles);
          setEvents(finalEvents);
        });
      }
    } catch (e) {
      console.error(`Failed to fetch viewport slice for chart ${chartId}:`, e);
    }
  };

  const debouncedFetchSlice = useMemo(() => {
    return debounce((chartId, from, to) => {
      fetchViewportSlice(chartId, from, to);
    }, 150);
  }, [activeSymbol, timeframe, timeframe2, activeResearchMode, replayTimeOffset]);

  // --- TIME SCALE RANGE SYNCHRONIZATION ---
  const isSyncingRef = useRef(false);
  useEffect(() => {
    if (!chartInitialized || !chartRef.current) return;

    const timeScale1 = chartRef.current.timeScale();
    const timeScale2 = chart2Initialized && chart2Ref.current ? chart2Ref.current.timeScale() : null;

    const handleRangeChange1 = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        const range = timeScale1.getVisibleRange();
        if (range && range.from !== null && range.to !== null) {
          if (timeScale2) {
            timeScale2.setVisibleRange(range);
          }
          
          const cached = slidingWindowCache1.getRange(activeSymbol, timeframe, activeResearchMode, range.from, range.to);
          if (!cached) {
            debouncedFetchSlice(1, range.from, range.to);
          } else {
            React.startTransition(() => {
              setAlgoCandidates(getCulledEvents(slidingWindowCache1.candidates, replayTimeOffset));
            });
          }
        }
      } catch (e) {}
      isSyncingRef.current = false;
    };

    const handleRangeChange2 = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        if (!timeScale2) return;
        const range = timeScale2.getVisibleRange();
        if (range && range.from !== null && range.to !== null) {
          timeScale1.setVisibleRange(range);
          
          const cached = slidingWindowCache2.getRange(activeSymbol, timeframe2, activeResearchMode, range.from, range.to);
          if (!cached) {
            debouncedFetchSlice(2, range.from, range.to);
          } else {
            React.startTransition(() => {
              setAlgoCandidates2(getCulledEvents(slidingWindowCache2.candidates, replayTimeOffset));
            });
          }
        }
      } catch (e) {}
      isSyncingRef.current = false;
    };

    timeScale1.subscribeVisibleTimeRangeChange(handleRangeChange1);
    if (timeScale2) {
      timeScale2.subscribeVisibleTimeRangeChange(handleRangeChange2);
    }

    return () => {
      try {
        timeScale1.unsubscribeVisibleTimeRangeChange(handleRangeChange1);
      } catch (e) {}
      if (timeScale2) {
        try {
          timeScale2.unsubscribeVisibleTimeRangeChange(handleRangeChange2);
        } catch (e) {}
      }
    };
  }, [chartInitialized, chart2Initialized, activeSymbol, timeframe, timeframe2, activeResearchMode, replayTimeOffset]);

  // Local replay-time culling when scrubber position changes (zero network overhead!)
  useEffect(() => {
    if (!replayTimeOffset) {
      setAlgoCandidates(slidingWindowCache1.candidates);
      setAlgoCandidates2(slidingWindowCache2.candidates);
      return;
    }

    React.startTransition(() => {
      setAlgoCandidates(getCulledEvents(slidingWindowCache1.candidates, replayTimeOffset));
      setAlgoCandidates2(getCulledEvents(slidingWindowCache2.candidates, replayTimeOffset));
    });
  }, [replayTimeOffset]);

  // Trigger manual database sync
  const handleTriggerSync = async () => {
    try {
      userDismissedSyncRef.current = false;
      setIsProgressOverlayVisible(true);
      const res = await fetch(`/api/algo/sync?symbol=${activeSymbol}&trigger=true&mode=${activeResearchMode}&limitBars=${limitBarsInteractive}&force=true`);
      const data = await res.json();
      if (!data.success) {
        alert("Failed to start sync: " + data.message);
        setIsProgressOverlayVisible(false);
      }
    } catch (e) {
      console.error("Failed to trigger sync:", e);
      setIsProgressOverlayVisible(false);
    }
  };

  // Poll sync progress when running, and check on load
  useEffect(() => {
    let timer;
    let reloadTimer = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/algo/sync/progress?symbol=${activeSymbol}&mode=${activeResearchMode}`);
        const data = await res.json();
        if (data && data.success) {
          setSyncProgress(data);
          
          if (data.status === 'running') {
            if (!userDismissedSyncRef.current) {
              setIsProgressOverlayVisible(true);
            }
          } else if (data.status === 'completed' || data.status === 'error') {
            if (isProgressOverlayVisible && !reloadTimer) {
              clearInterval(timer);
              reloadTimer = setTimeout(() => {
                setIsProgressOverlayVisible(false);
                setSyncProgress(null);
                slidingWindowCache1.clear();
                slidingWindowCache2.clear();
                window.location.reload();
              }, 1500);
            }
          }
        }
      } catch (e) {
        console.error("Failed to poll sync progress:", e);
      }
    };

    poll();
    timer = setInterval(poll, isProgressOverlayVisible ? 1000 : 3000);
    return () => {
      clearInterval(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [isProgressOverlayVisible, activeSymbol, activeResearchMode]);

  // Fetch central config on load
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data && data.success && typeof data.analysisBars === 'number') {
          setLimitBarsInteractive(data.analysisBars);
        }
      } catch (e) {
        console.error("Failed to load central config:", e);
      }
    };
    fetchConfig();
  }, []);



  // --- REBUILD OR UPDATE CHART 2 SERIES ---
  const updateChart2Data = (bars) => {
    const chart2 = chart2Ref.current;
    if (!chart2) return;

    let displayBars = bars;
    if (replayMode) {
      const currentBar = allBars[replayIndex - 1];
      if (currentBar) {
        displayBars = aggregateDevelopingCandle(bars, allBars, timeframe2, currentBar.time);
      }
    }

    if (!series2Ref.current) {
      const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
      const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
      const borderUpColor = chartSettings.showCandleBorders ? (chartSettings.borderUpColor || chartSettings.upColor || '#089981') : 'transparent';
      const borderDownColor = chartSettings.showCandleBorders ? (chartSettings.borderDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
      const wickUpColor = chartSettings.showCandleWicks ? (chartSettings.wickUpColor || chartSettings.upColor || '#089981') : 'transparent';
      const wickDownColor = chartSettings.showCandleWicks ? (chartSettings.wickDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';

      if (chartType === 'candle') {
        series2Ref.current = chart2.addSeries(CandlestickSeries, {
          upColor,
          downColor,
          wickVisible: chartSettings.showCandleWicks,
          borderVisible: chartSettings.showCandleBorders,
          borderUpColor,
          borderDownColor,
          wickUpColor,
          wickDownColor,
          priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
        });
      } else if (chartType === 'bar') {
        series2Ref.current = chart2.addSeries(BarSeries, { upColor, downColor, priceFormat: { type: 'price', precision: 2, minMove: 0.25 } });
      } else {
        series2Ref.current = chart2.addSeries(LineSeries, { color: themeColor, lineWidth: 2 });
      }
      setSeries2UpdateTick(t => t + 1);
    } else {
      if (chartType === 'candle') {
        const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
        const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        const borderUpColor = chartSettings.showCandleBorders ? (chartSettings.borderUpColor || chartSettings.upColor || '#089981') : 'transparent';
        const borderDownColor = chartSettings.showCandleBorders ? (chartSettings.borderDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        const wickUpColor = chartSettings.showCandleWicks ? (chartSettings.wickUpColor || chartSettings.upColor || '#089981') : 'transparent';
        const wickDownColor = chartSettings.showCandleWicks ? (chartSettings.wickDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';

        series2Ref.current.applyOptions({
          upColor,
          downColor,
          wickVisible: chartSettings.showCandleWicks,
          borderVisible: chartSettings.showCandleBorders,
          borderUpColor,
          borderDownColor,
          wickUpColor,
          wickDownColor,
        });
      } else if (chartType === 'bar') {
        const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
        const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        series2Ref.current.applyOptions({ upColor, downColor });
      } else if (chartType === 'line') {
        series2Ref.current.applyOptions({ color: themeColor });
      }
    }

    const data = chartType === 'line'
      ? displayBars.map(b => ({ time: b.time, value: b.close }))
      : displayBars;

    series2Ref.current.setData(data);

    if (volume2Ref.current) {
      volume2Ref.current.setData(displayBars.map(b => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open
          ? 'rgba(38, 166, 154, 0.5)'
          : 'rgba(239, 83, 80, 0.5)'
      })));
    }
  };

  useEffect(() => {
    if (chart2Initialized && allBars2.length > 0) {
      updateChart2Data(allBars2);
    }
  }, [chart2Initialized, chartType, themeColor, isDarkMode, chartSettings, replayMode, replayIndex, allBars, allBars2]);

  useEffect(() => {
    if (volume2Ref.current) {
      volume2Ref.current.applyOptions({ visible: showVolume });
    }
  }, [showVolume]);

  // Sync state refs to callbacks
  const allBarsRef = useRef(allBars);
  allBarsRef.current = allBars;

  const [seriesUpdateTick, setSeriesUpdateTick] = useState(0);


  const currentTfRef = useRef(timeframe);
  currentTfRef.current = timeframe;

  // Ref to track which chart type is currently created
  const currentChartTypeRef = useRef(null);

  // --- REBUILD OR UPDATE SERIES ---
  const updateChartData = (bars) => {
    const chart = chartRef.current;
    if (!chart) return;

    // Filter bars if we are in replay mode or an active training session
    let displayBars = bars;
    if (replayMode) {
      if (currentBarStates && currentBarStates.length > 0 && currentSubStep < currentBarStates.length) {
        displayBars = [...bars.slice(0, replayIndex - 1), currentBarStates[currentSubStep]];
      } else {
        displayBars = bars.slice(0, replayIndex);
      }
    }

    // Only recreate series if chart type actually changed or doesn't exist
    if (!seriesRef.current || currentChartTypeRef.current !== chartType) {
      // Remove existing main series
      if (seriesRef.current) {
        try {
          chart.removeSeries(seriesRef.current);
        } catch (e) {}
      }

      // Add appropriate series
      const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
      const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
      const borderUpColor = chartSettings.showCandleBorders ? (chartSettings.borderUpColor || chartSettings.upColor || '#089981') : 'transparent';
      const borderDownColor = chartSettings.showCandleBorders ? (chartSettings.borderDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
      const wickUpColor = chartSettings.showCandleWicks ? (chartSettings.wickUpColor || chartSettings.upColor || '#089981') : 'transparent';
      const wickDownColor = chartSettings.showCandleWicks ? (chartSettings.wickDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';

      if (chartType === 'candle') {
        seriesRef.current = chart.addSeries(CandlestickSeries, {
          upColor: upColor,
          downColor: downColor,
          wickVisible: chartSettings.showCandleWicks,
          borderVisible: chartSettings.showCandleBorders,
          borderUpColor: borderUpColor,
          borderDownColor: borderDownColor,
          wickUpColor: wickUpColor,
          wickDownColor: wickDownColor,
          priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
        });
      } else if (chartType === 'bar') {
        seriesRef.current = chart.addSeries(BarSeries, {
          upColor: upColor,
          downColor: downColor,
          priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
        });
      } else {
        seriesRef.current = chart.addSeries(LineSeries, {
          color: themeColor,
          lineWidth: 2,
        });
      }

      currentChartTypeRef.current = chartType;
      // Force re-render so DrawingCanvas gets the new series reference
      setSeriesUpdateTick(t => t + 1);
    } else {
      // Apply options dynamically to existing series in-place
      if (chartType === 'candle') {
        const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
        const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        const borderUpColor = chartSettings.showCandleBorders ? (chartSettings.borderUpColor || chartSettings.upColor || '#089981') : 'transparent';
        const borderDownColor = chartSettings.showCandleBorders ? (chartSettings.borderDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        const wickUpColor = chartSettings.showCandleWicks ? (chartSettings.wickUpColor || chartSettings.upColor || '#089981') : 'transparent';
        const wickDownColor = chartSettings.showCandleWicks ? (chartSettings.wickDownColor || chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';

        seriesRef.current.applyOptions({
          upColor: upColor,
          downColor: downColor,
          wickVisible: chartSettings.showCandleWicks,
          borderVisible: chartSettings.showCandleBorders,
          borderUpColor: borderUpColor,
          borderDownColor: borderDownColor,
          wickUpColor: wickUpColor,
          wickDownColor: wickDownColor,
        });
      } else if (chartType === 'bar') {
        const upColor = chartSettings.showCandleBody ? (chartSettings.upColor || '#089981') : 'transparent';
        const downColor = chartSettings.showCandleBody ? (chartSettings.downColor || (isDarkMode ? '#f23645' : '#131722')) : 'transparent';
        seriesRef.current.applyOptions({
          upColor: upColor,
          downColor: downColor,
        });
      } else if (chartType === 'line') {
        seriesRef.current.applyOptions({ color: themeColor });
      }
    }

    // Map and load bars data
    const data = chartType === 'line'
      ? displayBars.map(b => ({ time: b.time, value: b.close }))
      : displayBars;

    seriesRef.current.setData(data);

    // Map and load volume — consistent colors matching candle direction
    if (volumeRef.current) {
      volumeRef.current.setData(displayBars.map(b => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open
          ? 'rgba(38, 166, 154, 0.5)'   // teal (matches bull candles)
          : 'rgba(239, 83, 80, 0.5)'    // red (matches bear candles)
      })));
    }

    if (!replayMode) {
      if (displayBars.length > 300) {
        const didReset = checkAndResetViewportChange();
        if (didReset) {
          setTimeout(() => {
            if (chartRef.current && displayBars.length > 0) {
              const timeScale = chartRef.current.timeScale();
              timeScale.setVisibleRange({
                from: displayBars[Math.max(0, displayBars.length - 150)].time,
                to: displayBars[displayBars.length - 1].time
              });
            }
          }, 50);
        }
      } else {
        chart.timeScale().fitContent();
      }
    } else if (replayMode) {
      const timeScale = chart.timeScale();
      const didReset = checkAndResetViewportChange();

      if (didReset) {
        // Initial zoom and center on the replay start bar with right margins
        setTimeout(() => {
          if (chartRef.current && displayBars.length > 0) {
            // Force price auto-scale to ensure candles are visible vertically
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });

            const curIndex = displayBars.length - 1;
            const width = 150; // show 150 bars
            const rightMargin = 30; // 30 blank bars lookahead
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: curIndex - (width - rightMargin),
              to: curIndex + rightMargin
            });
          }
        }, 50);
      } else {
        // Step forward / play ticks: scroll ONLY when candle gets near the right edge
        const range = timeScale.getVisibleLogicalRange();
        if (range && displayBars.length > 0) {
          const curIndex = displayBars.length - 1;
          const rightMargin = 30; // keep 30 blank bars margin when scrolling
          if (curIndex > range.to - 5) {
            const width = range.to - range.from;
            const newTo = curIndex + rightMargin;
            timeScale.setVisibleLogicalRange({
              from: newTo - width,
              to: newTo
            });
          }
        }
      }
    }
  };

  useEffect(() => {
    if (chartInitialized && allBars.length > 0) {
      updateChartData(allBars);
    }
  }, [chartType, themeColor, isDarkMode, chartSettings, replayMode, replayIndex, allBars, currentSubStep, currentBarStates]);

  // Toggle volume series visibility
  useEffect(() => {
    if (volumeRef.current) {
      volumeRef.current.applyOptions({ visible: showVolume });
    }
  }, [showVolume]);

  // --- REPLAY CONTROLS ---
  const handleExitReplay = () => {
    localStorage.removeItem('tv_replay_mode');
    localStorage.removeItem('tv_last_replay_time');
    setReplayMode(false);
    setIsReplayPlaying(false);
    setReplayTimeOffset(null);
    lastReplayTimeRef.current = null;
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
    }
    setTimeout(() => {
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }, 50);
  };

  const handleStartReplay = () => {
    if (allBars.length === 0) return;
    lastReplayTimeRef.current = null;
    localStorage.removeItem('tv_last_replay_time');
    forceViewportResetRef.current = true;
    setReplayMode(true);
    localStorage.setItem('tv_replay_mode', 'true');
    setIsReplayPlaying(false);

    // Pick a start point: try to use the center of the current visible range,
    // or fall back to 200 bars back from the end of the loaded dataset.
    let targetTime = null;
    if (chartRef.current && allBars.length > 0) {
      try {
        const range = chartRef.current.timeScale().getVisibleLogicalRange();
        if (range) {
          const midIdx = Math.round((range.from + range.to) / 2);
          const clampedIdx = Math.max(0, Math.min(allBars.length - 1, midIdx));
          targetTime = allBars[clampedIdx].time;
        }
      } catch (e) {}
    }
    if (!targetTime && allBars.length > 0) {
      const startIndex = Math.max(50, allBars.length - 200);
      targetTime = allBars[startIndex - 1].time;
    }

    // Setting replayTimeOffset triggers a windowed data reload (history behind target)
    setReplayTimeOffset(targetTime);
  };

  const toggleReplayPlay = () => {
    setIsReplayPlaying(prev => !prev);
  };

  const handleDateJump = (dateString) => {
    if (!dateString) return;
    const targetDate = new Date(dateString + 'T00:00:00');
    const targetSeconds = Math.floor(targetDate.getTime() / 1000);
    // Setting replayTimeOffset triggers a windowed data reload centered on this date.
    // The data-fetch effect will then find the correct bar and set replayIndex.
    setCurrentSubStep(0);
    forceViewportResetRef.current = true;
    setReplayTimeOffset(targetSeconds);
  };

  const currentReplayDateString = useMemo(() => {
    const currentBar = allBars[replayIndex - 1];
    if (!currentBar) return '';
    const d = new Date(currentBar.time * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [allBars, replayIndex]);

  const handleStepForward = () => {
    if (replayIndex >= allBars.length) return;

    const chartTfSec = timeframe * 60;
    const stepSec = getReplayStepSeconds(replayTimeframeOption);

    if (stepSec < chartTfSec) {
      // Sub-candle mode
      const N = Math.round(chartTfSec / stepSec);
      if (currentSubStep < N - 1) {
        setCurrentSubStep(currentSubStep + 1);
      } else {
        const next = replayIndex + 1;
        if (next <= allBars.length) {
          setReplayIndex(next);
          setCurrentSubStep(0);
          const nextBar = allBars[next - 1];
          if (nextBar) {
            const nextN = Math.round(chartTfSec / stepSec);
            setCurrentBarStates(generateSubCandleStates(nextBar, nextN));
          }
        }
      }
    } else {
      // Multi-bar step mode
      const K = Math.floor(stepSec / chartTfSec) || 1;
      setReplayIndex(Math.min(allBars.length, replayIndex + K));
      setCurrentSubStep(0);
      setCurrentBarStates([]);
    }
  };

  const handleStepBack = () => {
    const chartTfSec = timeframe * 60;
    const stepSec = getReplayStepSeconds(replayTimeframeOption);

    if (stepSec < chartTfSec) {
      // Sub-candle mode
      if (currentSubStep > 0) {
        setCurrentSubStep(prev => prev - 1);
      } else {
        if (replayIndex <= 1) return;
        const prevIdx = replayIndex - 1;
        setReplayIndex(prevIdx);
        const N = Math.round(chartTfSec / stepSec);
        setCurrentSubStep(N - 1);
        const prevBar = allBars[prevIdx - 1];
        if (prevBar) {
          const prevStates = generateSubCandleStates(prevBar, N);
          setCurrentBarStates(prevStates);
        }
      }
    } else {
      // Multi-bar step mode
      const K = Math.floor(stepSec / chartTfSec) || 1;
      setReplayIndex(prev => Math.max(1, prev - K));
      setCurrentSubStep(0);
      setCurrentBarStates([]);
    }
  };

  useEffect(() => {
    if (replayMode && isReplayPlaying) {
      replayTimerRef.current = setInterval(() => {
        handleStepForward();
      }, replaySpeed);
    } else {
      if (replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
      }
    }
    return () => {
      if (replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
      }
    };
  }, [replayMode, isReplayPlaying, replaySpeed, allBars, replayIndex, currentSubStep, replayTimeframeOption, timeframe, currentBarStates]);

  // --- REPLAY KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      )) {
        return;
      }

      if (!replayMode) return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleReplayPlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleStepForward();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStepBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [replayMode, isReplayPlaying, allBars, replayIndex, currentSubStep, replayTimeframeOption, timeframe, currentBarStates]);

  // --- UNDO / REDO MANAGERS ---
  const handleAddUndoState = () => {
    setUndoStack([...undoStack, JSON.stringify(drawings)]);
    setRedoStack([]); // Clear redo
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack([...redoStack, JSON.stringify(drawings)]);
    setDrawings(JSON.parse(previous));
    setUndoStack(undoStack.slice(0, -1));
    setSelectedDrawing(null);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack([...undoStack, JSON.stringify(drawings)]);
    setDrawings(JSON.parse(next));
    setRedoStack(redoStack.slice(0, -1));
    setSelectedDrawing(null);
  };

  // Clear all drawings
  const handleClearAll = () => {
    handleAddUndoState();
    setDrawings([]);
    setSelectedDrawing(null);
  };

  // Sessions shading is handled internally inside the DrawingCanvas component

  // Quick Bottom Timeframe scaling
  const handleBottomTimeScale = (days) => {
    if (!chartRef.current || allBars.length === 0) return;
    const timeScale = chartRef.current.timeScale();
    
    // Zoom time scale to show only the last X days of bars
    const barDuration = timeframe * 60;
    const count = Math.round((days * 24 * 3600) / barDuration);
    
    const visibleRange = {
      from: Math.max(0, allBars.length - count),
      to: allBars.length - 1
    };
    timeScale.setVisibleRange({
      from: allBars[visibleRange.from].time,
      to: allBars[visibleRange.to].time
    });
  };

  // --- FLOATING CHART NAVIGATION HANDLERS ---
  const handleZoomIn = () => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const current = timeScale.options().barSpacing;
    timeScale.applyOptions({ barSpacing: Math.min(50, current * 1.05) });
  };

  const handleZoomOut = () => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const current = timeScale.options().barSpacing;
    timeScale.applyOptions({ barSpacing: Math.max(0.5, current * 0.95) });
  };

  const handleScrollLeft = () => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (range) {
      const shift = Math.max(1, (range.to - range.from) * 0.05);
      timeScale.setVisibleLogicalRange({
        from: range.from - shift,
        to: range.to - shift
      });
    }
  };

  const handleScrollRight = () => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (range) {
      const shift = Math.max(1, (range.to - range.from) * 0.05);
      timeScale.setVisibleLogicalRange({
        from: range.from + shift,
        to: range.to + shift
      });
    }
  };

  const handleResetScale = () => {
    if (!chartRef.current) return;
    chartRef.current.priceScale('right').applyOptions({ autoScale: true });
    if (replayMode) {
      chartRef.current.timeScale().scrollToRealTime();
    } else {
      chartRef.current.timeScale().resetTimeScale();
    }
  };

  // --- LOW-LATENCY CROSS-CHART CROSSHAIR SYNCHRONIZATION BUS ---
  const suppressCrosshairSyncRef = useRef(false);

  useEffect(() => {
    const chart1 = chartRef.current;
    const chart2 = chart2Ref.current;
    const series1 = seriesRef.current;
    const series2 = series2Ref.current;

    if (!chart1) return;

    // 1. Subscribe to crosshair bus updates
    const unsubscribeBus = ChartEventBus.subscribe((event) => {
      if (event.type !== 'CrosshairMove') return;

      const { time, price, sourceId } = event.payload;
      suppressCrosshairSyncRef.current = true;

      try {
        if (sourceId === 'chart1' && chart2 && series2) {
          if (time === null) {
            chart2.clearCrosshairPosition();
          } else {
            chart2.setCrosshairPosition(price || 0, time, series2);
          }
        } else if (sourceId === 'chart2' && chart1 && series1) {
          if (time === null) {
            chart1.clearCrosshairPosition();
          } else {
            chart1.setCrosshairPosition(price || 0, time, series1);
          }
        }
      } catch (err) {
        // Ignored: scale boundary mismatches or missing series reference
      }

      suppressCrosshairSyncRef.current = false;
    });

    // 2. Publish crosshair position from Chart 1
    const handleChart1CrosshairMove = (param) => {
      if (suppressCrosshairSyncRef.current) return;

      if (!param.time) {
        ChartEventBus.emit({
          type: 'CrosshairMove',
          payload: { time: null, price: null, sourceId: 'chart1' },
          sourceId: 'chart1'
        });
        return;
      }

      const price = param.seriesData.get(series1)?.close || null;
      ChartEventBus.emit({
        type: 'CrosshairMove',
        payload: { time: param.time, price, sourceId: 'chart1' },
        sourceId: 'chart1'
      });
    };

    chart1.subscribeCrosshairMove(handleChart1CrosshairMove);

    // 3. Publish crosshair position from Chart 2
    let handleChart2CrosshairMove = null;
    if (chart2 && series2) {
      handleChart2CrosshairMove = (param) => {
        if (suppressCrosshairSyncRef.current) return;

        if (!param.time) {
          ChartEventBus.emit({
            type: 'CrosshairMove',
            payload: { time: null, price: null, sourceId: 'chart2' },
            sourceId: 'chart2'
          });
          return;
        }

        const price = param.seriesData.get(series2)?.close || null;
        ChartEventBus.emit({
          type: 'CrosshairMove',
          payload: { time: param.time, price, sourceId: 'chart2' },
          sourceId: 'chart2'
        });
      };
      chart2.subscribeCrosshairMove(handleChart2CrosshairMove);
    }

    return () => {
      unsubscribeBus();
      if (chart1) {
        chart1.unsubscribeCrosshairMove(handleChart1CrosshairMove);
      }
      if (chart2 && handleChart2CrosshairMove) {
        chart2.unsubscribeCrosshairMove(handleChart2CrosshairMove);
      }
    };
  }, [chartInitialized, chart2Initialized, seriesUpdateTick, series2UpdateTick, layout]);

  // AI Swings fetch removed — aiSwingEngine deleted

  // --- BOTTOM STATUS BAR DERIVED DATA ---
  // Last price + change vs previous close (uses chart's last bar; respects replay position).
  const lastBarForStatus = useMemo(() => {
    if (!allBars || allBars.length === 0) return null;
    if (replayMode && replayIndex > 0) return allBars[replayIndex - 1];
    return allBars[allBars.length - 1];
  }, [allBars, replayMode, replayIndex]);

  const prevBarForStatus = useMemo(() => {
    if (!allBars || allBars.length < 2) return null;
    if (replayMode && replayIndex > 1) return allBars[replayIndex - 2];
    return allBars[allBars.length - 2];
  }, [allBars, replayMode, replayIndex]);

  const lastPrice = lastBarForStatus?.close ?? null;
  const priceChange = (lastBarForStatus && prevBarForStatus)
    ? lastBarForStatus.close - prevBarForStatus.close
    : null;
  const priceChangePct = (lastBarForStatus && prevBarForStatus && prevBarForStatus.close !== 0)
    ? (priceChange / prevBarForStatus.close) * 100
    : null;

  // Current ICT session label (computed from wall-clock time in EST).
  const sessionLabel = useMemo(() => {
    const info = getESTInfo(Math.floor(Date.now() / 1000));
    if (info.session === 'london') return 'London Session';
    if (info.session === 'ny-am') return 'NY AM Session';
    if (info.session === 'ny-pm') return 'NY PM Session';
    return 'Off-session';
  }, []);

  // Timeframe label for status bar (e.g. "1m", "5m", "1H", "1D")
  const tfLabel = useMemo(() => {
    if (timeframe < 60) return `${timeframe}m`;
    if (timeframe === 60) return '1H';
    if (timeframe < 1440) return `${Math.floor(timeframe / 60)}H`;
    if (timeframe === 1440) return '1D';
    return `${Math.floor(timeframe / 1440)}D`;
  }, [timeframe]);

  return (
    <div className={`app-container ${isFullscreen ? 'full-canvas' : ''}`}>
      {/* TOP TOOLBAR */}
      <header className="top-toolbar">
        {/* LEFT: Logo wordmark (no emoji) */}
        <div className="logo">
          PDOS<span className="logo-dot" />
        </div>

        {/* Workspace segmented control — Chart only in Analysis Mode */}
        <div className="workspace-segmented">
          <button
            className="workspace-segmented-btn active"
          >
            Chart
          </button>
        </div>

        <div className="divider" />

        {/* Symbol selector (dark, no native chrome, custom arrow) */}
        <select
          className="symbol-selector"
          value={activeSymbol}
          onChange={(e) => setActiveSymbol(e.target.value)}
          title="Symbol"
        >
          {symbols.map(sym => (
            <option key={sym} value={sym}>{sym.toUpperCase()}</option>
          ))}
        </select>

        <div className="divider" />

        {/* Timeframe ribbon (pill group, 11px, 24px height) */}
        <div className="tf-ribbon">
          {[
            { label: '1m', val: 1 },
            { label: '3m', val: 3 },
            { label: '5m', val: 5 },
            { label: '15m', val: 15 },
            { label: '30m', val: 30 },
            { label: '1H', val: 60 },
            { label: '4H', val: 240 },
            { label: '1D', val: 1440 }
          ].map(item => (
            <button
              key={item.label}
              className={`toolbar-btn ${timeframe === item.val ? 'active' : ''}`}
              onClick={() => setTimeframe(item.val)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="divider" />

        {/* Chart type icons (icon-only, 28px square) */}
        <div className="toolbar-cluster">
          <button
            className={`chart-type-btn ${chartType === 'candle' ? 'active' : ''}`}
            onClick={() => setChartType('candle')}
            title="Candlestick Chart"
          >
            <CandlestickChart size={14} />
          </button>
          <button
            className={`chart-type-btn ${chartType === 'bar' ? 'active' : ''}`}
            onClick={() => setChartType('bar')}
            title="Bar Chart"
          >
            <BarChart3 size={14} />
          </button>
          <button
            className={`chart-type-btn ${chartType === 'line' ? 'active' : ''}`}
            onClick={() => setChartType('line')}
            title="Line Chart"
          >
            <LineChart size={14} />
          </button>
        </div>

        {/* RIGHT CLUSTER */}
        <div className="toolbar-cluster-right">
          {/* Layout toggle (split / single) */}
          <button
            className={`icon-btn-square ${layout === 'split' ? 'active' : ''}`}
            onClick={() => setLayout(l => l === 'single' ? 'split' : 'single')}
            title="Toggle Split Screen Layout (Dual Timeframe)"
          >
            {layout === 'split' ? <Square size={14} /> : <LayoutGrid size={14} />}
          </button>

          {/* TF2 selector (when split layout) */}
          {layout === 'split' && (
            <select
              className="symbol-selector compact"
              value={timeframe2}
              onChange={(e) => setTimeframe2(Number(e.target.value))}
              title="Secondary Timeframe"
            >
              {[
                { label: '1m', val: 1 },
                { label: '3m', val: 3 },
                { label: '5m', val: 5 },
                { label: '15m', val: 15 },
                { label: '30m', val: 30 },
                { label: '1H', val: 60 },
                { label: '4H', val: 240 },
                { label: '1D', val: 1440 }
              ].map(item => (
                <option key={item.val} value={item.val}>{item.label}</option>
              ))}
            </select>
          )}

          {/* ICT Sessions toggle */}
          <button
            className={`icon-btn-square ${showSessions ? 'active' : ''}`}
            onClick={() => setShowSessions(!showSessions)}
            title="Toggle Midnight/8:30 opens & Session highlights"
          >
            <Clock size={14} />
          </button>

          {/* Swings toggle */}
          <button
            className={`icon-btn-square ${debugOverlayFilters.swings ? 'active' : ''}`}
            onClick={() => setDebugOverlayFilters(f => ({ ...f, swings: !f.swings }))}
            title="Toggle Swing pivot rendering (STH/ITH/LTH & STL/ITL/LTL)"
          >
            <TrendingUp size={14} />
          </button>

          {/* Liquidity toggle */}
          <button
            className={`icon-btn-square ${debugOverlayFilters.liquidity ? 'active' : ''}`}
            onClick={() => setDebugOverlayFilters(f => ({ ...f, liquidity: !f.liquidity }))}
            title="Toggle Liquidity line rendering (BSL / SSL)"
          >
            <Droplets size={14} />
          </button>

          {/* Taken-liquidity opacity slider (only when liquidity overlay enabled) */}
          {debugOverlayFilters.liquidity && (
            <div className="opacity-group" title="Opacity of taken (terminated) liquidity lines">
              <span className="opacity-group-label">Taken</span>
              <input
                type="range"
                min="0.25"
                max="0.70"
                step="0.05"
                value={debugOverlayFilters.takenLiqOpacity ?? 0.25}
                onChange={e =>
                  setDebugOverlayFilters(f => ({ ...f, takenLiqOpacity: parseFloat(e.target.value) }))
                }
                className="opacity-slider"
              />
              <span className="opacity-group-value">
                {Math.round((debugOverlayFilters.takenLiqOpacity ?? 0.25) * 100)}%
              </span>
            </div>
          )}

          {/* Volume toggle */}
          <button
            className={`icon-btn-square ${showVolume ? 'active' : ''}`}
            onClick={() => setShowVolume(v => !v)}
            title="Toggle Volume"
          >
            <BarChart2 size={14} />
          </button>


          {/* Replay toggle */}
          <button
            className={`icon-btn-square ${replayMode ? 'active' : ''}`}
            onClick={() => {
              if (replayMode) {
                handleExitReplay();
              } else {
                handleStartReplay();
              }
            }}
            title="Toggle Replay Mode"
          >
            <History size={14} />
          </button>

          {/* Undo / Redo */}
          <button
            className="icon-btn-square"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            className="icon-btn-square"
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </button>

          {/* View mode segmented (Narrative / Analysis / Debug) */}
          <div className="viewmode-segmented">
            <button
              className={`viewmode-btn ${viewMode === 'narrative' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('narrative');
                setNarrativeMode(true);
                setShowAlgoZones(true);
              }}
              title="Narrative view mode"
            >
              Narrative
            </button>
            <button
              className={`viewmode-btn ${viewMode === 'analysis' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('analysis');
                setNarrativeMode(false);
                setShowAlgoZones(true);
              }}
              title="Analysis view mode"
            >
              Analysis
            </button>
            <button
              className={`viewmode-btn debug ${viewMode === 'debug' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('debug');
                setNarrativeMode(false);
                setShowAlgoZones(true);
              }}
              title="Debug view mode"
            >
              Debug
            </button>
          </div>

          {/* Layers dropdown */}
          <div className="layers-wrap">
            <button
              className="layers-btn"
              onClick={() => setIsLayersDropdownOpen(!isLayersDropdownOpen)}
              title="Toggle analysis layer visibility"
            >
              <span>Layers</span>
              <ChevronDown size={10} />
            </button>
            {isLayersDropdownOpen && (
              <div className="layers-menu">
                {[
                  { key: 'swings', label: 'Swings' },
                  { key: 'liquidity', label: 'Liquidity' },
                  { key: 'structure', label: 'Structure' },
                  { key: 'dealingRanges', label: 'Dealing Ranges' },
                  { key: 'showHistoricalRanges', label: 'Show Historical Ranges' },
                  { key: 'intent', label: 'Intent' },
                  { key: 'delivery', label: 'Delivery' }
                ].map(item => (
                  <label key={item.key}>
                    <input
                      type="checkbox"
                      checked={analysisLayers[item.key]}
                      onChange={(e) => {
                        handleLayerToggle(item.key, e.target.checked);
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Zones toggle (only when a concept is selected) */}
          {selectedConcept && (
            <button
              className={`toolbar-btn ${showAlgoZones ? 'active' : ''}`}
              onClick={() => setShowAlgoZones(v => !v)}
              title="Toggle Auto-detected Candidate Zones on Chart"
            >
              Zones
            </button>
          )}

          {/* Liquidity display mode select (only when liquidity concept is selected) */}
          {selectedConcept && selectedConcept.startsWith('liquidity') && (
            <select
              className="symbol-selector compact"
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value)}
              title="Liquidity Display Mode"
            >
              <option value="default">Default</option>
              <option value="consolidated">Consolidated</option>
              <option value="research">Research</option>
            </select>
          )}

          {/* Sync Data button */}
          <button
            className={`sync-btn ${syncProgress?.status === 'running' ? 'running' : ''}`}
            onClick={handleTriggerSync}
            disabled={syncProgress?.status === 'running'}
            title="Trigger manual database sync for current symbol"
          >
            <RefreshCw size={12} className={syncProgress?.status === 'running' ? 'spin' : ''} />
            {syncProgress?.status === 'running' ? 'Syncing' : 'Sync'}
          </button>

          {/* Bar history limit selector */}
          <div className="dataset-group">
            <span className="dataset-label">Bars</span>
            <select
              className="symbol-selector compact"
              value={limitBarsInteractive}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setLimitBarsInteractive(val);
                slidingWindowCache1.clear();
                slidingWindowCache2.clear();
              }}
              title="Bar history limit"
            >
              <option value={20000}>2W</option>
              <option value={40000}>1M</option>
              <option value={80000}>3M</option>
              <option value={120000}>4M</option>
              <option value={0}>Full</option>
            </select>
          </div>

          {/* Theme toggle */}
          <button
            className="icon-btn-square"
            onClick={() => setIsDarkMode(v => !v)}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Settings */}
          <button
            className="icon-btn-square"
            onClick={() => setIsSettingsOpen(true)}
            title="Chart Settings"
          >
            <Settings size={14} />
          </button>

          {/* Publish (decorative accent button) */}
          <button className="publish-btn">Publish</button>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="main-content">
        <div className="chart-workspace" style={{ display: workspaceTab === 'chart' ? 'flex' : 'none' }}>
            {/* LEFT DRAWING RAIL (48px icon column, tooltips on hover) */}
            <aside className="drawing-sidebar">
              <button
                className={`sidebar-btn ${activeTool === null ? 'active' : ''}`}
                onClick={() => setActiveTool(null)}
                data-tooltip="Cursor"
              >
                <MousePointer size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'trendline' ? 'active' : ''}`}
                onClick={() => setActiveTool('trendline')}
                data-tooltip="Trend Line"
              >
                <TrendingUp size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'horizontal-line' ? 'active' : ''}`}
                onClick={() => setActiveTool('horizontal-line')}
                data-tooltip="Horizontal Line"
              >
                <Minus size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'ray' ? 'active' : ''}`}
                onClick={() => setActiveTool('ray')}
                data-tooltip="Horizontal Ray"
              >
                <ArrowUpRight size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'fibonacci' ? 'active' : ''}`}
                onClick={() => setActiveTool('fibonacci')}
                data-tooltip="Fibonacci Retracement"
              >
                <Layers size={16} />
              </button>

              <div className="rail-divider" />

              <button
                className={`sidebar-btn ${activeTool === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTool('text')}
                data-tooltip="Text Annotation"
              >
                <Type size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'brush' ? 'active' : ''}`}
                onClick={() => setActiveTool('brush')}
                data-tooltip="Brush (Freehand)"
              >
                <Brush size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'rectangle' ? 'active' : ''}`}
                onClick={() => setActiveTool('rectangle')}
                data-tooltip="Rectangle Shape"
              >
                <Square size={16} />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'position-long' ? 'active' : ''}`}
                onClick={() => setActiveTool('position-long')}
                data-tooltip="Long Position"
              >
                <TrendingUp size={16} className="position-long-icon" />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'position-short' ? 'active' : ''}`}
                onClick={() => setActiveTool('position-short')}
                data-tooltip="Short Position"
              >
                <TrendingDown size={16} className="position-short-icon" />
              </button>

              <button
                className={`sidebar-btn ${activeTool === 'ruler' ? 'active' : ''}`}
                onClick={() => setActiveTool('ruler')}
                data-tooltip="Ruler (Measure)"
              >
                <Compass size={16} />
              </button>

              <div className="rail-divider" />

              {/* Magnet toggle */}
              <button
                className={`sidebar-btn ${magnetMode ? 'magnet-active' : ''}`}
                onClick={() => setMagnetMode(!magnetMode)}
                data-tooltip={magnetMode ? "Disable Magnet Mode" : "Enable Magnet Mode (Snaps to High/Low)"}
              >
                <Magnet size={16} />
              </button>

              {/* Lock all toggle */}
              <button
                className={`sidebar-btn ${lockDrawings ? 'lock-active' : ''}`}
                onClick={() => setLockDrawings(!lockDrawings)}
                data-tooltip={lockDrawings ? "Unlock all drawings" : "Lock all drawings"}
              >
                {lockDrawings ? <Lock size={16} /> : <Unlock size={16} />}
              </button>

              {/* Hide/Show drawings */}
              <button
                className="sidebar-btn"
                onClick={() => setHideDrawings(!hideDrawings)}
                data-tooltip={hideDrawings ? "Show all drawings" : "Hide all drawings"}
              >
                {hideDrawings ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>

              {/* Clear all drawings */}
              <button
                className="sidebar-btn"
                onClick={handleClearAll}
                data-tooltip="Remove all drawings"
              >
                <Trash2 size={16} />
              </button>
            </aside>

            {dealingRangeCalc.active && (
              <div className="dealing-range-loader-overlay">
                <div className="dealing-range-loader-card">
                  <div className="loader-card-header">
                    <span className="loader-icon">⚡</span>
                    <h3>Calculating Dealing Ranges...</h3>
                  </div>
                  <div className="loader-card-body">
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${dealingRangeCalc.progress}%` }}
                      ></div>
                    </div>
                    <div className="time-metrics">
                      <div>
                        <span className="metric-label">Elapsed: </span>
                        <span className="metric-value">{dealingRangeCalc.elapsed.toFixed(2)}s</span>
                      </div>
                      <div>
                        <span className="metric-label">Estimated: </span>
                        <span className="metric-value">{dealingRangeCalc.estimated.toFixed(2)}s remaining</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="chart-floating-actions">
              <button
                className="floating-btn"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? "Exit Full Screen (Esc)" : "Full Screen"}
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>

            <ChartViewport 
              containerRef={containerRef}
              chartTargetRef={chartTargetRef}
              container2Ref={container2Ref}
              chartTarget2Ref={chartTarget2Ref}
              chartInitialized={chartInitialized}
              chart2Initialized={chart2Initialized}
              chartRef={chartRef}
              seriesRef={seriesRef}
              chart2Ref={chart2Ref}
              series2Ref={series2Ref}
              chartSettings={chartSettings}
              isDarkMode={isDarkMode}
              layout={layout}
              showVolume={showVolume}
              showSessions={showSessions}
              activeSymbol={activeSymbol}
              timeframe={timeframe}
              timeframe2={timeframe2}
              allBars={allBars}
              allBars2={allBars2}
              hudBar={hudBar}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              drawings={drawings}
              setDrawings={setDrawings}
              selectedDrawing={selectedDrawing}
              setSelectedDrawing={setSelectedDrawing}
              magnetMode={magnetMode}
              lockDrawings={lockDrawings}
              hideDrawings={hideDrawings}
              handleAddUndoState={handleAddUndoState}
              floatingToolbarPos={floatingToolbarPos}
              setFloatingToolbarPos={setFloatingToolbarPos}
              isToolbarPinned={isToolbarPinned}
              setIsToolbarPinned={setIsToolbarPinned}
              defaultToolStyles={defaultToolStyles}
              isDrawingSettingsOpen={isDrawingSettingsOpen}
              setIsDrawingSettingsOpen={setIsDrawingSettingsOpen}
              showAlgoZones={showAlgoZones}
              algoCandidates={filteredAlgoCandidates}
              algoCandidates2={filteredAlgoCandidates2}
              loadingState1={loadingState1}
              loadingState2={loadingState2}
              chart1Ready={chart1Ready}
              chart2Ready={chart2Ready}
              onChart1Ready={() => setChart1Ready(true)}
              onChart2Ready={() => setChart2Ready(true)}
              selectedConcept={selectedConcept}
              selectedAlgoCandidate={selectedAlgoCandidate}
              setSelectedAlgoCandidate={setSelectedAlgoCandidate}
              narrativeMode={narrativeMode}
              debugOverlayFilters={debugOverlayFilters}
              debugMode={viewMode === 'debug'}
              narrativeFocusRangeId={narrativeFocusRangeId}
              setNarrativeFocusRangeId={setNarrativeFocusRangeId}
              viewMode={viewMode}
              analysisLayers={analysisLayers}
              replayMode={replayMode}
              replayIndex={replayIndex}
              setReplayIndex={setReplayIndex}
              replaySpeed={replaySpeed}
              setReplaySpeed={setReplaySpeed}
              isReplayPlaying={isReplayPlaying}
              toggleReplayPlay={toggleReplayPlay}
              replayToolbarPos={replayToolbarPos}
              handleReplayDragStart={handleReplayDragStart}
              currentSubStep={currentSubStep}
              setCurrentSubStep={setCurrentSubStep}
              replayTimeframeOption={replayTimeframeOption}
              setReplayTimeframeOption={setReplayTimeframeOption}
              isTimeframeDropdownOpen={isTimeframeDropdownOpen}
              setIsTimeframeDropdownOpen={setIsTimeframeDropdownOpen}
              currentReplayDateString={currentReplayDateString}
              handleDateJump={handleDateJump}
              handleStepForward={handleStepForward}
              handleStepBack={handleStepBack}
              handleExitReplay={handleExitReplay}

              startContinuousAction={startContinuousAction}
              handleZoomIn={handleZoomIn}
              handleZoomOut={handleZoomOut}
              handleScrollLeft={handleScrollLeft}
              handleScrollRight={handleScrollRight}
              handleResetScale={handleResetScale}
              saveExplorerLabel={saveExplorerLabel}
            />

            <WatchlistSidebar 
              rightSidebarTab={rightSidebarTab}
              setRightSidebarTab={setRightSidebarTab}
              symbols={symbols}
              activeSymbol={activeSymbol}
              setActiveSymbol={setActiveSymbol}
              drawings={drawings}
              setDrawings={setDrawings}
              allBars={allBars}
              replayIndex={replayIndex}
              replayMode={replayMode}
              selectedAlgoCandidate={selectedAlgoCandidate}
              setSelectedAlgoCandidate={setSelectedAlgoCandidate}
              onSaveValidation={saveExplorerLabel}
              onJumpToTime={handleJumpToTime}
              debugMode={viewMode === 'debug'}
              debugOverlayFilters={debugOverlayFilters}
              setDebugOverlayFilters={setDebugOverlayFilters}
              narrativeMode={narrativeMode}
              setNarrativeMode={setNarrativeMode}
              narrativeFocusRangeId={narrativeFocusRangeId}
              setNarrativeFocusRangeId={setNarrativeFocusRangeId}
              algoCandidates={algoCandidates}
              viewMode={viewMode}
              setViewMode={setViewMode}
              analysisLayers={analysisLayers}
              setAnalysisLayers={setAnalysisLayers}
            />
          </div>

          </div>

      {/* BOTTOM STATUS BAR (24px tall) */}
      <footer className="bottom-bar">
        {/* LEFT: time-scale quick-zoom + connection + symbol + timeframe */}
        <div className="bottom-left-group">
          <span className="bottom-tf-label">Range</span>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(1)}>1D</button>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(5)}>5D</button>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(30)}>1M</button>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(90)}>3M</button>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(180)}>6M</button>
          <button className="bottom-tf-btn" onClick={() => handleBottomTimeScale(365)}>1Y</button>
          <button className="bottom-tf-btn" onClick={() => chartRef.current?.timeScale().fitContent()}>All</button>
          <span className="status-divider" />
          <div className="status-indicator">
            <span className="status-dot" />
            <span>Connected</span>
          </div>
          <span className="status-divider" />
          <span className="status-label">Sym</span>
          <span className="status-value">{activeSymbol ? activeSymbol.replace('_HISTORICAL_DATA', '').replace('_', ' ').toUpperCase() : '—'}</span>
          <span className="status-divider" />
          <span className="status-label">TF</span>
          <span className="status-value">{tfLabel}</span>
        </div>

        {/* CENTER: last price + change (last close vs prev close) */}
        <div className="bottom-center-group">
          {lastPrice !== null ? (
            <>
              <span className="status-label">Last</span>
              <span className="status-mono">{lastPrice.toFixed(2)}</span>
              {priceChange !== null && (
                <span className={`status-value ${priceChange >= 0 ? 'up' : 'dn'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}
                </span>
              )}
              {priceChangePct !== null && (
                <span className={`status-value ${priceChangePct >= 0 ? 'up' : 'dn'}`}>
                  ({priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%)
                </span>
              )}
            </>
          ) : (
            <span className="status-label">No data</span>
          )}
        </div>

        {/* RIGHT: Session info */}
        <div className="bottom-right-group">
          <>
            <span className="status-label">Session</span>
            <span className="status-value">{sessionLabel}</span>
            <span className="status-divider" />
            <span className="status-label">TZ</span>
            <span className="status-value">America/New_York</span>
          </>
        </div>
      </footer>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <ChartSettingsModal 
          onClose={() => setIsSettingsOpen(false)}
          chartSettings={chartSettings}
          setChartSettings={setChartSettings}
          themeColor={themeColor}
          setThemeColor={setThemeColor}
          showSessions={showSessions}
          setShowSessions={setShowSessions}
          magnetMode={magnetMode}
          setMagnetMode={setMagnetMode}
          isDarkMode={isDarkMode}
        />
      )}


      {isProgressOverlayVisible && syncProgress && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(9, 10, 16, 0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div className="glass-panel" style={{
            borderRadius: '16px',
            padding: '28px',
            width: '420px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.3px' }}>
              <RefreshCw className="spin" size={20} style={{ color: '#0052ff' }} />
              Background Sync in Progress
            </h3>
            
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                <span>Symbol:</span>
                <strong style={{ color: '#fff' }}>{activeSymbol}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                <span>Target:</span>
                <strong style={{ color: '#fff' }}>{activeResearchMode === 'interactive' ? 'Interactive Terminal' : 'Batch Research'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                <span>Status:</span>
                <span className={`sync-status-indicator ${syncProgress.status || 'idle'}`}>
                  {syncProgress.status?.toUpperCase() || 'RUNNING'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                <span>Bars Processed:</span>
                <strong style={{ color: '#fff' }}>
                  {syncProgress.bars_processed !== undefined && syncProgress.bars_processed !== null
                    ? syncProgress.bars_processed.toLocaleString()
                    : 'Processing...'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                <span>Time Elapsed:</span>
                <strong style={{ color: '#fff' }}>
                  {syncProgress.elapsed_ms > 0
                    ? `${Math.round(syncProgress.elapsed_ms / 1000)} seconds`
                    : '0 seconds'}
                </strong>
              </div>
              {syncProgress.total_chunks > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                  <span>Progress:</span>
                  <strong style={{ color: '#0052ff' }}>
                    {Math.round((syncProgress.current_chunk / syncProgress.total_chunks) * 100)}%
                  </strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Estimated Time Remaining:</span>
                <strong style={{ color: '#fff' }}>
                  {syncProgress.eta_ms > 0 ? `${Math.ceil(syncProgress.eta_ms / 1000)} seconds` : 'Calculating...'}
                </strong>
              </div>
            </div>

            {syncProgress.total_chunks > 0 && (
              <div style={{
                height: '6px',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '3px',
                overflow: 'hidden',
                marginTop: '4px'
              }}>
                <div style={{
                  height: '100%',
                  width: `${(syncProgress.current_chunk / syncProgress.total_chunks) * 100}%`,
                  background: 'linear-gradient(90deg, #0052ff, #00d2ff)',
                  transition: 'width 0.4s cubic-bezier(0.1, 0.8, 0.25, 1)'
                }} />
              </div>
            )}

            <button
              onClick={() => {
                userDismissedSyncRef.current = true;
                setIsProgressOverlayVisible(false);
                setSyncProgress(null);
              }}
              style={{
                marginTop: '10px',
                padding: '10px 16px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.15)'}
              onMouseLeave={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.08)'}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
