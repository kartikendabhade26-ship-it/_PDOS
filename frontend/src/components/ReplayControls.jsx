import React from 'react';

export default function ReplayControls({
  replayMode,
  replayToolbarPos,
  handleReplayDragStart,
  activeSession,
  allBars,
  replayIndex,
  setReplayIndex,
  setCurrentSubStep,
  replaySpeed,
  setReplaySpeed,
  currentReplayDateString,
  handleDateJump,
  handleStepBack,
  toggleReplayPlay,
  isReplayPlaying,
  isTimeframeDropdownOpen,
  setIsTimeframeDropdownOpen,
  replayTimeframeOption,
  setReplayTimeframeOption,
  handleStepForward,
  handleExitReplay
}) {
  if (!replayMode) return null;

  const currentBar = allBars[replayIndex - 1];
  const currentEstTime = currentBar
    ? new Date(currentBar.time * 1000).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : '';

  return (
    <div 
      className="replay-controls-bar"
      style={{
        left: `${replayToolbarPos.x}px`,
        top: `${replayToolbarPos.y}px`,
        transform: 'none', // override centering transform for drag positioning
      }}
      onMouseDown={handleReplayDragStart}
    >
      {/* Drag Handle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'grab', padding: '0 4px' }} title="Drag to move">
        <div style={{ display: 'flex', gap: '2px' }}>
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
        </div>
        <div style={{ display: 'flex', gap: '2px' }}>
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
        </div>
        <div style={{ display: 'flex', gap: '2px' }}>
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
          <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#787b86' }} />
        </div>
      </div>

      {/* Jump to start/first bar */}
      <button 
        className="toolbar-btn" 
        onClick={() => {
          if (activeSession && allBars.length > 0) {
            const startSec = Math.floor(new Date(activeSession.startDate).getTime() / 1000);
            const idx = allBars.findIndex(b => b.time >= startSec);
            if (idx !== -1) {
              setReplayIndex(idx + 1);
              setCurrentSubStep(0);
            }
          } else {
            setReplayIndex(Math.min(100, allBars.length));
            setCurrentSubStep(0);
          }
        }}
        title="Jump to Start"
        style={{ background: 'none', border: 'none', color: '#787b86', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 20L9 12L19 4M5 19V5" />
        </svg>
      </button>

      {/* Speed Slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input 
          type="range" 
          min="200" 
          max="3000" 
          step="100" 
          value={3200 - replaySpeed} 
          onChange={(e) => setReplaySpeed(3200 - Number(e.target.value))} 
          style={{ width: '50px', cursor: 'pointer' }}
          className="replay-slider"
          title={`Speed: ${replaySpeed}ms`}
        />
        <div style={{ display: 'flex', gap: '2px' }}>
          {[500, 1000, 2000].map(speed => (
            <button
              key={speed}
              type="button"
              style={{
                padding: '1px 3px',
                fontSize: '8px',
                background: replaySpeed === speed ? '#2962ff' : '#2a2e39',
                color: '#ffffff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                fontFamily: 'Outfit, sans-serif'
              }}
              onClick={() => setReplaySpeed(speed)}
              title={`Set speed to ${speed / 1000}s`}
            >
              {speed / 1000}s
            </button>
          ))}
        </div>
      </div>

      {/* Replay Date Jump Calendar Picker */}
      <input 
        type="date"
        value={currentReplayDateString}
        onChange={(e) => handleDateJump(e.target.value)}
        style={{
          background: '#1e222d',
          border: '1px solid #2a2e39',
          color: '#b2b5be',
          fontSize: '11px',
          fontFamily: "'Outfit', sans-serif",
          borderRadius: '4px',
          padding: '2px 4px',
          height: '22px',
          width: '110px',
          outline: 'none',
          cursor: 'pointer',
          marginLeft: '4px',
          marginRight: '4px'
        }}
        title="Jump to date"
      />

      <div className="divider-vert" style={{ height: '18px', margin: '0 2px' }} />

      {/* Step Backward */}
      <button 
        className="toolbar-btn" 
        onClick={handleStepBack} 
        title="Step Backward (Left Arrow)"
        style={{ background: 'none', border: 'none', color: '#b2b5be', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 19h2V5H6v14zm3.5-7L18 5v14l-8.5-7z"/>
        </svg>
      </button>

      {/* Play/Pause */}
      <button 
        className="toolbar-btn" 
        onClick={toggleReplayPlay} 
        title={isReplayPlaying ? "Pause (Space)" : "Play (Space)"}
        style={{ background: 'none', border: 'none', color: '#b2b5be', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
      >
        {isReplayPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Time-Machine Scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 auto', margin: '0 8px', borderLeft: '1px solid #2a2e39', paddingLeft: '8px' }}>
        <span style={{ fontSize: '10px', color: '#787b86', fontFamily: 'Outfit, sans-serif' }}>
          {replayIndex}/{allBars.length}
        </span>
        <input
          type="range"
          min="1"
          max={allBars.length || 1}
          value={replayIndex}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            setReplayIndex(idx);
            setCurrentSubStep(0);
          }}
          style={{
            flex: '1 1 auto',
            cursor: 'pointer',
            height: '4px',
            borderRadius: '2px',
            outline: 'none',
            WebkitAppearance: 'none',
            background: `linear-gradient(to right, #2962ff 0%, #2962ff ${(replayIndex / (allBars.length || 1)) * 100}%, #2a2e39 ${(replayIndex / (allBars.length || 1)) * 100}%, #2a2e39 100%)`
          }}
          className="replay-scrubber"
          title="Drag to scrub replay time"
        />
        {currentBar && (
          <span style={{ fontSize: '10px', color: '#b2b5be', fontFamily: 'Outfit, sans-serif', whiteSpace: 'nowrap' }}>
            {new Date(currentBar.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
          </span>
        )}
      </div>

      {/* Timeframe selector dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
          style={{
            background: 'none',
            border: 'none',
            color: '#ffb74d', 
            fontWeight: 600,
            fontSize: '11px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            padding: '2px 4px',
            borderRadius: '3px',
          }}
          title="Select Replay Timeframe / Tick Rate"
        >
          <span>{replayTimeframeOption}</span>
          <span style={{ fontSize: '8px', color: '#787b86' }}>
            {isTimeframeDropdownOpen ? '▲' : '▼'}
          </span>
        </button>
        
        {isTimeframeDropdownOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '25px', 
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#0f1115',
              border: '1px solid #2a2e39',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.8)',
              zIndex: 1010,
              display: 'flex',
              flexDirection: 'column',
              width: '60px',
              maxHeight: '160px',
              overflowY: 'auto'
            }}
          >
            {['5s', '10s', '15s', '30s', '1m', '3m', '5m', '10m'].map(opt => (
              <button
                key={opt}
                onClick={() => {
                  setReplayTimeframeOption(opt);
                  setIsTimeframeDropdownOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: replayTimeframeOption === opt ? '#2962ff' : '#b2b5be',
                  padding: '6px 0',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'center',
                  width: '100%',
                  borderBottom: '1px solid rgba(255,255,255,0.02)'
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Step Forward */}
      <button 
        className="toolbar-btn" 
        onClick={handleStepForward} 
        title="Step Forward (Right Arrow)"
        style={{ background: 'none', border: 'none', color: '#b2b5be', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 5v14l8.5-7L6 5zm10 14h2V5h-2v14z"/>
        </svg>
      </button>

      <div className="divider-vert" style={{ height: '18px', margin: '0 2px' }} />

      {/* Exit Toggle Switch */}
      <div style={{ display: 'flex', alignItems: 'center' }} title="Toggle Replay Mode (Exit)">
        <label className="replay-switch">
          <input 
            type="checkbox" 
            checked={replayMode} 
            onChange={handleExitReplay}
          />
          <span className="replay-switch-slider"></span>
        </label>
      </div>

      <div className="divider-vert" style={{ height: '18px', margin: '0 4px 0 2px' }} />

      {/* Info Badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#fff', paddingRight: '4px', whiteSpace: 'nowrap' }}>
        {currentEstTime && <span style={{ color: '#ffb74d', fontWeight: 600 }}>{currentEstTime} EST</span>}
        <span 
          style={{ 
            backgroundColor: '#ef5350', 
            color: '#fff', 
            fontSize: '9px', 
            fontWeight: 'bold', 
            padding: '2px 6px', 
            borderRadius: '3px' 
          }}
          title="Price delivery events beyond the current replay candle are hidden."
        >
          FUTURE HIDDEN
        </span>
      </div>
    </div>
  );
}
