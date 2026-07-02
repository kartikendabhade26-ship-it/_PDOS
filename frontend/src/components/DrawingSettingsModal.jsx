import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2 } from 'lucide-react';

export const DEFAULT_VISIBILITY = {
  Ticks: { visible: false },
  Seconds: { visible: false, min: 1, max: 59 },
  Minutes: { visible: true, min: 1, max: 59 },
  Hours: { visible: true, min: 1, max: 24 },
  Days: { visible: true, min: 1, max: 365 },
  Weeks: { visible: false },
  Months: { visible: false },
  Ranges: { visible: false }
};

export default function DrawingSettingsModal({
  isOpen,
  onClose,
  shape,
  updateShape,
  onAddUndoState,
  onPlaceTrade
}) {
  const [activeTab, setActiveTab] = useState('Style');
  const [draftShape, setDraftShape] = useState(null);
  const [originalShape, setOriginalShape] = useState(null);
  const [activePopover, setActivePopover] = useState(null);
  const [isExtendDropdownOpen, setIsExtendDropdownOpen] = useState(false);
  const prevIsOpen = useRef(false);

  // Template dropdown menu states and helpers
  const [templates, setTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem('tv_drawing_templates');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef(null);

  // Click outside to close template menu
  useEffect(() => {
    const clickOutside = (e) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target)) {
        setIsTemplateMenuOpen(false);
      }
    };
    if (isTemplateMenuOpen) {
      document.addEventListener('mousedown', clickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', clickOutside);
    };
  }, [isTemplateMenuOpen]);

  const saveTemplates = (newTemplates) => {
    setTemplates(newTemplates);
    localStorage.setItem('tv_drawing_templates', JSON.stringify(newTemplates));
  };

  const dropdownItemStyle = {
    background: 'none',
    border: 'none',
    color: '#d1d4dc',
    textAlign: 'left',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    width: '100%',
    fontFamily: 'Outfit, sans-serif',
    boxSizing: 'border-box'
  };

  // Custom Color Chooser States
  const [recentColors, setRecentColors] = useState(['#e0e3eb', '#4caf50', '#000000', '#868993', '#2a2e39']);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [val, setVal] = useState(1);
  const [hexInput, setHexInput] = useState('#ff0000');

  // Window dragging offset state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const modalStart = useRef({ x: 0, y: 0 });

  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest('button') || e.target.closest('select')) return;
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

  useEffect(() => {
    if (isOpen && !prevIsOpen.current && shape) {
      // Snapshot original state in case of Cancel
      setOriginalShape(JSON.parse(JSON.stringify(shape)));
      setDraftShape(JSON.parse(JSON.stringify(shape)));
      setActiveTab('Style');
      setDragOffset({ x: 300, y: -120 });
      setActivePopover(null);
      setIsExtendDropdownOpen(false);
      setIsChooserOpen(false);
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, shape]);

  if (!isOpen || !draftShape) return null;

  const handleDraftChange = (keyOrObj, val) => {
    let updated;
    if (typeof keyOrObj === 'object' && keyOrObj !== null) {
      updated = { ...draftShape, ...keyOrObj };
    } else {
      updated = { ...draftShape, [keyOrObj]: val };
    }
    setDraftShape(updated);
    // Live preview
    updateShape(updated);
  };

  const handleOk = () => {
    onAddUndoState(); // Commit the state change to undo stack
    onClose();
  };

  const handleCancel = () => {
    // Revert to original
    updateShape(originalShape);
    onClose();
  };

  const tabs = ['Style', 'Text', 'Coordinates', 'Visibility'];

  const palette = [
    ['#ffffff', '#e0e3eb', '#d1d4dc', '#b2b5be', '#868993', '#60626a', '#434651', '#2a2e39', '#131722', '#000000'],
    ['#ff0000', '#ff9800', '#ffeb3b', '#4caf50', '#00bcd4', '#2196f3', '#3f51b5', '#9c27b0', '#e91e63', '#ea4c89'],
    ['#ffebee', '#fff3e0', '#fffde7', '#e8f5e9', '#e0f7fa', '#e3f2fd', '#e8eaf6', '#f3e5f5', '#fce4ec', '#fbe9e7'],
    ['#ffcdd2', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2ebf2', '#bbdefb', '#c5cae9', '#d1c4e9', '#f8bbd0', '#ffccbc'],
    ['#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80deea', '#90caf9', '#9fa8da', '#b39ddb', '#f48fb1', '#ffab91'],
    ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8', '#f06292', '#ff8a65'],
    ['#c62828', '#ef6c00', '#fbc02d', '#2e7d32', '#00838f', '#1565c0', '#283593', '#6a1b9a', '#ad1457', '#d84315']
  ];

  const getExtendLabel = () => {
    const parts = [];
    if (draftShape.extendLeft) parts.push("Extend left");
    if (draftShape.extendRight) parts.push("Extend right");
    return parts.length > 0 ? parts.join(", ") : "Don't extend";
  };

  const getLineStyleIcon = (width, style) => {
    let strokeDash = '';
    if (style === 'dashed') strokeDash = '4 2';
    else if (style === 'dotted') strokeDash = '1 2';
    return (
      <svg width="24" height="12" style={{ display: 'block' }}>
        <line 
          x1="2" y1="6" x2="22" y2="6" 
          stroke="#787b86" 
          strokeWidth={Math.min(width, 4)} 
          strokeDasharray={strokeDash}
        />
      </svg>
    );
  };

  const getCurrentColor = (type) => {
    if (type === 'border') return draftShape.borderColor || draftShape.color || '#2962ff';
    if (type === 'line') return draftShape.color || '#2962ff';
    if (type === 'middleLine') return draftShape.middleLineColor || '#000000';
    if (type === 'background') return draftShape.backgroundColor || draftShape.color || '#2962ff';
    if (type === 'text') return draftShape.textColor || '#ffffff';
    return '#2962ff';
  };

  const getCurrentOpacity = (type) => {
    if (type === 'border') return draftShape.borderOpacity !== undefined ? draftShape.borderOpacity : 1.0;
    if (type === 'line') return draftShape.opacity !== undefined ? draftShape.opacity : 1.0;
    if (type === 'middleLine') return draftShape.middleLineOpacity !== undefined ? draftShape.middleLineOpacity : 1.0;
    if (type === 'background') return draftShape.backgroundOpacity !== undefined ? draftShape.backgroundOpacity : (draftShape.fillOpacity !== undefined ? draftShape.fillOpacity : 0.15);
    if (type === 'text') return draftShape.textOpacity !== undefined ? draftShape.textOpacity : 1.0;
    return 1.0;
  };

  const getCurrentThickness = (type) => {
    if (type === 'border') return draftShape.borderWidth || draftShape.width || 2;
    if (type === 'line') return draftShape.width || 2;
    if (type === 'middleLine') return draftShape.middleLineWidth || 1;
    return 1;
  };

  const getCurrentLineStyle = (type) => {
    if (type === 'border') return draftShape.borderStyle || draftShape.lineStyle || 'solid';
    if (type === 'line') return draftShape.lineStyle || 'solid';
    if (type === 'middleLine') return draftShape.middleLineStyle || 'solid';
    return 'solid';
  };

  const handleColorSelect = (type, val) => {
    if (type === 'border') {
      handleDraftChange({ borderColor: val, color: val });
    } else if (type === 'line') {
      handleDraftChange('color', val);
    } else if (type === 'middleLine') {
      handleDraftChange('middleLineColor', val);
    } else if (type === 'background') {
      handleDraftChange('backgroundColor', val);
    } else if (type === 'text') {
      handleDraftChange('textColor', val);
    }
  };

  const handleOpacityChange = (type, val) => {
    if (type === 'border') {
      handleDraftChange('borderOpacity', val);
    } else if (type === 'line') {
      handleDraftChange('opacity', val);
    } else if (type === 'middleLine') {
      handleDraftChange('middleLineOpacity', val);
    } else if (type === 'background') {
      handleDraftChange({ backgroundOpacity: val, fillOpacity: val });
    } else if (type === 'text') {
      handleDraftChange('textOpacity', val);
    }
  };

  const handleThicknessChange = (type, val) => {
    if (type === 'border') {
      handleDraftChange({ borderWidth: val, width: val });
    } else if (type === 'line') {
      handleDraftChange('width', val);
    } else if (type === 'middleLine') {
      handleDraftChange('middleLineWidth', val);
    }
  };

  const handleLineStyleChange = (type, val) => {
    if (type === 'border') {
      handleDraftChange({ borderStyle: val, lineStyle: val });
    } else if (type === 'line') {
      handleDraftChange('lineStyle', val);
    } else if (type === 'middleLine') {
      handleDraftChange('middleLineStyle', val);
    }
  };

  const handleVisibilityCheckboxChange = (key, checked) => {
    const vis = draftShape.visibility || DEFAULT_VISIBILITY;
    const updatedVisibility = {
      ...vis,
      [key]: {
        ...vis[key],
        visible: checked
      }
    };
    handleDraftChange('visibility', updatedVisibility);
  };

  const handleVisibilityRangeChange = (key, field, val) => {
    const vis = draftShape.visibility || DEFAULT_VISIBILITY;
    const numVal = val === '' ? '' : parseInt(val, 10);
    const updatedVisibility = {
      ...vis,
      [key]: {
        ...vis[key],
        [field]: isNaN(numVal) ? val : numVal
      }
    };
    handleDraftChange('visibility', updatedVisibility);
  };

  const renderPopover = (type) => {
    const isBorderOrMiddle = type === 'border' || type === 'middleLine' || type === 'line';

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
        handleColorSelect(type, hex);
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
        handleColorSelect(type, hex);
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
        handleColorSelect(type, val);
      }
    };

    const handlePlusClick = () => {
      setIsChooserOpen(true);
      const currentColor = getCurrentColor(type);
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
        handleColorSelect(type, hexInput);
        setIsChooserOpen(false);
      }
    };

    return (
      <div 
        style={{
          position: 'absolute',
          right: 0,
          top: '36px',
          backgroundColor: '#1c2030',
          border: '1px solid #2a2e39',
          borderRadius: '6px',
          padding: '12px',
          zIndex: 500,
          width: '216px',
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
            {/* Top Row: Preview, Hex Input, Add Button */}
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

            {/* Gradient SV Space and Hue Slider */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Saturation/Value Square */}
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
                {/* Selection indicator circle */}
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

              {/* Vertical Hue Slider */}
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
                {/* Hue indicator line */}
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

            {/* Back Button to return to grid */}
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
            {/* Color Palette Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 18px)', gap: '4px', margin: '4px 0' }}>
              {palette.flat().map(c => (
                <div 
                  key={c}
                  onClick={() => handleColorSelect(type, c)}
                  style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: c,
                    borderRadius: '2px',
                    cursor: 'pointer',
                    border: (getCurrentColor(type).toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : '1px solid transparent'
                  }}
                />
              ))}
            </div>

            {/* Custom / recent colors row */}
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
                    border: (getCurrentColor(type).toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : 'none'
                  }}
                  onClick={() => handleColorSelect(type, c)}
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

        {/* Opacity Slider */}
        <div style={{ marginTop: '10px', borderTop: '1px solid #2a2e39', paddingTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#787b86', fontSize: '11px', marginBottom: '4px' }}>
            <span>Opacity</span>
            <span>{Math.round(getCurrentOpacity(type) * 100)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={Math.round(getCurrentOpacity(type) * 100)}
              onChange={e => handleOpacityChange(type, parseInt(e.target.value) / 100)}
              style={{ flex: 1, accentColor: '#2962ff', height: '4px' }}
            />
            <div style={{
              backgroundColor: '#131722',
              border: '1px solid #2a2e39',
              color: '#d1d4dc',
              fontSize: '11px',
              padding: '2px 4px',
              borderRadius: '3px',
              width: '32px',
              textAlign: 'center'
            }}>
              {Math.round(getCurrentOpacity(type) * 100)}%
            </div>
          </div>
        </div>

        {/* Thickness Selector */}
        {isBorderOrMiddle && (
          <div style={{ marginTop: '10px', borderTop: '1px solid #2a2e39', paddingTop: '8px' }}>
            <div style={{ color: '#787b86', fontSize: '11px', marginBottom: '6px' }}>Thickness</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 3, 4].map(w => (
                <button
                  key={w}
                  onClick={() => handleThicknessChange(type, w)}
                  style={{
                    flex: 1,
                    height: '24px',
                    backgroundColor: getCurrentThickness(type) === w ? '#2962ff' : '#131722',
                    border: '1px solid #2a2e39',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <div style={{
                    width: '16px',
                    height: `${w}px`,
                    backgroundColor: getCurrentThickness(type) === w ? '#ffffff' : '#787b86'
                  }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Line Style Selector */}
        {isBorderOrMiddle && (
          <div style={{ marginTop: '10px', borderTop: '1px solid #2a2e39', paddingTop: '8px' }}>
            <div style={{ color: '#787b86', fontSize: '11px', marginBottom: '6px' }}>Line style</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['solid', 'dashed', 'dotted'].map(s => (
                <button
                  key={s}
                  onClick={() => handleLineStyleChange(type, s)}
                  style={{
                    flex: 1,
                    height: '24px',
                    backgroundColor: getCurrentLineStyle(type) === s ? '#2962ff' : '#131722',
                    border: '1px solid #2a2e39',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    color: getCurrentLineStyle(type) === s ? '#ffffff' : '#787b86',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {s === 'solid' && <div style={{ width: '20px', height: '1.5px', backgroundColor: getCurrentLineStyle(type) === s ? '#ffffff' : '#787b86' }} />}
                  {s === 'dashed' && <div style={{ width: '20px', height: '1.5px', borderTop: '1.5px dashed ' + (getCurrentLineStyle(type) === s ? '#ffffff' : '#787b86') }} />}
                  {s === 'dotted' && <div style={{ width: '20px', height: '1.5px', borderTop: '1.5px dotted ' + (getCurrentLineStyle(type) === s ? '#ffffff' : '#787b86') }} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRectangleStyleTab = () => {
    return (
      <div className="settings-section" onClick={() => { setActivePopover(null); setIsExtendDropdownOpen(false); }}>
        {/* Extend Row */}
        <div className="settings-row" onClick={e => e.stopPropagation()}>
          <span className="settings-label">Extend</span>
          <div style={{ position: 'relative', flex: 1 }}>
            <button 
              className="tv-select" 
              onClick={() => {
                setIsExtendDropdownOpen(!isExtendDropdownOpen);
                setActivePopover(null);
              }}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
                padding: '0 8px',
                height: '32px',
                cursor: 'pointer'
              }}
            >
              <span>{getExtendLabel()}</span>
              <span>{isExtendDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {isExtendDropdownOpen && (
              <div style={{
                position: 'absolute',
                top: '36px',
                left: 0,
                right: 0,
                backgroundColor: '#1c2030',
                border: '1px solid #2a2e39',
                borderRadius: '4px',
                padding: '8px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
              }}>
                <label className="checkbox-label" style={{ userSelect: 'none' }}>
                  <input 
                    type="checkbox" 
                    checked={draftShape.extendLeft || false}
                    onChange={e => handleDraftChange('extendLeft', e.target.checked)}
                  />
                  <span>Extend left</span>
                </label>
                <label className="checkbox-label" style={{ userSelect: 'none' }}>
                  <input 
                    type="checkbox" 
                    checked={draftShape.extendRight || false}
                    onChange={e => handleDraftChange('extendRight', e.target.checked)}
                  />
                  <span>Extend right</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Border Row */}
        <div className="settings-row" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
          <span className="settings-label">Border</span>
          <button
            onClick={() => {
              setActivePopover(activePopover === 'border' ? null : 'border');
              setIsExtendDropdownOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#131722',
              border: '1px solid #2a2e39',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              height: '32px',
              width: '80px',
              justifyContent: 'space-between'
            }}
          >
            <div style={{
              width: '18px',
              height: '18px',
              backgroundColor: getCurrentColor('border'),
              borderRadius: '2px',
              opacity: getCurrentOpacity('border'),
              backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0'
            }} />
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {getLineStyleIcon(getCurrentThickness('border'), getCurrentLineStyle('border'))}
            </span>
          </button>
          {activePopover === 'border' && renderPopover('border')}
        </div>

        {/* Middle Line Row */}
        <div className="settings-row" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
          <label className="checkbox-label" style={{ userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={draftShape.showMiddleLine || false}
              onChange={e => handleDraftChange('showMiddleLine', e.target.checked)}
            />
            <span>Middle line</span>
          </label>
          <button
            disabled={!draftShape.showMiddleLine}
            onClick={() => {
              setActivePopover(activePopover === 'middleLine' ? null : 'middleLine');
              setIsExtendDropdownOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#131722',
              border: '1px solid #2a2e39',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: draftShape.showMiddleLine ? 'pointer' : 'default',
              height: '32px',
              width: '80px',
              justifyContent: 'space-between',
              opacity: draftShape.showMiddleLine ? 1.0 : 0.4
            }}
          >
            <div style={{
              width: '18px',
              height: '18px',
              backgroundColor: getCurrentColor('middleLine'),
              borderRadius: '2px',
              opacity: getCurrentOpacity('middleLine')
            }} />
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {getLineStyleIcon(getCurrentThickness('middleLine'), getCurrentLineStyle('middleLine'))}
            </span>
          </button>
          {activePopover === 'middleLine' && renderPopover('middleLine')}
        </div>

        {/* Background Row */}
        <div className="settings-row" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
          <label className="checkbox-label" style={{ userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={draftShape.showBackground !== false}
              onChange={e => handleDraftChange('showBackground', e.target.checked)}
            />
            <span>Background</span>
          </label>
          <button
            disabled={draftShape.showBackground === false}
            onClick={() => {
              setActivePopover(activePopover === 'background' ? null : 'background');
              setIsExtendDropdownOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#131722',
              border: '1px solid #2a2e39',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: draftShape.showBackground !== false ? 'pointer' : 'default',
              height: '32px',
              width: '80px',
              justifyContent: 'center',
              opacity: draftShape.showBackground !== false ? 1.0 : 0.4
            }}
          >
            <div style={{
              width: '24px',
              height: '18px',
              backgroundColor: getCurrentColor('background'),
              borderRadius: '2px',
              opacity: getCurrentOpacity('background'),
              backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0'
            }} />
          </button>
          {activePopover === 'background' && renderPopover('background')}
        </div>

        {/* Trade Position Settings */}
        <div style={{ borderTop: '1px solid #2a2e39', marginTop: '10px', paddingTop: '10px' }}>
          <label className="checkbox-label" style={{ userSelect: 'none', fontWeight: 600, color: '#2962ff' }}>
            <input 
              type="checkbox" 
              checked={draftShape.showAsTrade || false}
              onChange={e => handleDraftChange('showAsTrade', e.target.checked)}
            />
            <span>Show as Trade Position</span>
          </label>
          
          {draftShape.showAsTrade && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingLeft: '20px' }}>
              <div className="settings-row">
                <span className="settings-label">Direction</span>
                <select
                  value={draftShape.tradeDirection || 'long'}
                  onChange={e => handleDraftChange('tradeDirection', e.target.value)}
                  className="tv-select"
                  style={{ flex: 1, backgroundColor: '#131722', border: '1px solid #2a2e39', color: '#fff', height: '28px', borderRadius: '4px', padding: '0 8px' }}
                >
                  <option value="long">Long (Buy)</option>
                  <option value="short">Short (Sell)</option>
                </select>
              </div>
              <div className="settings-row" style={{ fontSize: '11px', color: '#787b86' }}>
                <span className="settings-label">Stats Preview</span>
                <span style={{ fontSize: '11px', color: '#d1d4dc', fontWeight: 600 }}>
                  {(() => {
                    const p1 = draftShape.points[0]?.price || 0;
                    const p2 = draftShape.points[1]?.price || 0;
                    const high = Math.max(p1, p2);
                    const low = Math.min(p1, p2);
                    const mid = (high + low) / 2;
                    const isLong = draftShape.tradeDirection !== 'short';
                    const target = isLong ? (high - mid) : (mid - low);
                    const risk = isLong ? (mid - low) : (high - mid);
                    const rr = risk > 0 ? (target / risk).toFixed(2) : '0.00';
                    return `Risk: ${risk.toFixed(2)} pts | Target: ${target.toFixed(2)} pts (R:R: ${rr})`;
                  })()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="modal-overlay" onClick={handleOk}>
      <div 
        className="settings-modal-tv" 
        onClick={e => e.stopPropagation()}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      >
        <div 
          className="settings-header" 
          onMouseDown={handleHeaderMouseDown} 
          style={{ cursor: 'move', userSelect: 'none' }}
        >
          <span>{draftShape.type ? draftShape.type.charAt(0).toUpperCase() + draftShape.type.slice(1).replace('-', ' ') : 'Drawing'} <PencilIcon /></span>
          <button className="tv-icon-btn" onClick={handleCancel}><X size={16} /></button>
        </div>

        <div className="settings-tabs">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`settings-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="settings-content">
          {activeTab === 'Style' && (
            draftShape.type === 'rectangle' ? renderRectangleStyleTab() : (
              <div className="settings-section" onClick={() => { setActivePopover(null); setIsExtendDropdownOpen(false); }}>
                <div className="settings-row" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
                  <span className="settings-label">Line</span>
                  <button
                    onClick={() => {
                      setActivePopover(activePopover === 'line' ? null : 'line');
                      setIsExtendDropdownOpen(false);
                      setIsChooserOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: '#131722',
                      border: '1px solid #2a2e39',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      height: '32px',
                      width: '80px',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div style={{
                      width: '18px',
                      height: '18px',
                      backgroundColor: getCurrentColor('line'),
                      borderRadius: '2px',
                      opacity: getCurrentOpacity('line'),
                      backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0'
                    }} />
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {getLineStyleIcon(getCurrentThickness('line'), getCurrentLineStyle('line'))}
                    </span>
                  </button>
                  {activePopover === 'line' && renderPopover('line')}
                </div>

                <div className="settings-row">
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={draftShape.showPriceLabel !== false}
                      onChange={e => handleDraftChange('showPriceLabel', e.target.checked)}
                    />
                    <span>Price label</span>
                  </label>
                </div>

                {draftShape.type === 'trendline' && (
                  <>
                    <div className="settings-row">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={draftShape.extendLeft || false}
                          onChange={e => handleDraftChange('extendLeft', e.target.checked)}
                        />
                        <span>Extend left</span>
                      </label>
                    </div>
                    <div className="settings-row">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={draftShape.extendRight || false}
                          onChange={e => handleDraftChange('extendRight', e.target.checked)}
                        />
                        <span>Extend right</span>
                      </label>
                    </div>
                    <div className="settings-row">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={draftShape.showAngle || false}
                          onChange={e => handleDraftChange('showAngle', e.target.checked)}
                        />
                        <span>Show angle</span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            )
          )}

          {activeTab === 'Text' && (
            <div className="settings-section">
              <div className="settings-row" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    setActivePopover(activePopover === 'text' ? null : 'text');
                    setIsExtendDropdownOpen(false);
                    setIsChooserOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: '#131722',
                    border: '1px solid #2a2e39',
                    borderRadius: '4px',
                    padding: '4px',
                    cursor: 'pointer',
                    height: '32px',
                    width: '36px',
                    justifyContent: 'center'
                  }}
                >
                  <div style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: getCurrentColor('text'),
                    borderRadius: '2px',
                    opacity: getCurrentOpacity('text')
                  }} />
                </button>
                {activePopover === 'text' && renderPopover('text')}
                <select 
                  className="tv-select"
                  value={draftShape.fontSize || 16}
                  onChange={e => handleDraftChange('fontSize', parseInt(e.target.value))}
                >
                  <option value={12}>12</option>
                  <option value={14}>14</option>
                  <option value={16}>16</option>
                  <option value={20}>20</option>
                </select>
                <button 
                  className={`tv-toggle-btn ${draftShape.bold ? 'active' : ''}`}
                  onClick={() => handleDraftChange('bold', !draftShape.bold)}
                >B</button>
                <button 
                  className={`tv-toggle-btn ${draftShape.italic ? 'active' : ''}`}
                  style={{fontStyle: 'italic'}}
                  onClick={() => handleDraftChange('italic', !draftShape.italic)}
                >I</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                <span className="settings-label" style={{ fontSize: '11px', color: '#787b86' }}>Quick Stamps</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {['BOS', 'MSS', 'FVG', 'OB', 'SSL', 'BSL', 'EQH', 'EQL', 'Premium', 'Discount'].map(stamp => (
                    <button
                      key={stamp}
                      type="button"
                      onClick={() => handleDraftChange('text', stamp)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '10px',
                        background: '#131722',
                        border: '1px solid #2a2e39',
                        borderRadius: '3px',
                        color: draftShape.text === stamp ? '#2962ff' : '#d1d4dc',
                        borderColor: draftShape.text === stamp ? '#2962ff' : '#2a2e39',
                        fontWeight: draftShape.text === stamp ? 'bold' : 'normal',
                        cursor: 'pointer',
                        transition: 'all 0.1s'
                      }}
                      title={`Stamp '${stamp}'`}
                    >
                      {stamp}
                    </button>
                  ))}
                </div>
              </div>
              <textarea 
                className="tv-textarea" 
                placeholder="Add text"
                value={draftShape.text || ''}
                onChange={e => handleDraftChange('text', e.target.value)}
              />
              <div className="settings-row">
                <span className="settings-label">Text alignment</span>
                <select 
                  className="tv-select"
                  value={draftShape.textValign || 'middle'}
                  onChange={e => handleDraftChange('textValign', e.target.value)}
                >
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </select>
                <select 
                  className="tv-select"
                  value={draftShape.textHalign || 'right'}
                  onChange={e => handleDraftChange('textHalign', e.target.value)}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'Coordinates' && (
            <div className="settings-section">
              {draftShape.points && draftShape.points.map((pt, idx) => (
                <div className="settings-row" key={idx}>
                  <span className="settings-label">#{idx + 1} (price, bar)</span>
                  <input 
                    type="number" 
                    className="tv-input" 
                    value={pt.price || 0}
                    onChange={(e) => {
                      const newPts = [...draftShape.points];
                      newPts[idx].price = parseFloat(e.target.value);
                      handleDraftChange('points', newPts);
                    }}
                  />
                  <input 
                    type="number" 
                    className="tv-input"
                    value={pt.time || 0}
                    readOnly
                  />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'Visibility' && (() => {
            const vis = draftShape.visibility || DEFAULT_VISIBILITY;
            return (
              <div className="settings-section">
                {['Ticks', 'Seconds', 'Minutes', 'Hours', 'Days', 'Weeks', 'Months', 'Ranges'].map(v => {
                  const item = vis[v] || { visible: false };
                  const hasRange = ['Seconds', 'Minutes', 'Hours', 'Days'].includes(v);
                  return (
                    <div className="settings-row visibility-row" key={v}>
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={!!item.visible} 
                          onChange={(e) => handleVisibilityCheckboxChange(v, e.target.checked)}
                        />
                        <span>{v}</span>
                      </label>
                      {hasRange && (
                        <div className="visibility-range" style={{ opacity: item.visible ? 1 : 0.5, pointerEvents: item.visible ? 'auto' : 'none' }}>
                          <input 
                            type="number" 
                            className="tv-input small" 
                            value={item.min !== undefined ? item.min : 1} 
                            onChange={(e) => handleVisibilityRangeChange(v, 'min', e.target.value)}
                          />
                          <span className="dash">—</span>
                          <input 
                            type="number" 
                            className="tv-input small" 
                            value={item.max !== undefined ? item.max : (v === 'Days' ? 1 : (v === 'Hours' ? 24 : 59))} 
                            onChange={(e) => handleVisibilityRangeChange(v, 'max', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <div className="settings-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #2a2e39', padding: '12px 16px', background: '#1c2030' }}>
          {/* Custom Template Dropdown */}
          <div ref={templateMenuRef} style={{ position: 'relative' }}>
            <button 
              className="tv-btn secondary template-trigger-btn"
              onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #2a2e39',
                color: '#d1d4dc',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontFamily: 'Outfit, sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              Template <span style={{ fontSize: '9px', opacity: 0.7 }}>▼</span>
            </button>

            {isTemplateMenuOpen && (
              <div 
                className="tv-dropdown-menu"
                style={{
                  position: 'absolute',
                  bottom: '36px',
                  left: '0',
                  backgroundColor: '#1c2030',
                  border: '1px solid #2a2e39',
                  borderRadius: '6px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  minWidth: '180px',
                  zIndex: 2000,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '6px 0',
                  boxSizing: 'border-box'
                }}
              >
                <button
                  onClick={() => {
                    const name = prompt("Enter a name for this template:");
                    if (name && name.trim()) {
                      const styleKeys = [
                        'color', 'width', 'opacity', 'lineStyle', 
                        'textColor', 'textOpacity', 'fontSize', 'bold', 'italic', 'textHalign', 'textValign',
                        'backgroundColor', 'backgroundOpacity', 'fillOpacity',
                        'borderColor', 'borderWidth', 'borderOpacity', 'borderStyle',
                        'extendLeft', 'extendRight', 'showAngle', 'showPriceLabel',
                        'showMiddleLine', 'middleLineColor', 'middleLineWidth', 'middleLineStyle',
                        'showAsTrade', 'tradeDirection', 'text', 'visibility'
                      ];
                      const savedStyle = {};
                      styleKeys.forEach(k => {
                        if (draftShape[k] !== undefined) {
                          savedStyle[k] = draftShape[k];
                        }
                      });
                      const updated = {
                        ...templates,
                        [draftShape.type]: {
                          ...(templates[draftShape.type] || {}),
                          [name.trim()]: savedStyle
                        }
                      };
                      saveTemplates(updated);
                    }
                    setIsTemplateMenuOpen(false);
                  }}
                  style={dropdownItemStyle}
                >
                  Save As...
                </button>

                <button
                  onClick={() => {
                    const factoryDefaults = {
                      rectangle: { color: '#2962ff', width: 2, opacity: 0.15, lineStyle: 'solid', showBackground: true, backgroundColor: '#2962ff', backgroundOpacity: 0.15, borderColor: '#2962ff', borderOpacity: 1.0, borderWidth: 2, borderStyle: 'solid', showMiddleLine: false, middleLineColor: '#000000', middleLineOpacity: 1.0, middleLineWidth: 1, middleLineStyle: 'solid', extendLeft: false, extendRight: false, textValign: 'middle', textHalign: 'right', showAsTrade: false, text: '' },
                      trendline: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid', extendLeft: false, extendRight: false, showAngle: false, showPriceLabel: true, textHalign: 'center', textValign: 'top', text: '' },
                      'horizontal-line': { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid', text: '' },
                      ray: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid', text: '' },
                      fibonacci: { color: '#787b86', width: 1, opacity: 1.0, lineStyle: 'solid', text: '' },
                      brush: { color: '#2962ff', width: 2, opacity: 1.0, lineStyle: 'solid', text: '' },
                      text: { color: '#ffffff', fontSize: 12, opacity: 1.0, text: '' }
                    };
                    const shapeDefault = factoryDefaults[draftShape.type] || {};
                    handleDraftChange(shapeDefault);
                    setIsTemplateMenuOpen(false);
                  }}
                  style={dropdownItemStyle}
                >
                  Apply Defaults
                </button>

                <button
                  onClick={() => {
                    const savedDefaults = JSON.parse(localStorage.getItem('tv_default_tool_styles') || '{}');
                    const styleKeys = [
                      'color', 'width', 'opacity', 'lineStyle', 
                      'textColor', 'textOpacity', 'fontSize', 'bold', 'italic', 'textHalign', 'textValign',
                      'backgroundColor', 'backgroundOpacity', 'fillOpacity',
                      'borderColor', 'borderWidth', 'borderOpacity', 'borderStyle',
                      'extendLeft', 'extendRight', 'showAngle', 'showPriceLabel',
                      'showMiddleLine', 'middleLineColor', 'middleLineWidth', 'middleLineStyle',
                      'showAsTrade', 'tradeDirection', 'visibility'
                    ];
                    const currentStyle = {};
                    styleKeys.forEach(k => {
                      if (draftShape[k] !== undefined) {
                        currentStyle[k] = draftShape[k];
                      }
                    });
                    savedDefaults[draftShape.type] = {
                      ...(savedDefaults[draftShape.type] || {}),
                      ...currentStyle
                    };
                    localStorage.setItem('tv_default_tool_styles', JSON.stringify(savedDefaults));
                    window.dispatchEvent(new Event('tv_default_styles_changed'));
                    alert("Saved current settings as default style for new drawings!");
                    setIsTemplateMenuOpen(false);
                  }}
                  style={dropdownItemStyle}
                >
                  Save as Default
                </button>

                {Object.keys(templates[draftShape.type] || {}).length > 0 && (
                  <>
                    <div style={{ height: '1px', backgroundColor: '#2a2e39', margin: '4px 0' }} />
                    <div style={{ fontSize: '10px', color: '#787b86', padding: '4px 12px 2px' }}>Apply Template:</div>
                    {Object.entries(templates[draftShape.type] || {}).map(([name, style]) => (
                      <div 
                        key={name} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between',
                          padding: '2px 12px'
                        }}
                      >
                        <button
                          onClick={() => {
                            handleDraftChange(style);
                            setIsTemplateMenuOpen(false);
                          }}
                          style={{
                            flex: 1,
                            background: 'none',
                            border: 'none',
                            color: '#d1d4dc',
                            textAlign: 'left',
                            padding: '4px 0',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontFamily: 'Outfit, sans-serif'
                          }}
                          className="template-item-btn"
                        >
                          {name}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const copy = { ...templates };
                            delete copy[draftShape.type][name];
                            saveTemplates(copy);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#787b86',
                            cursor: 'pointer',
                            fontSize: '11px',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'color 0.1s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ef5350'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#787b86'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="footer-actions" style={{ display: 'flex', alignItems: 'center' }}>
            {draftShape.showAsTrade && onPlaceTrade && (
              <button 
                className="tv-btn primary" 
                style={{ backgroundColor: '#2962ff', color: '#ffffff', marginRight: '6px' }}
                onClick={() => {
                  const p1 = draftShape.points[0]?.price || 0;
                  const p2 = draftShape.points[1]?.price || 0;
                  const high = Math.max(p1, p2);
                  const low = Math.min(p1, p2);
                  const mid = (high + low) / 2;
                  const direction = draftShape.tradeDirection || 'long';
                  
                  const entryPrice = mid;
                  const stopLoss = direction === 'long' ? low : high;
                  const takeProfit = direction === 'long' ? (mid + (mid - low) * 2) : (mid - (high - mid) * 2);
                  
                  onPlaceTrade(
                    direction,
                    1, // default quantity
                    entryPrice,
                    stopLoss,
                    takeProfit,
                    `Trade from rectangle drawing: ${draftShape.text || 'Zone'}`,
                    [draftShape.id]
                  );
                  handleOk();
                }}
              >
                Simulate Trade
              </button>
            )}
            <button className="tv-btn cancel" onClick={handleCancel}>Cancel</button>
            <button className="tv-btn primary" onClick={handleOk}>Ok</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PencilIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft: '6px', opacity: 0.5}}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
  </svg>
);

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
