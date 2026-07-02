import React from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import DrawingCanvas from './DrawingCanvas';
import FloatingToolbar from './FloatingToolbar';
import DrawingSettingsModal from './DrawingSettingsModal';
import ReplayControls from './ReplayControls';
import CandidateExplorer from './CandidateExplorer';

export default function ChartViewport({
  // Container Refs
  containerRef,
  chartTargetRef,
  container2Ref,
  chartTarget2Ref,
  
  // Chart Instances
  chartInitialized,
  chart2Initialized,
  chartRef,
  seriesRef,
  chart2Ref,
  series2Ref,

  // Settings & Theme
  chartSettings,
  isDarkMode,
  layout,
  showVolume,
  showSessions,
  activeSymbol,

  // Timeframes & Bars
  timeframe,
  timeframe2,
  allBars,
  allBars2,
  hudBar,

  // Drawings State
  activeTool,
  setActiveTool,
  drawings,
  setDrawings,
  selectedDrawing,
  setSelectedDrawing,
  magnetMode,
  lockDrawings,
  hideDrawings,
  handleAddUndoState,
  floatingToolbarPos,
  setFloatingToolbarPos,
  isToolbarPinned,
  setIsToolbarPinned,
  defaultToolStyles,
  isDrawingSettingsOpen,
  setIsDrawingSettingsOpen,

  // Algo / Candidate States
  showAlgoZones,
  algoCandidates,
  algoCandidates2,
  loadingState1 = { candles: false, events: false },
  loadingState2 = { candles: false, events: false },
  chart1Ready = false,
  chart2Ready = false,
  onChart1Ready = null,
  onChart2Ready = null,
  selectedConcept,
  selectedAlgoCandidate,
  setSelectedAlgoCandidate,
  narrativeMode = false,
  narrativeFocusRangeId = null,
  setNarrativeFocusRangeId = null,
  viewMode = 'narrative',
  analysisLayers = {},
  debugOverlayFilters = null,
  debugMode = false,

  // Replay States
  replayMode,
  replayIndex,
  setReplayIndex,
  replaySpeed,
  setReplaySpeed,
  isReplayPlaying,
  toggleReplayPlay,
  replayToolbarPos,
  handleReplayDragStart,
  currentSubStep,
  setCurrentSubStep,
  replayTimeframeOption,
  setReplayTimeframeOption,
  isTimeframeDropdownOpen,
  setIsTimeframeDropdownOpen,
  currentReplayDateString,
  handleDateJump,
  handleStepForward,
  handleStepBack,
  handleExitReplay,

  // Continuous zoom/scroll helpers
  startContinuousAction,
  handleZoomIn,
  handleZoomOut,
  handleScrollLeft,
  handleScrollRight,
  handleResetScale,

  // Candidate Explorer Label functions
  saveExplorerLabel
}) {
  const [consoleLogs, setConsoleLogs] = React.useState([]);
  React.useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalLog = console.log;
    
    console.warn = (...args) => {
      setConsoleLogs(prev => [...prev.slice(-6), `WARN: ${args.join(' ')}`]);
      originalWarn(...args);
    };
    console.error = (...args) => {
      setConsoleLogs(prev => [...prev.slice(-6), `ERR: ${args.join(' ')}`]);
      originalError(...args);
    };
    console.log = (...args) => {
      if (args[0] && args[0].toString().includes('[DrawingCanvas Debug]')) {
        setConsoleLogs(prev => [...prev.slice(-6), `LOG: ${args.join(' ')}`]);
      }
      originalLog(...args);
    };
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      console.log = originalLog;
    };
  }, []);

  return (
    <main className="chart-viewport">
      <div style={{ display: 'flex', width: '100%', height: '100%', gap: '4px' }}>
        <div className="chart-container" ref={containerRef} style={{ flex: 1, height: '100%', position: 'relative' }}>
          <div id="chart-target" ref={chartTargetRef} style={{ width: '100%', height: '100%' }} />

          {/* Progressive Pipeline Loading Overlay */}
          {(loadingState1.candles || loadingState1.events || !chart1Ready) && (
            <div className="chart-loading-overlay">
              <div className="chart-loading-container">
                <div className="chart-loading-spinner"></div>
                <div className="chart-loading-title">Loading Chart</div>
                <div className="chart-loading-pipeline">
                  <div className={`chart-pipeline-step ${!loadingState1.candles ? 'completed' : 'pending'}`}>
                    <span className="chart-step-icon">
                      {!loadingState1.candles ? '✓' : '⚙'}
                    </span>
                    <span>Price Candles</span>
                  </div>
                  <div className={`chart-pipeline-step ${!loadingState1.events ? 'completed' : (loadingState1.candles ? 'pending' : '')}`}>
                    <span className="chart-step-icon">
                      {!loadingState1.events ? '✓' : (loadingState1.candles ? '⌛' : '⚙')}
                    </span>
                    <span>Swing & Liquidity Registries</span>
                  </div>
                  <div className={`chart-pipeline-step ${chart1Ready ? 'completed' : (!loadingState1.events ? 'pending' : '')}`}>
                    <span className="chart-step-icon">
                      {chart1Ready ? '✓' : (!loadingState1.events ? '⚙' : '⌛')}
                    </span>
                    <span>Layout Alignment</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Visual Health Panel */}
          {debugMode && (
            <div
              style={{
                position: 'absolute',
                top: '10px',
                right: '70px',
                background: 'rgba(15, 17, 21, 0.85)',
                border: '1px solid #2a2e39',
                borderRadius: '6px',
                padding: '10px 14px',
                color: '#ffffff',
                fontSize: '11px',
                fontFamily: 'Outfit, monospace',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                pointerEvents: 'none',
                minWidth: '160px'
              }}
            >
              <div style={{ fontWeight: 'bold', borderBottom: '1px solid #2a2e39', paddingBottom: '4px', marginBottom: '6px', color: '#ffb74d' }}>
                Visual Health Panel
              </div>
              {(() => {
                const limitTime = (replayMode && replayIndex > 0) ? (allBars[replayIndex - 1]?.time || Infinity) : Infinity;
                const visibleCandidates = algoCandidates.filter(c => !replayMode || c.time <= limitTime);
                
                const swings = visibleCandidates.filter(c => c.type === 'swing' || c.type === 'strong_swing' || c.type === 'swing_high' || c.type === 'swing_low');
                const pools = visibleCandidates.filter(c => c.type === 'liquidity' || c.type === 'liquidity_object');
                const sweeps = visibleCandidates.filter(c => c.type === 'sweep');
                const takes = visibleCandidates.filter(c => c.type === 'take');
                const structure = visibleCandidates.filter(c => c.type === 'mss' || c.type === 'bos');
                const ranges = visibleCandidates.filter(c => c.type === 'dealing_range');
                const delivery = visibleCandidates.filter(c => c.type === 'delivery_leg');

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Swings:</span>
                      <span style={{ fontWeight: 'bold', color: '#26a69a' }}>{swings.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Liquidity Pools:</span>
                      <span style={{ fontWeight: 'bold', color: '#2962ff' }}>{pools.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Sweep Events:</span>
                      <span style={{ fontWeight: 'bold', color: '#ffa726' }}>{sweeps.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Take Events:</span>
                      <span style={{ fontWeight: 'bold', color: '#ab47bc' }}>{takes.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Structure (BOS/MSS):</span>
                      <span style={{ fontWeight: 'bold', color: '#26a69a' }}>{structure.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Dealing Ranges:</span>
                      <span style={{ fontWeight: 'bold', color: '#ab47bc' }}>{ranges.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Delivery Legs:</span>
                      <span style={{ fontWeight: 'bold', color: '#00e676' }}>{delivery.length}</span>
                    </div>
                    {/* Console Output */}
                    <div style={{ marginTop: '8px', borderTop: '1px solid #2a2e39', paddingTop: '6px', fontSize: '9px', color: '#ffb74d', wordBreak: 'break-all', maxHeight: '180px', overflowY: 'auto' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Console Diagnostic:</div>
                      {consoleLogs.length === 0 ? (
                        <div style={{ color: '#888' }}>No logs captured yet</div>
                      ) : (
                        consoleLogs.map((log, idx) => (
                          <div key={idx} style={{ color: log.startsWith('ERR') ? '#ef5350' : log.startsWith('WARN') ? '#ffa726' : '#26a69a' }}>
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Floating Navigation Controls */}
          {chartInitialized && chartRef.current && (
            <div className="chart-navigation-controls">
              <button 
                onMouseDown={(e) => startContinuousAction(e, handleZoomOut)}
                onTouchStart={(e) => startContinuousAction(e, handleZoomOut)}
                title="Zoom Out (Hold to repeat)"
              >
                <ZoomOut size={14} />
              </button>
              <button 
                onMouseDown={(e) => startContinuousAction(e, handleZoomIn)}
                onTouchStart={(e) => startContinuousAction(e, handleZoomIn)}
                title="Zoom In (Hold to repeat)"
              >
                <ZoomIn size={14} />
              </button>
              <button 
                onMouseDown={(e) => startContinuousAction(e, handleScrollLeft)}
                onTouchStart={(e) => startContinuousAction(e, handleScrollLeft)}
                title="Scroll Left (Hold to repeat)"
              >
                <ChevronLeft size={14} />
              </button>
              <button 
                onMouseDown={(e) => startContinuousAction(e, handleScrollRight)}
                onTouchStart={(e) => startContinuousAction(e, handleScrollRight)}
                title="Scroll Right (Hold to repeat)"
              >
                <ChevronRight size={14} />
              </button>
              <button onClick={handleResetScale} title="Reset Scale (Auto Price & Time)"><RefreshCw size={12} /></button>
            </div>
          )}

          {/* Render Overlay Canvas */}
          {chartRef.current && seriesRef.current && (
            <DrawingCanvas
              chart={chartRef.current}
              chartContainer={containerRef.current}
              series={seriesRef.current}
              allBars={allBars}
              timeframe={timeframe}
              symbol={activeSymbol}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              drawings={drawings}
              setDrawings={setDrawings}
              selectedDrawing={selectedDrawing}
              setSelectedDrawing={setSelectedDrawing}
              magnetMode={magnetMode}
              lockDrawings={lockDrawings}
              hideDrawings={hideDrawings}
              showSessions={showSessions}
              onAddUndoState={handleAddUndoState}
              floatingToolbarPos={floatingToolbarPos}
              setFloatingToolbarPos={setFloatingToolbarPos}
              isToolbarPinned={isToolbarPinned}
              defaultToolStyles={defaultToolStyles}
              onOpenSettings={() => setIsDrawingSettingsOpen(true)}
              showAlgoZones={showAlgoZones}
              algoCandidates={algoCandidates}
              selectedAlgoCandidate={selectedAlgoCandidate}
              onSelectAlgoCandidate={setSelectedAlgoCandidate}
              selectedConcept={selectedConcept}
              replayMode={replayMode}
              replayIndex={replayIndex}
              narrativeMode={narrativeMode}
              narrativeFocusRangeId={narrativeFocusRangeId}
              setNarrativeFocusRangeId={setNarrativeFocusRangeId}
              debugOverlayFilters={debugOverlayFilters}
              debugMode={debugMode}
              onRenderCompleted={onChart1Ready}
            />
          )}

          {replayMode && (() => {
            const limit = (replayMode && replayIndex > 0) ? (allBars[replayIndex - 1]?.time || Infinity) : Infinity;
            const activeBar = (replayMode && replayIndex > 0) ? allBars[replayIndex - 1] : allBars[allBars.length - 1];
            const currentPrice = activeBar ? activeBar.close : null;
            const narrativeContext = getReplayNarrativeContext(algoCandidates || [], limit);
            const timeline = compileTimelineEntries(algoCandidates || [], limit);
            const lastThreeEvents = timeline.slice(-3).reverse();

            const activeRangeId = narrativeContext?.properties?.activeRangeId;
            const activeRange = (algoCandidates || []).find(c => c.id === activeRangeId);
            
            let currentState = "Idle / Scanning";
            let expectedNext = "Dealing Range Setup";
            let touches = 0;
            let confidence = 0;
            let currentObjective = "N/A";
            let lifecycle = "N/A";

            if (activeRange) {
              const deliveryState = activeRange.properties?.deliveryState || {};
              const targetPoolId = activeRange.properties?.deliveryState?.target_liquidity_id;
              const targetPool = (algoCandidates || []).find(c => c.id === targetPoolId);
              
              touches = activeRange.properties?.touchCount || activeRange.properties?.swingCount || 1;
              confidence = activeRange.properties?.qualityScore || 80;

              if (activeRange.state === 'developing') {
                currentState = activeRange.direction === 'bullish' 
                  ? "Bullish Delivery" 
                  : "Bearish Delivery";
                
                currentObjective = targetPool 
                  ? `${targetPool.direction.toUpperCase()} Pool` 
                  : "Opposing Liquidity Pool";
                  
                expectedNext = "Sweep / Struct Confirmation";
                lifecycle = "Developing";
              } else {
                currentState = `Range Locked (${activeRange.state})`;
                expectedNext = "New Range Setup";
                lifecycle = activeRange.state.toUpperCase();
              }
            }

            return (
              <div className="market-narrative-hud" style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                width: '280px',
                background: 'rgba(22, 25, 37, 0.85)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px',
                padding: '10px 12px',
                zIndex: 10,
                color: '#fff',
                fontFamily: 'Outfit, sans-serif',
                fontSize: '11px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                pointerEvents: 'none'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '9px', letterSpacing: '0.05em', color: 'var(--accent)' }}>MARKET NARRATIVE DEBUG HUD</span>
                  <span style={{ fontSize: '8px', background: 'rgba(239,83,80,0.15)', color: '#ff5252', padding: '1px 4px', borderRadius: '3px', fontWeight: 'bold' }}>REPLAY ACTIVE</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Current State</div>
                    <div style={{ fontWeight: 600, color: activeRange ? (activeRange.direction === 'bullish' ? '#26a69a' : '#ef5350') : '#fff' }}>{currentState}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Lifecycle</div>
                    <div style={{ fontWeight: 600 }}>{lifecycle}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Current Objective</div>
                    <div style={{ fontWeight: 600, color: '#ffb300' }}>{currentObjective}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Confidence / Strength</div>
                    <div style={{ fontWeight: 600 }}>{activeRange ? `${confidence}%` : 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Engineering Touches</div>
                    <div style={{ fontWeight: 600 }}>{touches || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Expected Next Event</div>
                    <div style={{ fontWeight: 600, fontSize: '10px', color: '#64b5f6' }}>{expectedNext}</div>
                  </div>
                </div>

                {lastThreeEvents.length > 0 && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px', marginTop: '2px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: '4px', fontWeight: 600 }}>ENGINE THOUGHTS HISTORY</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {lastThreeEvents.map((ev, i) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', fontSize: '9.5px', background: 'rgba(255,255,255,0.02)', padding: '3px 6px', borderRadius: '3px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '8px' }}>{ev.timeStr}</span>
                          <span style={{
                            color: ev.type.includes('swept') ? '#ff5252' :
                                   ev.type.includes('confirmed') ? '#00e676' :
                                   ev.type.includes('started') ? '#2196f3' : '#abb2bf',
                            fontWeight: 600
                          }}>
                            {ev.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {layout === 'split' && (
          <div 
            className="chart-container" 
            ref={container2Ref} 
            style={{ flex: 1, height: '100%', position: 'relative', borderLeft: '1px solid var(--border)' }}
          >
            <div id="chart-target-2" ref={chartTarget2Ref} style={{ width: '100%', height: '100%' }} />

            {/* Progressive Pipeline Loading Overlay for Chart 2 */}
            {(loadingState2.candles || loadingState2.events || !chart2Ready) && (
              <div className="chart-loading-overlay">
                <div className="chart-loading-container">
                  <div className="chart-loading-spinner"></div>
                  <div className="chart-loading-title">Loading Chart 2</div>
                  <div className="chart-loading-pipeline">
                    <div className={`chart-pipeline-step ${!loadingState2.candles ? 'completed' : 'pending'}`}>
                      <span className="chart-step-icon">
                        {!loadingState2.candles ? '✓' : '⚙'}
                      </span>
                      <span>Price Candles</span>
                    </div>
                    <div className={`chart-pipeline-step ${!loadingState2.events ? 'completed' : (loadingState2.candles ? 'pending' : '')}`}>
                      <span className="chart-step-icon">
                        {!loadingState2.events ? '✓' : (loadingState2.candles ? '⌛' : '⚙')}
                      </span>
                      <span>Swing & Liquidity Registries</span>
                    </div>
                    <div className={`chart-pipeline-step ${chart2Ready ? 'completed' : (!loadingState2.events ? 'pending' : '')}`}>
                      <span className="chart-step-icon">
                        {chart2Ready ? '✓' : (!loadingState2.events ? '⚙' : '⌛')}
                      </span>
                      <span>Layout Alignment</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Render Overlay Canvas for secondary chart */}
            {chart2Initialized && chart2Ref.current && series2Ref.current && (
              <DrawingCanvas
                chart={chart2Ref.current}
                chartContainer={container2Ref.current}
                series={series2Ref.current}
                allBars={allBars2}
                timeframe={timeframe2}
                symbol={activeSymbol}
                activeTool={activeTool}
                setActiveTool={setActiveTool}
                drawings={drawings}
                setDrawings={setDrawings}
                selectedDrawing={selectedDrawing}
                setSelectedDrawing={setSelectedDrawing}
                magnetMode={magnetMode}
                lockDrawings={lockDrawings}
                hideDrawings={hideDrawings}
                showSessions={showSessions}
                onAddUndoState={handleAddUndoState}
                floatingToolbarPos={floatingToolbarPos}
                setFloatingToolbarPos={setFloatingToolbarPos}
                isToolbarPinned={isToolbarPinned}
                defaultToolStyles={defaultToolStyles}
                onOpenSettings={() => setIsDrawingSettingsOpen(true)}
                showAlgoZones={showAlgoZones}
                algoCandidates={algoCandidates2}
                selectedAlgoCandidate={selectedAlgoCandidate}
                onSelectAlgoCandidate={setSelectedAlgoCandidate}
                selectedConcept={selectedConcept}
                replayMode={replayMode}
                replayIndex={replayIndex}
                narrativeMode={narrativeMode}
                narrativeFocusRangeId={narrativeFocusRangeId}
                setNarrativeFocusRangeId={setNarrativeFocusRangeId}
                viewMode={viewMode}
                analysisLayers={analysisLayers}
                debugOverlayFilters={debugOverlayFilters}
                debugMode={debugMode}
                onRenderCompleted={onChart2Ready}
              />
            )}
          </div>
        )}
      </div>

      {/* Replay Mode Controls Bar */}
      <ReplayControls 
        replayMode={replayMode}
        replayToolbarPos={replayToolbarPos}
        handleReplayDragStart={handleReplayDragStart}
        allBars={allBars}
        replayIndex={replayIndex}
        setReplayIndex={setReplayIndex}
        setCurrentSubStep={setCurrentSubStep}
        replaySpeed={replaySpeed}
        setReplaySpeed={setReplaySpeed}
        currentReplayDateString={currentReplayDateString}
        handleDateJump={handleDateJump}
        handleStepBack={handleStepBack}
        toggleReplayPlay={toggleReplayPlay}
        isReplayPlaying={isReplayPlaying}
        isTimeframeDropdownOpen={isTimeframeDropdownOpen}
        setIsTimeframeDropdownOpen={setIsTimeframeDropdownOpen}
        replayTimeframeOption={replayTimeframeOption}
        setReplayTimeframeOption={setReplayTimeframeOption}
        handleStepForward={handleStepForward}
        handleExitReplay={handleExitReplay}
      />

      {/* Draggable Settings toolbar */}
      {selectedDrawing !== null && !isDrawingSettingsOpen && (
        <FloatingToolbar
          position={floatingToolbarPos}
          setPosition={setFloatingToolbarPos}
          selectedDrawingIdx={selectedDrawing}
          drawings={drawings}
          setDrawings={setDrawings}
          setSelectedDrawing={setSelectedDrawing}
          setIsToolbarPinned={setIsToolbarPinned}
          onAddUndoState={handleAddUndoState}
          onOpenSettings={() => setIsDrawingSettingsOpen(true)}
        />
      )}

      {/* TradingView Settings Modal */}
      <DrawingSettingsModal 
        isOpen={isDrawingSettingsOpen}
        onClose={() => setIsDrawingSettingsOpen(false)}
        shape={selectedDrawing !== null ? drawings[selectedDrawing] : null}
        updateShape={(updatedShape) => {
          const copy = [...drawings];
          copy[selectedDrawing] = updatedShape;
          setDrawings(copy);
        }}
        onAddUndoState={handleAddUndoState}
      />

      {/* Candidate Explorer Card */}
      <CandidateExplorer 
        selectedAlgoCandidate={selectedAlgoCandidate}
        setSelectedAlgoCandidate={setSelectedAlgoCandidate}
        onSaveValidation={saveExplorerLabel}
      />

      {/* HUD OHLC BAR */}
      {hudBar && chartSettings.showOhlc && (
        <div className="hud-ohlc">
          <span>{activeSymbol.toUpperCase()}</span>
          <span>•</span>
          <span>{timeframe < 60 ? `${timeframe}m` : timeframe < 1440 ? `${timeframe/60}H` : 'D'}</span>
          <span>•</span>
          <span>O <span className="hud-val">{hudBar.open.toFixed(2)}</span></span>
          <span>H <span className="hud-val">{hudBar.high.toFixed(2)}</span></span>
          <span>L <span className="hud-val">{hudBar.low.toFixed(2)}</span></span>
          <span>C <span className="hud-val">{hudBar.close.toFixed(2)}</span></span>
          <span>V <span className="hud-val">{hudBar.volume.toLocaleString()}</span></span>
          <span className={`hud-val ${hudBar.change >= 0 ? 'up' : 'dn'}`}>
            {hudBar.change >= 0 ? '+' : ''}{hudBar.change.toFixed(2)} ({hudBar.change >= 0 ? '+' : ''}{hudBar.percent}%)
          </span>
        </div>
      )}

      {/* HUD SESSIONS LIST */}
      {showSessions && allBars.length > 0 && (
        <div className="sessions-list-indicator">
          <div className="session-indicator-badge">
            <span className="session-dot" style={{ backgroundColor: '#26a69a' }} />
            <span>London Session (2-5 AM EST)</span>
          </div>
          <div className="session-indicator-badge">
            <span className="session-dot" style={{ backgroundColor: '#2962ff' }} />
            <span>NY AM Killzone (8:30-12 AM EST)</span>
          </div>
          <div className="session-indicator-badge">
            <span className="session-dot" style={{ backgroundColor: '#aa00ff' }} />
            <span>NY PM Session (1:30-4 PM EST)</span>
          </div>
        </div>
      )}
    </main>
  );
}

function getReplayNarrativeContext(algoCandidates, limit) {
  if (!algoCandidates || algoCandidates.length === 0) return null;
  const ranges = algoCandidates.filter(c => c.type === 'dealing_range' && c.timeStart <= limit);
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => b.timeStart - a.timeStart);
  const activeRange = ranges.find(r => !r.timeEnd || limit < r.timeEnd) || ranges[0];
  if (!activeRange) return null;
  const rHigh = activeRange.priceHigh;
  const rLow = activeRange.priceLow;
  const rStart = activeRange.timeStart;
  const rEnd = activeRange.timeEnd && limit >= activeRange.timeEnd ? activeRange.timeEnd : limit;

  const nestedRanges = ranges.filter(r => 
    r.id !== activeRange.id &&
    r.priceLow >= rLow && 
    r.priceHigh <= rHigh && 
    r.timeStart >= rStart && 
    (r.timeEnd || r.timeStart) <= rEnd
  ).map(r => r.id);

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

function compileTimelineEntries(algoCandidates, limit) {
  const entries = [];
  const formatTime = (time) => {
    return new Date(time * 1000).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  algoCandidates.forEach(c => {
    const candTime = c.timeStart !== undefined ? c.timeStart : c.time;
    if (candTime > limit) return;

    if (c.type === 'swing' || c.type === 'strong_swing') {
      const confirmTime = c.timeConfirm || c.time;
      if (confirmTime <= limit) {
        entries.push({
          time: confirmTime,
          timeStr: formatTime(confirmTime),
          text: `${c.type === 'strong_swing' ? 'Strong Swing' : 'Swing'} ${c.direction === 'bullish' ? 'Low' : 'High'} created at ${(c.priceLow || c.priceHigh).toFixed(2)}`,
          type: 'swing'
        });
      }
    } else if (c.type === 'liquidity') {
      if (c.timeStart <= limit) {
        const poolName = c.direction.toUpperCase();
        const price = c.properties?.levelPrice || ((c.priceHigh + c.priceLow) / 2);
        entries.push({
          time: c.timeStart,
          timeStr: formatTime(c.timeStart),
          text: `${poolName} pool created at ${price.toFixed(2)}`,
          type: 'liquidity-created'
        });
      }
      const stateHistory = c.properties?.stateHistory || [];
      stateHistory.forEach(h => {
        if (h.time <= limit && (h.state === 'swept' || h.state === 'taken')) {
          const poolName = c.direction.toUpperCase();
          entries.push({
            time: h.time,
            timeStr: formatTime(h.time),
            text: `${poolName} swept at ${c.priceHigh.toFixed(2)}`,
            type: 'liquidity-swept'
          });
        }
      });
    } else if (c.type === 'intent') {
      if (c.timeStart <= limit) {
        entries.push({
          time: c.timeStart,
          timeStr: formatTime(c.timeStart),
          text: `Market Intent started (${c.direction} sweep)`,
          type: 'intent-started'
        });
      }
      if (c.timeEnd && c.timeEnd <= limit && c.state === 'validated') {
        entries.push({
          time: c.timeEnd,
          timeStr: formatTime(c.timeEnd),
          text: `Intent validated by displacement`,
          type: 'intent-validated'
        });
      }
    } else if (c.type === 'delivery_leg') {
      if (c.timeStart <= limit) {
        entries.push({
          time: c.timeStart,
          timeStr: formatTime(c.timeStart),
          text: `Price Delivery leg started`,
          type: 'delivery-started'
        });
      }
      if (c.timeEnd && c.timeEnd <= limit && c.state === 'completed') {
        entries.push({
          time: c.timeEnd,
          timeStr: formatTime(c.timeEnd),
          text: `Price Delivery leg completed`,
          type: 'delivery-completed'
        });
      }
    } else if (c.type === 'structure_confirmation' || c.type === 'structure_confirm') {
      if (c.time <= limit) {
        entries.push({
          time: c.time,
          timeStr: formatTime(c.time),
          text: `Structure Confirmed (${c.direction.toUpperCase()} BOS at ${c.priceHigh.toFixed(2)})`,
          type: 'structure-confirmed'
        });
      }
    } else if (c.type === 'dealing_range') {
      if (c.timeStart <= limit) {
        entries.push({
          time: c.timeStart,
          timeStr: formatTime(c.timeStart),
          text: `Dealing Range started (${c.direction} range)`,
          type: 'range-started'
        });
      }
      if (c.timeEnd && c.timeEnd <= limit && c.state === 'completed') {
        entries.push({
          time: c.timeEnd,
          timeStr: formatTime(c.timeEnd),
          text: `Dealing Range locked/completed`,
          type: 'range-completed'
        });
      }
    }
  });

  entries.sort((a, b) => a.time - b.time);
  const unique = [];
  const seen = new Set();
  entries.forEach(e => {
    const key = `${e.time}_${e.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  });
  return unique;
}

