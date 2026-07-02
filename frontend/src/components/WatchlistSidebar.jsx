import React from 'react';
import ChatAssistant from './ChatAssistant';

export default function WatchlistSidebar({
  rightSidebarTab,
  setRightSidebarTab,
  symbols,
  activeSymbol,
  setActiveSymbol,
  drawings,
  setDrawings,
  allBars,
  replayIndex,
  replayMode,
  
  // Algo Candidates / Inspection
  selectedAlgoCandidate,
  setSelectedAlgoCandidate,
  onSaveValidation,
  onJumpToTime,
  debugMode,
  debugOverlayFilters,
  setDebugOverlayFilters,
  narrativeMode = false,
  setNarrativeMode = null,
  narrativeFocusRangeId = null,
  setNarrativeFocusRangeId = null,
  algoCandidates = [],
  viewMode = 'narrative',
  setViewMode = null,
  analysisLayers = {},
  setAnalysisLayers = null
}) {
  // Get active replay limit
  const getReplayTimeLimit = () => {
    if (!replayMode || replayIndex <= 0) return Infinity;
    const currentBar = allBars[replayIndex - 1];
    return currentBar ? currentBar.time : Infinity;
  };
  const limit = getReplayTimeLimit();

  const narrativeContext = getReplayNarrativeContext(algoCandidates || [], limit);
  const activeRangeId = narrativeContext?.properties?.activeRangeId;
  const nestedRangeIds = narrativeContext?.properties?.nestedRanges || [];
  
  const mainRange = (algoCandidates || []).find(c => c.id === activeRangeId);
  const nestedRanges = nestedRangeIds.map(id => (algoCandidates || []).find(c => c.id === id)).filter(Boolean);
  
  const selectableRanges = [];
  if (mainRange) {
    selectableRanges.push({ id: mainRange.id, label: `Dominant Active Range (${mainRange.direction === 'bullish' ? '📈 Bull' : '📉 Bear'})` });
  }
  nestedRanges.forEach((r) => {
    selectableRanges.push({ id: r.id, label: `↳ Nested Child Range (TF: ${r.timeframe}m, ${r.direction === 'bullish' ? '📈 Bull' : '📉 Bear'})` });
  });

  const selectedRangeId = narrativeFocusRangeId || (selectableRanges[0]?.id);
  const selectedRangeObj = (algoCandidates || []).find(c => c.id === selectedRangeId);

  React.useEffect(() => {
    if (narrativeMode && selectableRanges.length > 0 && !selectableRanges.some(r => r.id === narrativeFocusRangeId)) {
      if (setNarrativeFocusRangeId) {
        setNarrativeFocusRangeId(selectableRanges[0].id);
      }
    }
  }, [narrativeMode, algoCandidates, narrativeFocusRangeId, setNarrativeFocusRangeId]);
  
  return (
    <aside className="watchlist-sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="watchlist-header" style={{ display: 'flex', gap: '2px', padding: '0 2px', height: '39px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button 
          className={`toolbar-btn ${rightSidebarTab === 'market' ? 'active' : ''}`}
          style={{ flex: 1, height: '28px', margin: '5px 0', fontSize: '9px', fontWeight: 600, borderRadius: '4px', cursor: 'pointer', padding: 0 }}
          onClick={() => setRightSidebarTab('market')}
        >
          Market
        </button>
        <button 
          className={`toolbar-btn ${rightSidebarTab === 'research' ? 'active' : ''}`}
          style={{ flex: 1, height: '28px', margin: '5px 0', fontSize: '9px', fontWeight: 600, borderRadius: '4px', cursor: 'pointer', padding: 0 }}
          onClick={() => setRightSidebarTab('research')}
        >
          Research
        </button>
        <button 
          className={`toolbar-btn ${rightSidebarTab === 'chat' ? 'active' : ''}`}
          style={{ flex: 1, height: '28px', margin: '5px 0', fontSize: '9px', fontWeight: 600, borderRadius: '4px', cursor: 'pointer', padding: 0 }}
          onClick={() => setRightSidebarTab('chat')}
        >
          🤖 Chat
        </button>
      </div>

      {rightSidebarTab === 'market' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="watchlist-list" style={{ flex: 1, overflowY: 'auto' }}>
            {symbols.map(sym => {
              const isActive = sym === activeSymbol;
              return (
                <div
                  key={sym}
                  className={`watchlist-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveSymbol(sym)}
                >
                  <div>
                    <div className="symbol-name">{sym.toUpperCase()}</div>
                    <div className="symbol-desc">Nasdaq Futures File</div>
                  </div>
                  <div className="symbol-price-group">
                    <div className="symbol-price" style={{ color: isActive ? 'var(--accent)' : 'inherit' }}>
                      Active
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rightSidebarTab === 'research' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '12px' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '10px' }}>
            DEBUG OVERLAY FILTERS
          </span>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px 10px',
            background: '#131722',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.04)'
          }}>
            {[
              { key: 'swings', label: 'Fractal Swings' },
              { key: 'liquidity', label: 'Liquidity Pools' },
              { key: 'structure', label: 'Structure Breaks' },
              { key: 'dealingRanges', label: 'Dealing Ranges' }
            ].map(item => (
              <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#abb2bf', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={debugOverlayFilters?.[item.key] ?? true}
                  onChange={(e) => {
                    setDebugOverlayFilters(prev => ({
                      ...prev,
                      [item.key]: e.target.checked
                    }));
                  }}
                  style={{ accentColor: '#ff9100', cursor: 'pointer' }}
                />
                {item.label}
              </label>
            ))}
          </div>

          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '8px', marginTop: '16px' }}>
            SELECTED EVENT
          </span>
          {selectedAlgoCandidate ? (
            <div style={{ background: '#131722', borderRadius: '6px', padding: '10px', border: '1px solid rgba(255,255,255,0.04)', fontSize: '11px', color: '#abb2bf', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Type:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{selectedAlgoCandidate.type}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>ID:</span>
                <span style={{ fontFamily: 'monospace', color: '#61dafb', fontSize: '9px' }}>{selectedAlgoCandidate.id?.slice(0,12)}…</span>
              </div>
              {selectedAlgoCandidate.priceHigh && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>High:</span>
                  <span style={{ fontFamily: 'monospace' }}>{selectedAlgoCandidate.priceHigh?.toFixed(2)}</span>
                </div>
              )}
              {selectedAlgoCandidate.priceLow && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Low:</span>
                  <span style={{ fontFamily: 'monospace' }}>{selectedAlgoCandidate.priceLow?.toFixed(2)}</span>
                </div>
              )}
              <button
                onClick={() => onJumpToTime && onJumpToTime(selectedAlgoCandidate.time)}
                style={{ marginTop: '6px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
              >
                Jump to Event
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No event selected</div>
          )}
        </div>
      )}

      {rightSidebarTab === 'narrative' && (() => {
        const activeBar = (replayMode && replayIndex > 0) ? allBars[replayIndex - 1] : allBars[allBars.length - 1];
        const currentPrice = activeBar ? activeBar.close : null;

        let quadrantLabel = 'N/A';
        let quadrantColor = '#abb2bf';
        if (selectedRangeObj && currentPrice !== null) {
          const eq = selectedRangeObj.properties?.equilibrium || ((selectedRangeObj.priceHigh + selectedRangeObj.priceLow) / 2);
          if (currentPrice > eq) {
            quadrantLabel = 'Premium Quadrant (Short bias) 🔴';
            quadrantColor = '#ef5350';
          } else {
            quadrantLabel = 'Discount Quadrant (Long bias) 🟢';
            quadrantColor = '#26a69a';
          }
        }

        const deliveryState = selectedRangeObj?.properties?.deliveryState || {};

        return (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Context Card */}
            <div style={{
              padding: '12px',
              borderBottom: '1px solid var(--border)',
              background: '#161925',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              flexShrink: 0
            }}>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                CURRENT MARKET NARRATIVE
              </span>

              {selectedRangeObj ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px', color: '#abb2bf' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Active Dealing Range:</span>
                    <span style={{
                      fontWeight: 'bold',
                      color: selectedRangeObj.direction === 'bullish' ? '#26a69a' : '#ef5350',
                      background: selectedRangeObj.direction === 'bullish' ? 'rgba(38,166,154,0.1)' : 'rgba(239,83,80,0.1)',
                      padding: '2px 6px',
                      borderRadius: '3px'
                    }}>
                      {selectedRangeObj.direction.toUpperCase()} ({selectedRangeObj.timeframe}m)
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Range High:</span>
                    <span style={{ fontFamily: 'monospace', color: '#fff' }}>{selectedRangeObj.priceHigh.toFixed(2)}</span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Equilibrium:</span>
                    <span style={{ fontFamily: 'monospace', color: '#ffb300' }}>
                      {((selectedRangeObj.priceHigh + selectedRangeObj.priceLow) / 2).toFixed(2)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Range Low:</span>
                    <span style={{ fontFamily: 'monospace', color: '#fff' }}>{selectedRangeObj.priceLow.toFixed(2)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
                    <span>Current Price:</span>
                    <span style={{ fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>{currentPrice ? currentPrice.toFixed(2) : 'N/A'}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>PD Quadrant:</span>
                    <span style={{ fontWeight: 600, color: quadrantColor }}>{quadrantLabel}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
                    <span>Protected Level:</span>
                    <span style={{ fontFamily: 'monospace', color: '#ffb74d', fontWeight: 'bold' }}>
                      {deliveryState.protected_level ? deliveryState.protected_level.toFixed(2) : 'N/A'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Current Extremum:</span>
                    <span style={{ fontFamily: 'monospace', color: '#81c784' }}>
                      {deliveryState.current_extremum ? deliveryState.current_extremum.toFixed(2) : 'N/A'}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No active narrative range detected
                </div>
              )}
            </div>

            {/* Timeline */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#1c2030', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>EVENT TIMELINE</span>
                <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '3px', color: '#fff' }}>
                  {timelineEntries.length} events
                </span>
              </div>

              <div 
                ref={timelineScrollRef}
                className="watchlist-list" 
                style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {timelineEntries.length > 0 ? (
                  timelineEntries.map((entry, idx) => {
                    let badgeColor = 'rgba(255,255,255,0.05)';
                    let textColor = '#abb2bf';
                    
                    if (entry.type.includes('swept')) {
                      badgeColor = 'rgba(239,83,80,0.15)';
                      textColor = '#ff5252';
                    } else if (entry.type.includes('confirmed')) {
                      badgeColor = 'rgba(0,230,118,0.15)';
                      textColor = '#00e676';
                    } else if (entry.type.includes('range-completed')) {
                      badgeColor = 'rgba(255,179,0,0.15)';
                      textColor = '#ffb300';
                    } else if (entry.type.includes('range-started')) {
                      badgeColor = 'rgba(33,150,243,0.15)';
                      textColor = '#2196f3';
                    }

                    return (
                      <div key={idx} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '8px',
                        background: '#1a1d2c',
                        borderRadius: '4px',
                        borderLeft: `3px solid ${textColor === '#abb2bf' ? 'var(--border)' : textColor}`
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px', color: 'var(--text-muted)' }}>
                          <span style={{ fontFamily: 'monospace' }}>[{entry.timeStr}]</span>
                          <span style={{
                            padding: '1px 4px',
                            background: badgeColor,
                            color: textColor,
                            borderRadius: '3px',
                            fontWeight: 'bold',
                            fontSize: '8px',
                            textTransform: 'uppercase'
                          }}>
                            {entry.type}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#fff', lineHeight: '1.4' }}>
                          {entry.text}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Waiting for events...
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}



      {rightSidebarTab === 'chat' && (
        <ChatAssistant 
          activeSymbol={activeSymbol}
          drawings={drawings}
          setDrawings={setDrawings}
        />
      )}
    </aside>
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
    // Check start visibility
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
    }

    else if (c.type === 'liquidity') {
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
    }

    else if (c.type === 'intent') {
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
    }

    else if (c.type === 'delivery_leg') {
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
    }

    else if (c.type === 'structure_confirmation' || c.type === 'structure_confirm') {
      if (c.time <= limit) {
        entries.push({
          time: c.time,
          timeStr: formatTime(c.time),
          text: `Structure Confirmed (${c.direction.toUpperCase()} BOS at ${c.priceHigh.toFixed(2)})`,
          type: 'structure-confirmed'
        });
      }
    }

    else if (c.type === 'dealing_range') {
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

  // Sort entries chronologically
  entries.sort((a, b) => a.time - b.time);

  // Return unique timeline events
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

