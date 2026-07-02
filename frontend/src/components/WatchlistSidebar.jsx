import React from 'react';
import ChatAssistant from './ChatAssistant';

// Static watchlist context symbols (the project only ships NQ_Historical_Data,
// so these provide TradingView-style visual context for the futures chain).
const CONTEXT_SYMBOLS = [
  { sym: 'ES1!',   price: 5800.25,  changePct:  0.4 },
  { sym: 'NQ1!',   price: 20150.75, changePct: -0.2 },
  { sym: 'YM1!',   price: 42150.00, changePct:  0.1 },
  { sym: 'RTY1!',  price: 2045.50,  changePct:  0.8 }
];

function formatPrice(p) {
  if (p == null || Number.isNaN(p)) return '—';
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChangePct(pct) {
  if (pct == null || Number.isNaN(pct)) return '';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

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
    selectableRanges.push({ id: mainRange.id, label: `Dominant Active Range (${mainRange.direction === 'bullish' ? 'Bull' : 'Bear'})` });
  }
  nestedRanges.forEach((r) => {
    selectableRanges.push({ id: r.id, label: `Nested Child Range (TF: ${r.timeframe}m, ${r.direction === 'bullish' ? 'Bull' : 'Bear'})` });
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

  // Real symbol last close (from chart bars) — used to mark the active symbol's live price.
  const realLastBar = (replayMode && replayIndex > 0)
    ? allBars[replayIndex - 1]
    : (allBars && allBars.length > 0 ? allBars[allBars.length - 1] : null);
  const realPrevBar = (replayMode && replayIndex > 1)
    ? allBars[replayIndex - 2]
    : (allBars && allBars.length > 1 ? allBars[allBars.length - 2] : null);
  const realLastPrice = realLastBar?.close ?? null;
  const realChangePct = (realLastBar && realPrevBar && realPrevBar.close !== 0)
    ? ((realLastBar.close - realPrevBar.close) / realPrevBar.close) * 100
    : null;

  return (
    <aside className="watchlist-sidebar">
      {/* Tab header (32px tall, text-only, accent underline) */}
      <div className="watchlist-header">
        <button
          className={`watchlist-tab ${rightSidebarTab === 'market' ? 'active' : ''}`}
          onClick={() => setRightSidebarTab('market')}
        >
          Watchlist
        </button>
        <button
          className={`watchlist-tab ${rightSidebarTab === 'research' ? 'active' : ''}`}
          onClick={() => setRightSidebarTab('research')}
        >
          Details
        </button>
        <button
          className={`watchlist-tab ${rightSidebarTab === 'chat' ? 'active' : ''}`}
          onClick={() => setRightSidebarTab('chat')}
        >
          AI Chat
        </button>
      </div>

      {/* WATCHLIST TAB */}
      {rightSidebarTab === 'market' && (
        <div className="watchlist-list">
          {/* Real chart symbols (active = the symbol currently loaded on the chart) */}
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
                  <div className="symbol-price">
                    {isActive && realLastPrice !== null ? formatPrice(realLastPrice) : '—'}
                  </div>
                  {isActive && realChangePct !== null && (
                    <div className={`symbol-change ${realChangePct >= 0 ? 'up' : 'dn'}`}>
                      {formatChangePct(realChangePct)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Divider between real and context symbols */}
          <div style={{ padding: '6px 12px 4px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Context (futures chain)
          </div>

          {/* Static context symbols for visual TradingView-like density */}
          {CONTEXT_SYMBOLS.map(ctx => (
            <div
              key={ctx.sym}
              className="watchlist-item"
              onClick={(e) => {
                e.preventDefault();
                // Context symbols are not real data — clicking them is a no-op
                // (preserves the active symbol).
              }}
              style={{ opacity: 0.7 }}
              title="Context symbol — not in local database"
            >
              <div>
                <div className="symbol-name">{ctx.sym}</div>
                <div className="symbol-desc">CME Futures (static)</div>
              </div>
              <div className="symbol-price-group">
                <div className="symbol-price">{formatPrice(ctx.price)}</div>
                <div className={`symbol-change ${ctx.changePct >= 0 ? 'up' : 'dn'}`}>
                  {formatChangePct(ctx.changePct)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DETAILS TAB (selected annotation's key-value list) */}
      {rightSidebarTab === 'research' && (
        <div className="details-panel">
          <div className="details-section-title">Debug Overlay Filters</div>
          <div className="details-checkbox-grid">
            {[
              { key: 'swings', label: 'Fractal Swings' },
              { key: 'liquidity', label: 'Liquidity Pools' },
              { key: 'structure', label: 'Structure Breaks' },
              { key: 'dealingRanges', label: 'Dealing Ranges' }
            ].map(item => (
              <label key={item.key}>
                <input
                  type="checkbox"
                  checked={debugOverlayFilters?.[item.key] ?? true}
                  onChange={(e) => {
                    setDebugOverlayFilters(prev => ({
                      ...prev,
                      [item.key]: e.target.checked
                    }));
                  }}
                />
                {item.label}
              </label>
            ))}
          </div>

          <div className="details-section-title">Selected Annotation</div>
          {selectedAlgoCandidate ? (
            <div className="details-card">
              <div className="details-row">
                <span className="details-label">Type</span>
                <span className="details-value">{selectedAlgoCandidate.type}</span>
              </div>
              <div className="details-row">
                <span className="details-label">ID</span>
                <span className="details-value mono">{selectedAlgoCandidate.id?.slice(0, 12)}…</span>
              </div>
              {selectedAlgoCandidate.direction && (
                <div className="details-row">
                  <span className="details-label">Direction</span>
                  <span className={`details-value ${selectedAlgoCandidate.direction === 'bullish' ? 'up' : 'dn'}`}
                        style={{ color: selectedAlgoCandidate.direction === 'bullish' ? 'var(--green)' : 'var(--red)' }}>
                    {selectedAlgoCandidate.direction.toUpperCase()}
                  </span>
                </div>
              )}
              {selectedAlgoCandidate.priceHigh != null && (
                <div className="details-row">
                  <span className="details-label">High</span>
                  <span className="details-value mono">{selectedAlgoCandidate.priceHigh.toFixed(2)}</span>
                </div>
              )}
              {selectedAlgoCandidate.priceLow != null && (
                <div className="details-row">
                  <span className="details-label">Low</span>
                  <span className="details-value mono">{selectedAlgoCandidate.priceLow.toFixed(2)}</span>
                </div>
              )}
              {selectedAlgoCandidate.timeframe != null && (
                <div className="details-row">
                  <span className="details-label">Timeframe</span>
                  <span className="details-value mono">{selectedAlgoCandidate.timeframe}m</span>
                </div>
              )}
              {selectedAlgoCandidate.timeStart != null && (
                <div className="details-row">
                  <span className="details-label">Start</span>
                  <span className="details-value mono">
                    {new Date(selectedAlgoCandidate.timeStart * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                  </span>
                </div>
              )}
              {selectedAlgoCandidate.timeEnd != null && (
                <div className="details-row">
                  <span className="details-label">End</span>
                  <span className="details-value mono">
                    {new Date(selectedAlgoCandidate.timeEnd * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                  </span>
                </div>
              )}
              {selectedAlgoCandidate.state && (
                <div className="details-row">
                  <span className="details-label">State</span>
                  <span className="details-value accent">{selectedAlgoCandidate.state}</span>
                </div>
              )}
              <button
                className="details-jump-btn"
                onClick={() => onJumpToTime && onJumpToTime(selectedAlgoCandidate.time)}
              >
                Jump to Event
              </button>
            </div>
          ) : (
            <div className="details-empty">Select a chart annotation to see details</div>
          )}
        </div>
      )}

      {rightSidebarTab === 'narrative' && (() => {
        const activeBar = (replayMode && replayIndex > 0) ? allBars[replayIndex - 1] : allBars[allBars.length - 1];
        const currentPrice = activeBar ? activeBar.close : null;

        let quadrantLabel = 'N/A';
        let quadrantColor = 'var(--text)';
        if (selectedRangeObj && currentPrice !== null) {
          const eq = selectedRangeObj.properties?.equilibrium || ((selectedRangeObj.priceHigh + selectedRangeObj.priceLow) / 2);
          if (currentPrice > eq) {
            quadrantLabel = 'Premium Quadrant (Short bias)';
            quadrantColor = 'var(--red)';
          } else {
            quadrantLabel = 'Discount Quadrant (Long bias)';
            quadrantColor = 'var(--green)';
          }
        }

        const deliveryState = selectedRangeObj?.properties?.deliveryState || {};

        return (
          <div className="details-panel">
            <div className="details-section-title">Current Market Narrative</div>
            {selectedRangeObj ? (
              <div className="details-card">
                <div className="details-row">
                  <span className="details-label">Active Range</span>
                  <span className="details-value"
                        style={{ color: selectedRangeObj.direction === 'bullish' ? 'var(--green)' : 'var(--red)' }}>
                    {selectedRangeObj.direction.toUpperCase()} ({selectedRangeObj.timeframe}m)
                  </span>
                </div>
                <div className="details-row">
                  <span className="details-label">Range High</span>
                  <span className="details-value mono">{selectedRangeObj.priceHigh.toFixed(2)}</span>
                </div>
                <div className="details-row">
                  <span className="details-label">Equilibrium</span>
                  <span className="details-value mono" style={{ color: '#ffb300' }}>
                    {((selectedRangeObj.priceHigh + selectedRangeObj.priceLow) / 2).toFixed(2)}
                  </span>
                </div>
                <div className="details-row">
                  <span className="details-label">Range Low</span>
                  <span className="details-value mono">{selectedRangeObj.priceLow.toFixed(2)}</span>
                </div>
                <div className="details-row">
                  <span className="details-label">Current Price</span>
                  <span className="details-value mono">{currentPrice ? currentPrice.toFixed(2) : 'N/A'}</span>
                </div>
                <div className="details-row">
                  <span className="details-label">PD Quadrant</span>
                  <span className="details-value" style={{ color: quadrantColor }}>{quadrantLabel}</span>
                </div>
                <div className="details-row">
                  <span className="details-label">Protected Level</span>
                  <span className="details-value mono" style={{ color: '#ffb74d' }}>
                    {deliveryState.protected_level ? deliveryState.protected_level.toFixed(2) : 'N/A'}
                  </span>
                </div>
                <div className="details-row">
                  <span className="details-label">Current Extremum</span>
                  <span className="details-value mono" style={{ color: 'var(--green)' }}>
                    {deliveryState.current_extremum ? deliveryState.current_extremum.toFixed(2) : 'N/A'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="details-empty">No active narrative range detected</div>
            )}
          </div>
        );
      })()}

      {/* AI CHAT TAB */}
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

