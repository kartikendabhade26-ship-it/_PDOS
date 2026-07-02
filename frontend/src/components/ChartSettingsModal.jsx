import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import '../index.css';

export default function ChartSettingsModal({ 
  onClose,
  chartSettings, setChartSettings,
  themeColor, setThemeColor,
  showSessions, setShowSessions,
  magnetMode, setMagnetMode,
  isDarkMode
}) {
  const [activeTab, setActiveTab] = useState('Symbol');

  // Track draft copies of state variables for dynamic update and cancel rollback
  const [draftSettings, setDraftSettings] = useState(() => JSON.parse(JSON.stringify(chartSettings)));
  const [draftThemeColor, setDraftThemeColor] = useState(themeColor);
  const [draftShowSessions, setDraftShowSessions] = useState(showSessions);
  const [draftMagnetMode, setDraftMagnetMode] = useState(magnetMode);

  // Custom Color Picker States
  const [recentColors, setRecentColors] = useState(['#e0e3eb', '#4caf50', '#000000', '#868993', '#2a2e39']);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [val, setVal] = useState(1);
  const [hexInput, setHexInput] = useState('#ff0000');
  const [activePopover, setActivePopover] = useState(null); // settingKey e.g. 'upColor'

  const palette = [
    ['#ffffff', '#e0e3eb', '#d1d4dc', '#b2b5be', '#868993', '#60626a', '#434651', '#2a2e39', '#131722', '#000000'],
    ['#ff0000', '#ff9800', '#ffeb3b', '#4caf50', '#00bcd4', '#2196f3', '#3f51b5', '#9c27b0', '#e91e63', '#ea4c89'],
    ['#ffebee', '#fff3e0', '#fffde7', '#e8f5e9', '#e0f7fa', '#e3f2fd', '#e8eaf6', '#f3e5f5', '#fce4ec', '#fbe9e7'],
    ['#ffcdd2', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2ebf2', '#bbdefb', '#c5cae9', '#d1c4e9', '#f8bbd0', '#ffccbc'],
    ['#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80deea', '#90caf9', '#9fa8da', '#b39ddb', '#f48fb1', '#ffab91'],
    ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8', '#f06292', '#ff8a65'],
    ['#c62828', '#ef6c00', '#fbc02d', '#2e7d32', '#00838f', '#1565c0', '#283593', '#6a1b9a', '#ad1457', '#d84315']
  ];

  const hsvToHex = (h, s, v) => {
    let r, g, b;
    const i = Math.floor(h / 60) % 6;
    const f = h / 60 - Math.floor(h / 60);
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    const toHex = x => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const hexToHSV = (hex) => {
    let r = 0, g = 0, b = 0;
    if (hex && hex.startsWith('#')) {
      const clean = hex.replace('#', '');
      if (clean.length === 3) {
        r = parseInt(clean[0] + clean[0], 16) / 255;
        g = parseInt(clean[1] + clean[1], 16) / 255;
        b = parseInt(clean[2] + clean[2], 16) / 255;
      } else if (clean.length === 6) {
        r = parseInt(clean.substring(0, 2), 16) / 255;
        g = parseInt(clean.substring(2, 4), 16) / 255;
        b = parseInt(clean.substring(4, 6), 16) / 255;
      }
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
      h = 0;
    } else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s, v };
  };

  const getCurrentColor = (settingKey) => {
    return draftSettings[settingKey] || (
      settingKey === 'upColor' || settingKey === 'borderUpColor' || settingKey === 'wickUpColor' ? '#089981' :
      settingKey === 'downColor' || settingKey === 'borderDownColor' || settingKey === 'wickDownColor' ? '#f23645' :
      settingKey === 'bgColor' ? (isDarkMode ? '#131722' : '#f0f3fa') :
      settingKey === 'gridColor' ? (isDarkMode ? '#2a2e39' : '#e1e4eb') :
      settingKey === 'textColor' ? (isDarkMode ? '#b2b5be' : '#70737d') : '#2962ff'
    );
  };

  const handleColorSelect = (settingKey, val) => {
    handleSettingChange(settingKey, val);
  };

  const renderPopover = (settingKey) => {
    const handleSVMouseDown = (e) => {
      e.preventDefault();
      const box = e.currentTarget;
      const update = (moveEvent) => {
        const rect = box.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
        const v = Math.max(0, Math.min(1, 1 - (moveEvent.clientY - rect.top) / rect.height));
        setSat(s);
        setVal(v);
        const hex = hsvToHex(hue, s, v);
        setHexInput(hex);
        handleColorSelect(settingKey, hex);
      };
      update(e);
      const handleMouseUp = () => {
        window.removeEventListener('mousemove', update);
        window.removeEventListener('mouseup', handleMouseUp);
      };
      window.addEventListener('mousemove', update);
      window.addEventListener('mouseup', handleMouseUp);
    };

    const handleHueMouseDown = (e) => {
      e.preventDefault();
      const slider = e.currentTarget;
      const update = (moveEvent) => {
        const rect = slider.getBoundingClientRect();
        const h = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height)) * 360;
        setHue(h);
        const hex = hsvToHex(h, sat, val);
        setHexInput(hex);
        handleColorSelect(settingKey, hex);
      };
      update(e);
      const handleMouseUp = () => {
        window.removeEventListener('mousemove', update);
        window.removeEventListener('mouseup', handleMouseUp);
      };
      window.addEventListener('mousemove', update);
      window.addEventListener('mouseup', handleMouseUp);
    };

    const handleHexInputChange = (e) => {
      const val = e.target.value;
      setHexInput(val);
      if (/^#[0-9A-F]{6}$/i.test(val)) {
        const { h, s, v } = hexToHSV(val);
        setHue(h);
        setSat(s);
        setVal(v);
        handleColorSelect(settingKey, val);
      }
    };

    const handlePlusClick = () => {
      setIsChooserOpen(true);
      const currentColor = getCurrentColor(settingKey);
      setHexInput(currentColor);
      const { h, s, v } = hexToHSV(currentColor);
      setHue(h);
      setSat(s);
      setVal(v);
    };

    const handleCustomColorAdd = () => {
      if (/^#[0-9A-F]{6}$/i.test(hexInput)) {
        if (!recentColors.includes(hexInput.toLowerCase()) && !recentColors.includes(hexInput.toUpperCase())) {
          const updatedRecent = [hexInput, ...recentColors.slice(0, 9)];
          setRecentColors(updatedRecent);
        }
        handleColorSelect(settingKey, hexInput);
        setIsChooserOpen(false);
      }
    };

    return (
      <div 
        style={{
          position: 'absolute',
          right: '0px',
          top: '36px',
          backgroundColor: '#1c2030',
          border: '1px solid #2a2e39',
          borderRadius: '6px',
          padding: '12px',
          zIndex: 500,
          width: '240px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          boxSizing: 'border-box'
        }}
        onClick={e => e.stopPropagation()}
      >
        {isChooserOpen ? (
          /* Custom Color Chooser Panel */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                backgroundColor: hexInput,
                borderRadius: '4px',
                border: '1px solid #2a2e39'
              }} />
              <input 
                type="text" 
                value={hexInput} 
                onChange={handleHexInputChange}
                style={{
                  width: '80px',
                  height: '24px',
                  backgroundColor: '#131722',
                  border: '1px solid #2a2e39',
                  color: '#ffffff',
                  borderRadius: '4px',
                  padding: '0 6px',
                  fontSize: '11px',
                  fontFamily: 'Outfit, sans-serif',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <button 
                onClick={handleCustomColorAdd}
                style={{
                  height: '24px',
                  padding: '0 10px',
                  backgroundColor: '#ffffff',
                  color: '#131722',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: '600',
                  fontFamily: 'Outfit, sans-serif'
                }}
              >
                Add
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <div 
                onMouseDown={handleSVMouseDown}
                style={{
                  position: 'relative',
                  width: '156px',
                  height: '120px',
                  backgroundColor: hsvToHex(hue, 1, 1),
                  backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
                  borderRadius: '4px',
                  cursor: 'crosshair',
                  overflow: 'hidden'
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: `${sat * 100}%`,
                  top: `${(1 - val) * 100}%`,
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  border: '1px solid #ffffff',
                  boxShadow: '0 0 2px rgba(0,0,0,0.8)',
                  transform: 'translate(-3px, -3px)',
                  pointerEvents: 'none'
                }} />
              </div>

              <div 
                onMouseDown={handleHueMouseDown}
                style={{
                  position: 'relative',
                  width: '14px',
                  height: '120px',
                  backgroundImage: 'linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: `${(hue / 360) * 100}%`,
                  left: '-2px',
                  right: '-2px',
                  height: '2px',
                  backgroundColor: '#ffffff',
                  border: '1.5px solid #000000',
                  transform: 'translateY(-1px)',
                  pointerEvents: 'none'
                }} />
              </div>
            </div>

            <button 
              onClick={() => setIsChooserOpen(false)}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#787b86',
                cursor: 'pointer',
                fontSize: '10px',
                textAlign: 'left',
                padding: '4px 0',
                outline: 'none'
              }}
            >
              ← Back to palette
            </button>
          </div>
        ) : (
          /* Standard Color Grid and Recents List */
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 18px)', gap: '4px', margin: '4px 0' }}>
              {palette.flat().map(c => (
                <div 
                  key={c}
                  onClick={() => handleColorSelect(settingKey, c)}
                  style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: c,
                    borderRadius: '2px',
                    cursor: 'pointer',
                    border: (getCurrentColor(settingKey).toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : '1px solid transparent'
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: '4px', marginTop: '6px', borderTop: '1px solid #2a2e39', paddingTop: '6px', alignItems: 'center' }}>
              {recentColors.map((c, i) => (
                <div 
                  key={i}
                  style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: c,
                    borderRadius: '2px',
                    cursor: 'pointer',
                    border: (getCurrentColor(settingKey).toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : 'none'
                  }}
                  onClick={() => handleColorSelect(settingKey, c)}
                />
              ))}
              <span 
                onClick={handlePlusClick}
                style={{ color: '#d1d4dc', fontSize: '14px', cursor: 'pointer', marginLeft: '4px', lineHeight: 1 }}
              >
                +
              </span>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderColorPickerButton = (settingKey, isDisabled = false) => {
    const isSelected = activePopover === settingKey;
    const currentColor = getCurrentColor(settingKey);
    
    return (
      <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
        <button
          disabled={isDisabled}
          onClick={() => {
            if (activePopover === settingKey) {
              setActivePopover(null);
            } else {
              setActivePopover(settingKey);
              setIsChooserOpen(false);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: isDisabled ? 'default' : 'pointer',
            height: '28px',
            width: '42px',
            justifyContent: 'center',
            opacity: isDisabled ? 0.4 : 1.0,
            outline: 'none'
          }}
        >
          <div style={{
            width: '24px',
            height: '14px',
            backgroundColor: currentColor,
            borderRadius: '2px',
            border: '1.5px solid rgba(255, 255, 255, 0.2)'
          }} />
        </button>
        {isSelected && renderPopover(settingKey)}
      </div>
    );
  };

  // Close popover when clicking elsewhere
  useEffect(() => {
    const handleGlobalClick = () => {
      setActivePopover(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  // Snapshots for cancel rollback
  const originalSettings = useRef(JSON.parse(JSON.stringify(chartSettings)));
  const originalThemeColor = useRef(themeColor);
  const originalShowSessions = useRef(showSessions);
  const originalMagnetMode = useRef(magnetMode);

  // Window dragging offset state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const modalStart = useRef({ x: 0, y: 0 });

  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    modalStart.current = { ...dragOffset };
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setDragOffset({
        x: modalStart.current.x + dx,
        y: modalStart.current.y + dy
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleSettingChange = (key, val) => {
    const updated = { ...draftSettings, [key]: val };
    setDraftSettings(updated);
    setChartSettings(updated); // Propagate change live to the chart
  };

  const handleThemeColorChange = (color) => {
    setDraftThemeColor(color);
    setThemeColor(color);
  };

  const handleShowSessionsChange = (val) => {
    setDraftShowSessions(val);
    setShowSessions(val);
  };

  const handleMagnetModeChange = (val) => {
    setDraftMagnetMode(val);
    setMagnetMode(val);
  };

  const handleOk = () => {
    onClose(); // Save values (they are already live)
  };

  const handleCancel = () => {
    // Restore all original settings
    setChartSettings(originalSettings.current);
    setThemeColor(originalThemeColor.current);
    setShowSessions(originalShowSessions.current);
    setMagnetMode(originalMagnetMode.current);
    onClose();
  };

  const tabs = [
    { id: 'Symbol' },
    { id: 'Status line' },
    { id: 'Scales and lines' },
    { id: 'Canvas' },
    { id: 'Trading' },
    { id: 'Alerts' },
    { id: 'Events' }
  ];

  return (
    <div className="tv-settings-overlay" onClick={handleCancel}>
      <div 
        className="tv-settings-modal" 
        onClick={e => e.stopPropagation()}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        
        {/* Header */}
        <div 
          className="tv-settings-header" 
          onMouseDown={handleHeaderMouseDown} 
          style={{ cursor: 'move', userSelect: 'none' }}
        >
          <h2>Settings</h2>
          <button className="tv-settings-close" onClick={handleCancel}>
            <X size={18} />
          </button>
        </div>

        {/* Body Layout */}
        <div className="tv-settings-body">
          {/* Sidebar */}
          <div className="tv-settings-sidebar">
            {tabs.map(tab => (
              <button 
                key={tab.id}
                className={`tv-sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.id}
              </button>
            ))}
          </div>

          {/* Content Area */}
          <div className="tv-settings-content">
            
            {activeTab === 'Symbol' && (
              <div className="tv-tab-pane">
                <h3>CANDLES</h3>
                <label className="tv-checkbox-row">
                  <input type="checkbox" />
                  <span>Color bars based on previous close</span>
                </label>
                
                <div className="tv-color-row">
                  <label className="tv-checkbox-row">
                    <input 
                      type="checkbox" 
                      checked={draftSettings.showCandleBody} 
                      onChange={e => handleSettingChange('showCandleBody', e.target.checked)} 
                    />
                    <span>Body</span>
                  </label>
                  <div className="tv-color-pickers" style={{ display: 'flex', gap: '4px' }}>
                    {renderColorPickerButton('upColor', !draftSettings.showCandleBody)}
                    {renderColorPickerButton('downColor', !draftSettings.showCandleBody)}
                  </div>
                </div>

                <div className="tv-color-row">
                  <label className="tv-checkbox-row">
                    <input 
                      type="checkbox" 
                      checked={draftSettings.showCandleBorders} 
                      onChange={e => handleSettingChange('showCandleBorders', e.target.checked)} 
                    />
                    <span>Borders</span>
                  </label>
                  <div className="tv-color-pickers" style={{ display: 'flex', gap: '4px' }}>
                    {renderColorPickerButton('borderUpColor', !draftSettings.showCandleBorders)}
                    {renderColorPickerButton('borderDownColor', !draftSettings.showCandleBorders)}
                  </div>
                </div>

                <div className="tv-color-row">
                  <label className="tv-checkbox-row">
                    <input 
                      type="checkbox" 
                      checked={draftSettings.showCandleWicks} 
                      onChange={e => handleSettingChange('showCandleWicks', e.target.checked)} 
                    />
                    <span>Wick</span>
                  </label>
                  <div className="tv-color-pickers" style={{ display: 'flex', gap: '4px' }}>
                    {renderColorPickerButton('wickUpColor', !draftSettings.showCandleWicks)}
                    {renderColorPickerButton('wickDownColor', !draftSettings.showCandleWicks)}
                  </div>
                </div>

                <h3 className="mt-4">DATA MODIFICATION</h3>
                <div className="tv-select-row">
                  <span>Session</span>
                  <select>
                    <option>Electronic trading hours</option>
                    <option>Regular trading hours</option>
                  </select>
                </div>

                <label className="tv-checkbox-row">
                  <input 
                    type="checkbox" 
                    checked={draftShowSessions} 
                    onChange={e => handleShowSessionsChange(e.target.checked)} 
                  />
                  <span>Electronic trading hours background (ICT Killzones)</span>
                </label>

                <div className="tv-select-row">
                  <span>Precision</span>
                  <select>
                    <option>Default</option>
                  </select>
                </div>

                <div className="tv-select-row">
                  <span>Timezone</span>
                  <select>
                    <option>(UTC-4) New York</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'Status line' && (
              <div className="tv-tab-pane">
                <h3>INSTRUMENT</h3>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Logo</span></label>
                <div className="tv-select-row">
                  <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Title</span></label>
                  <select><option>Name</option></select>
                </div>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Open market status</span></label>
                <label className="tv-checkbox-row">
                  <input 
                    type="checkbox" 
                    checked={draftSettings.showOhlc} 
                    onChange={e => handleSettingChange('showOhlc', e.target.checked)} 
                  />
                  <span>Chart values (OHLC)</span>
                </label>
                <label className="tv-checkbox-row"><input type="checkbox" /><span>Bar change values</span></label>
                <label className="tv-checkbox-row"><input type="checkbox" /><span>Volume</span></label>
                <label className="tv-checkbox-row"><input type="checkbox" /><span>Last day change values</span></label>

                <h3 className="mt-4">INDICATORS</h3>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Titles</span></label>
                <label className="tv-checkbox-row indent"><input type="checkbox" defaultChecked /><span>Inputs</span></label>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Values</span></label>
                <div className="tv-color-row">
                  <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Background</span></label>
                  <input type="range" className="tv-slider" />
                </div>
              </div>
            )}

            {activeTab === 'Scales and lines' && (
              <div className="tv-tab-pane">
                <div className="tv-select-row">
                  <span>Currency and Unit</span>
                  <select><option>Always visible</option></select>
                </div>
                <div className="tv-select-row">
                  <span>Scale modes (A and L)</span>
                  <select><option>Visible on mouse over</option></select>
                </div>
                <label className="tv-checkbox-row"><input type="checkbox" /><span>Lock price to bar ratio</span></label>
                <div className="tv-select-row">
                  <span>Scales placement</span>
                  <select><option>Auto</option></select>
                </div>

                <h3 className="mt-4">PRICE LABELS & LINES</h3>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>No overlapping labels</span></label>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Plus button</span></label>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Countdown to bar close</span></label>
                <div className="tv-color-row">
                  <span>Text color</span>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    {renderColorPickerButton('textColor')}
                  </div>
                </div>
                <div className="tv-color-row">
                  <span>Symbol</span>
                  <div className="tv-color-pickers">
                    <select><option>Value according to scale</option></select>
                  </div>
                </div>

                <h3 className="mt-4">TIME SCALE</h3>
                <label className="tv-checkbox-row"><input type="checkbox" defaultChecked /><span>Day of week on labels</span></label>
                <div className="tv-select-row">
                  <span>Date format</span>
                  <select><option>yyyy-MM-dd</option></select>
                </div>
                <div className="tv-select-row">
                  <span>Time hours format</span>
                  <select><option>24-hours</option></select>
                </div>
              </div>
            )}

            {activeTab === 'Canvas' && (
              <div className="tv-tab-pane">
                <h3>CHART BASIC STYLES</h3>
                <div className="tv-color-row">
                  <span>Background</span>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    <select><option>Solid</option></select>
                    {renderColorPickerButton('bgColor')}
                  </div>
                </div>

                <div className="tv-color-row">
                  <span>Scales text color</span>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    {renderColorPickerButton('textColor')}
                  </div>
                </div>

                <div className="tv-color-row">
                  <label className="tv-checkbox-row" style={{ margin: 0 }}>
                    <input 
                      type="checkbox" 
                      checked={draftSettings.showGridLines} 
                      onChange={e => handleSettingChange('showGridLines', e.target.checked)} 
                    />
                    <span>Grid lines</span>
                  </label>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    {renderColorPickerButton('gridColor', !draftSettings.showGridLines)}
                  </div>
                </div>

                <div className="tv-color-row">
                  <span>Crosshair</span>
                  <div style={{display:'flex', gap: '10px', alignItems: 'center'}}>
                    <select><option>Dashed</option></select>
                    <div className="tv-color-swatch" style={{ background: '#787b86' }}></div>
                  </div>
                </div>
                
                <div className="tv-color-row">
                  <span>Line Chart Color Theme</span>
                  <div className="tv-color-pickers" style={{ display: 'flex', gap: '4px' }}>
                    {[
                      '#2962ff', '#26a69a', '#ef5350', '#ff9100', '#aa00ff', '#ffffff'
                    ].map(col => (
                      <div
                        key={col}
                        className={`tv-color-swatch ${draftThemeColor === col ? 'selected' : ''}`}
                        style={{ background: col, border: draftThemeColor === col ? '2px solid white' : '1px solid #363c4e' }}
                        onClick={() => handleThemeColorChange(col)}
                      />
                    ))}
                  </div>
                </div>

                <label className="tv-checkbox-row mt-4">
                  <input 
                    type="checkbox" 
                    checked={draftMagnetMode} 
                    onChange={e => handleMagnetModeChange(e.target.checked)} 
                  />
                  <span>Enable cursor magnet snapping (Canvas tools)</span>
                </label>
              </div>
            )}
            
            {(activeTab === 'Trading' || activeTab === 'Alerts' || activeTab === 'Events') && (
              <div className="tv-tab-pane">
                <div style={{ padding: '20px', color: '#787b86' }}>
                  These settings are placeholders for the '{activeTab}' category.
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="tv-settings-footer">
          <div className="tv-settings-footer-left">
            <button className="tv-btn-secondary">Template</button>
          </div>
          <div className="tv-settings-footer-right">
            <button className="tv-btn-secondary" onClick={handleCancel}>Cancel</button>
            <button className="tv-btn-primary" onClick={handleOk}>Ok</button>
          </div>
        </div>

      </div>
    </div>
  );
}
