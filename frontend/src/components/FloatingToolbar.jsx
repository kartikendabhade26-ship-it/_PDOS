import React, { useState, useRef, useEffect } from 'react';
import { 
  GripVertical, 
  Pencil, 
  Baseline, 
  Minus, 
  Settings, 
  AlarmClockPlus, 
  Lock, 
  Unlock, 
  Trash2, 
  MoreHorizontal,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  Ruler,
  PaintBucket
} from 'lucide-react';

const PALETTE = [
  ['#ffffff', '#e0e3eb', '#d1d4dc', '#b2b5be', '#868993', '#60626a', '#434651', '#2a2e39', '#131722', '#000000'],
  ['#ff0000', '#ff9800', '#ffeb3b', '#4caf50', '#00bcd4', '#2196f3', '#3f51b5', '#9c27b0', '#e91e63', '#ea4c89'],
  ['#ffebee', '#fff3e0', '#fffde7', '#e8f5e9', '#e0f7fa', '#e3f2fd', '#e8eaf6', '#f3e5f5', '#fce4ec', '#fbe9e7'],
  ['#ffcdd2', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2ebf2', '#bbdefb', '#c5cae9', '#d1c4e9', '#f8bbd0', '#ffccbc'],
  ['#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80deea', '#90caf9', '#9fa8da', '#b39ddb', '#f48fb1', '#ffab91'],
  ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8', '#f06292', '#ff8a65'],
  ['#c62828', '#ef6c00', '#fbc02d', '#2e7d32', '#00838f', '#1565c0', '#283593', '#6a1b9a', '#ad1457', '#d84315']
];

export default function FloatingToolbar({
  position,
  setPosition,
  selectedDrawingIdx,
  drawings,
  setDrawings,
  setSelectedDrawing,
  setIsToolbarPinned,
  onAddUndoState,
  onOpenSettings
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [activePopup, setActivePopup] = useState(null); // 'color' | 'text-color' | 'thickness' | 'style'
  const dragStartRef = useRef({ x: 0, y: 0 });
  const toolbarRef = useRef(null);

  // Custom Color Chooser States
  const [recentColors, setRecentColors] = useState(['#e0e3eb', '#4caf50', '#000000', '#868993', '#2a2e39']);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [val, setVal] = useState(1);
  const [hexInput, setHexInput] = useState('#ff0000');

  useEffect(() => {
    setIsChooserOpen(false);
  }, [activePopup]);

  if (selectedDrawingIdx === null || !drawings[selectedDrawingIdx]) return null;
  const shape = drawings[selectedDrawingIdx];

  // Draggable window logic
  const handleDragStart = (e) => {
    e.preventDefault();
    setIsDragging(true);
    if (setIsToolbarPinned) setIsToolbarPinned(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setPosition]);

  // Click outside to dismiss popup
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setActivePopup(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const updateShapeStyle = (key, val) => {
    onAddUndoState();
    const copy = [...drawings];
    const shape = copy[selectedDrawingIdx];
    
    if (shape.type === 'rectangle') {
      if (key === 'color') {
        copy[selectedDrawingIdx] = {
          ...shape,
          color: val,
          borderColor: val
        };
      } else if (key === 'opacity') {
        copy[selectedDrawingIdx] = {
          ...shape,
          opacity: val,
          borderOpacity: val
        };
      } else if (key === 'backgroundOpacity') {
        copy[selectedDrawingIdx] = {
          ...shape,
          backgroundOpacity: val,
          fillOpacity: val
        };
      } else if (key === 'width') {
        copy[selectedDrawingIdx] = {
          ...shape,
          width: val,
          borderWidth: val
        };
      } else if (key === 'lineStyle') {
        copy[selectedDrawingIdx] = {
          ...shape,
          lineStyle: val,
          borderStyle: val
        };
      } else {
        copy[selectedDrawingIdx] = {
          ...shape,
          [key]: val
        };
      }
    } else {
      copy[selectedDrawingIdx] = {
        ...shape,
        [key]: val
      };
    }
    setDrawings(copy);
  };

  const handleDelete = () => {
    onAddUndoState();
    const copy = [...drawings];
    copy.splice(selectedDrawingIdx, 1);
    setDrawings(copy);
    setSelectedDrawing(null);
  };

  const toggleLock = () => {
    updateShapeStyle('locked', !shape.locked);
  };

  const renderColorPopover = (type, leftPos) => {
    const getActiveColor = () => {
      if (type === 'border') {
        return shape.borderColor || shape.color || '#2962ff';
      }
      if (type === 'background') {
        return shape.backgroundColor || '#2962ff';
      }
      if (type === 'text') {
        return shape.textColor || '#ffffff';
      }
      return '#2962ff';
    };

    const getActiveOpacity = () => {
      if (type === 'border') {
        return shape.borderOpacity !== undefined ? shape.borderOpacity : (shape.opacity !== undefined ? shape.opacity : 1.0);
      }
      if (type === 'background') {
        return shape.backgroundOpacity !== undefined ? shape.backgroundOpacity : (shape.fillOpacity !== undefined ? shape.fillOpacity : 0.15);
      }
      if (type === 'text') {
        return shape.textOpacity !== undefined ? shape.textOpacity : 1.0;
      }
      return 1.0;
    };

    const handleSelect = (val) => {
      if (type === 'border') {
        updateShapeStyle('color', val);
      } else if (type === 'background') {
        updateShapeStyle('backgroundColor', val);
      } else if (type === 'text') {
        updateShapeStyle('textColor', val);
      }
    };

    const handleOpacity = (val) => {
      if (type === 'border') {
        updateShapeStyle('opacity', val);
      } else if (type === 'background') {
        updateShapeStyle('backgroundOpacity', val);
      } else if (type === 'text') {
        updateShapeStyle('textOpacity', val);
      }
    };

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
        handleSelect(hex);
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
        handleSelect(hex);
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
        handleSelect(val);
      }
    };

    const handlePlusClick = () => {
      setIsChooserOpen(true);
      const currentColor = getActiveColor();
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
        handleSelect(hexInput);
        setIsChooserOpen(false);
      }
    };

    return (
      <div 
        className="tv-popup tv-color-popup"
        style={{
          position: 'absolute',
          left: `${leftPos}px`,
          top: '40px',
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
              {PALETTE.flat().map(c => (
                <div 
                  key={c}
                  onClick={() => handleSelect(c)}
                  style={{
                    width: '18px',
                    height: '18px',
                    backgroundColor: c,
                    borderRadius: '2px',
                    cursor: 'pointer',
                    border: (getActiveColor().toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : '1px solid transparent'
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
                    border: (getActiveColor().toLowerCase() === c.toLowerCase()) ? '1px solid #ffffff' : 'none'
                  }}
                  onClick={() => handleSelect(c)}
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
            <span>{Math.round(getActiveOpacity() * 100)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={Math.round(getActiveOpacity() * 100)}
              onChange={e => handleOpacity(parseInt(e.target.value) / 100)}
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
              {Math.round(getActiveOpacity() * 100)}%
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar-tv"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
    >
      <div className="drag-handle" onMouseDown={handleDragStart}>
        <GripVertical size={16} />
      </div>

      <button 
        className={`tv-icon-btn ${activePopup === 'color' ? 'active' : ''}`} 
        onClick={() => setActivePopup(activePopup === 'color' ? null : 'color')}
        title={shape.type === 'rectangle' ? "Border Color" : "Line Color"} 
        style={{ borderBottom: `2px solid ${shape.borderColor || shape.color || '#2962ff'}` }}
      >
        <Pencil size={15} />
      </button>

      {shape.type === 'rectangle' && (
        <button 
          className={`tv-icon-btn ${activePopup === 'fill-color' ? 'active' : ''}`}
          onClick={() => setActivePopup(activePopup === 'fill-color' ? null : 'fill-color')}
          title="Fill Color"
          style={{ borderBottom: `2px solid ${shape.backgroundColor || '#2962ff'}` }}
        >
          <PaintBucket size={15} />
        </button>
      )}

      {(shape.type === 'text' || shape.type === 'rectangle' || shape.type === 'trendline') && (
        <button 
          className={`tv-icon-btn ${activePopup === 'text-color' ? 'active' : ''}`} 
          onClick={() => setActivePopup(activePopup === 'text-color' ? null : 'text-color')}
          title="Text Color" 
          style={{ borderBottom: `2px solid ${shape.textColor || '#ffffff'}` }}
        >
          <Baseline size={16} />
        </button>
      )}

      {shape.type !== 'text' && (
        <>
          <button 
            className={`tv-icon-btn text-icon ${activePopup === 'thickness' ? 'active' : ''}`} 
            onClick={() => setActivePopup(activePopup === 'thickness' ? null : 'thickness')}
            title="Line Thickness"
          >
            <Minus strokeWidth={shape.width || 2} size={16} />
            <span style={{ fontSize: '11px', marginLeft: '4px' }}>{shape.width || 2}px</span>
          </button>

          <button 
            className={`tv-icon-btn ${activePopup === 'style' ? 'active' : ''}`} 
            onClick={() => setActivePopup(activePopup === 'style' ? null : 'style')}
            title="Line Style"
          >
            <Minus strokeWidth={1} style={{ strokeDasharray: shape.lineStyle === 'dashed' ? '4 4' : shape.lineStyle === 'dotted' ? '2 2' : 'none' }} size={16} />
          </button>
        </>
      )}

      {/* Trendline-specific: Extend Left / Right / Angle */}
      {shape.type === 'trendline' && (
        <>
          <div className="divider-vert" />
          <button
            className={`tv-icon-btn ${shape.extendLeft ? 'active' : ''}`}
            onClick={() => updateShapeStyle('extendLeft', !shape.extendLeft)}
            title="Extend Left"
          >
            <ChevronsLeft size={15} />
          </button>
          <button
            className={`tv-icon-btn ${shape.extendRight ? 'active' : ''}`}
            onClick={() => updateShapeStyle('extendRight', !shape.extendRight)}
            title="Extend Right"
          >
            <ChevronsRight size={15} />
          </button>
          <button
            className={`tv-icon-btn ${shape.showAngle ? 'active' : ''}`}
            onClick={() => updateShapeStyle('showAngle', !shape.showAngle)}
            title="Show Angle"
          >
            <Ruler size={14} />
          </button>
          <button
            className={`tv-icon-btn ${shape.showPriceLabel === false ? '' : 'active'}`}
            onClick={() => updateShapeStyle('showPriceLabel', shape.showPriceLabel === false ? true : false)}
            title="Toggle Price Labels"
            style={{ fontSize: '10px', fontWeight: 700, minWidth: '22px' }}
          >
            P
          </button>
        </>
      )}

      <div className="divider-vert" />

      <button className="tv-icon-btn" onClick={() => onOpenSettings && onOpenSettings()} title="Settings">
        <Settings size={15} />
      </button>

      <button className="tv-icon-btn" title="Add Alert">
        <AlarmClockPlus size={15} />
      </button>

      <button className="tv-icon-btn" onClick={toggleLock} title={shape.locked ? "Unlock" : "Lock"}>
        {shape.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>

      {shape.type === 'rectangle' && (
        <button 
          className={`tv-icon-btn ${activePopup === 'teach-ai' ? 'active' : ''}`}
          onClick={() => setActivePopup(activePopup === 'teach-ai' ? null : 'teach-ai')}
          title="Teach AI this zone"
        >
          <Brain size={15} style={{ color: '#2962ff' }} />
        </button>
      )}

      <button className="tv-icon-btn" onClick={handleDelete} title="Remove">
        <Trash2 size={15} />
      </button>

      <button className="tv-icon-btn" title="More">
        <MoreHorizontal size={15} />
      </button>

      {/* POPUPS CONTAINER */}
      {activePopup === 'color' && renderColorPopover('border', 16)}

      {activePopup === 'fill-color' && renderColorPopover('background', 48)}

      {activePopup === 'text-color' && renderColorPopover('text', shape.type === 'rectangle' ? 80 : 48)}

      {activePopup === 'thickness' && (
        <div className="tv-popup tv-list-popup" style={{ top: '40px', left: '50px' }}>
          {[1, 2, 3, 4].map((w) => (
            <div
              key={w}
              className={`tv-list-item ${shape.width === w ? 'selected' : ''}`}
              onClick={() => {
                updateShapeStyle('width', w);
                setActivePopup(null);
              }}
            >
              <Minus strokeWidth={w} size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              {w}px
            </div>
          ))}
        </div>
      )}

      {activePopup === 'style' && (
        <div className="tv-popup tv-list-popup" style={{ top: '40px', left: '100px' }}>
          {[
            { id: 'solid', name: 'Solid', dash: 'none' },
            { id: 'dashed', name: 'Dashed', dash: '4 4' },
            { id: 'dotted', name: 'Dotted', dash: '2 2' }
          ].map((s) => (
            <div
              key={s.id}
              className={`tv-list-item ${shape.lineStyle === s.id ? 'selected' : ''}`}
              onClick={() => {
                updateShapeStyle('lineStyle', s.id);
                setActivePopup(null);
              }}
            >
              <Minus strokeWidth={1} style={{ strokeDasharray: s.dash, marginRight: '8px', verticalAlign: 'middle' }} size={16} />
              {s.name}
            </div>
          ))}
        </div>
      )}

      {activePopup === 'teach-ai' && (
        <TeachAIPopup 
          shape={shape}
          onSave={async (concept, valid, note, analysisLog) => {
            const label = {
              time: shape.points[0].time,
              priceHigh: Math.max(shape.points[0].price, shape.points[1].price),
              priceLow: Math.min(shape.points[0].price, shape.points[1].price),
              valid: valid,
              type: concept.split('_')[0],
              direction: concept.split('_')[1],
              note: note,
              ...analysisLog
            };
            
            try {
              const res = await fetch(`/api/algo/labels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ concept, labels: [label] })
              });
              
              if (!res.ok) throw new Error(await res.text());
              
              // Determine setup colors based on bullish/bearish direction
              const isBullishSetup = concept === 'fvg_bullish' || concept === 'ifvg_bullish' || concept === 'ob_bullish' || concept === 'liquidity_ssl';
              const shapeColor = isBullishSetup ? '#089981' : '#f23645';
              
              let conceptLabel = concept;
              if (concept === 'fvg_bullish') conceptLabel = 'BISI';
              else if (concept === 'fvg_bearish') conceptLabel = 'SIBI';
              else if (concept === 'ifvg_bullish') conceptLabel = 'IFVG Bullish';
              else if (concept === 'ifvg_bearish') conceptLabel = 'IFVG Bearish';
              else if (concept === 'ob_bullish') conceptLabel = 'Bullish OB';
              else if (concept === 'ob_bearish') conceptLabel = 'Bearish OB';
              else if (concept === 'liquidity_bsl') conceptLabel = 'BSL';
              else if (concept === 'liquidity_ssl') conceptLabel = 'SSL';

              const suffix = note ? ` - ${note}` : '';

              // Visual feedback
              updateShapeStyle('color', shapeColor);
              updateShapeStyle('opacity', 0.25);
              updateShapeStyle('locked', true);
              updateShapeStyle('text', `${conceptLabel} ${valid ? '✅' : '❌'}${suffix}`);
              
              alert(`✅ Zone successfully saved as ${valid ? 'Valid' : 'Invalid'} for ${conceptLabel}!`);
            } catch (err) {
              console.error(err);
              alert('Error saving labeled zone: ' + err.message);
            }
            setActivePopup(null);
          }}
        />
      )}
    </div>
  );
}

function TeachAIPopup({ shape, onSave }) {
  const [concept, setConcept] = useState('fvg_bullish');
  const [note, setNote] = useState(() => localStorage.getItem('tv_algo_followup_note') || '');
  
  // Dragging states
  const [pos, setPos] = useState({ x: 100, y: 40 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (
      e.target.tagName === 'INPUT' || 
      e.target.tagName === 'SELECT' || 
      e.target.tagName === 'TEXTAREA' || 
      e.target.closest('button')
    ) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPos({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // New checklist and narrative states
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [displacement, setDisplacement] = useState('medium'); // 'high' | 'medium' | 'low'
  const [liquiditySwept, setLiquiditySwept] = useState(false);
  const [mss, setMss] = useState(false);
  const [sessionAligned, setSessionAligned] = useState(false);
  const [discountPremium, setDiscountPremium] = useState('equilibrium'); // 'discount' | 'premium' | 'equilibrium'
  const [htfConfluence, setHtfConfluence] = useState(false);
  const [analysisNarrative, setAnalysisNarrative] = useState('');

  // Auto-fill session alignment based on shape's timestamp
  useEffect(() => {
    if (shape && shape.points && shape.points[0]) {
      const time = shape.points[0].time;
      const date = new Date((time - 5 * 3600) * 1000);
      const hour = date.getUTCHours();
      const isAligned = (hour >= 2 && hour < 5) || (hour >= 7 && hour < 12) || (hour >= 13 && hour < 16);
      setSessionAligned(isAligned);
      
      // Reset other states for new drawing
      setDisplacement('medium');
      setLiquiditySwept(false);
      setMss(false);
      setHtfConfluence(false);
      setAnalysisNarrative('');
      setDiscountPremium('equilibrium');
    }
  }, [shape]);

  const presets = [
    { id: 'fvg_bullish', label: 'BISI (Bullish FVG)' },
    { id: 'fvg_bearish', label: 'SIBI (Bearish FVG)' },
    { id: 'ifvg_bullish', label: 'IFVG Bullish (Support)' },
    { id: 'ifvg_bearish', label: 'IFVG Bearish (Resistance)' },
    { id: 'ob_bullish', label: 'Order Block Bullish' },
    { id: 'ob_bearish', label: 'Order Block Bearish' },
    { id: 'liquidity_bsl', label: 'Buy Side Liquidity (BSL)' },
    { id: 'liquidity_ssl', label: 'Sell Side Liquidity (SSL)' }
  ];

  const handleNoteChange = (val) => {
    setNote(val);
    localStorage.setItem('tv_algo_followup_note', val);
  };

  const handleSave = (valid) => {
    onSave(concept, valid, note, {
      displacement,
      liquiditySwept,
      mss,
      sessionAligned,
      discountPremium,
      htfConfluence,
      analysisNarrative
    });
  };

  return (
    <div 
      className="tv-popup" 
      style={{ 
        top: `${pos.y}px`, 
        left: `${pos.x}px`, 
        padding: '12px', 
        width: isLogOpen ? '260px' : '220px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px', 
        zIndex: 1000, 
        background: '#1c2030', 
        border: '1px solid #2a2e39',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        transition: 'width 0.2s ease-in-out'
      }}
    >
      <div 
        style={{ 
          fontWeight: 600, 
          fontSize: '12px', 
          color: '#ffffff', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px', 
          cursor: 'move',
          paddingBottom: '4px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          userSelect: 'none'
        }}
        onMouseDown={handleMouseDown}
      >
        <GripVertical size={12} style={{ color: '#787b86', cursor: 'move' }} />
        <span style={{ flex: 1 }}>Teach AI Zone</span>
        <span style={{ fontSize: '10px', background: 'rgba(41,98,255,0.2)', color: '#2962ff', padding: '2px 6px', borderRadius: '4px' }}>CoT Logic</span>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: '#787b86' }}>Choose Concept:</span>
        <select 
          value={concept} 
          onChange={e => setConcept(e.target.value)}
          className="symbol-selector"
          style={{ width: '100%', padding: '4px', fontSize: '11px', height: '26px', background: '#131722', color: '#ffffff', border: '1px solid #2a2e39' }}
        >
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: '#787b86' }}>Follow Up Note / Account:</span>
        <input 
          type="text"
          value={note}
          onChange={e => handleNoteChange(e.target.value)}
          placeholder="e.g. kartiekn"
          className="modal-input"
          style={{ width: '100%', height: '28px', fontSize: '11px', background: '#131722', color: '#ffffff', border: '1px solid #2a2e39', borderRadius: '4px', padding: '0 8px' }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        />
      </div>

      {/* Collapsible Trader's Analysis Log */}
      <div style={{ marginTop: '2px', borderTop: '1px solid #2a2e39', paddingTop: '6px' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsLogOpen(!isLogOpen);
          }}
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#b2b5be',
            fontSize: '11px',
            padding: '6px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 500,
            outline: 'none'
          }}
        >
          <span>📋 Trader's Analysis Log</span>
          <span style={{ fontSize: '9px' }}>{isLogOpen ? '▼' : '▶'}</span>
        </button>

        {isLogOpen && (
          <div 
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px', 
              marginTop: '8px', 
              padding: '8px', 
              background: '#131722', 
              borderRadius: '4px', 
              border: '1px solid #2a2e39' 
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Displacement */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '10px', color: '#868993' }}>Displacement:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['low', 'medium', 'high'].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDisplacement(d)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      fontSize: '9px',
                      textTransform: 'capitalize',
                      background: displacement === d ? '#2962ff' : 'rgba(255,255,255,0.04)',
                      color: displacement === d ? '#ffffff' : '#b2b5be',
                      border: '1px solid ' + (displacement === d ? '#2962ff' : '#2a2e39'),
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Dealing Range location */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '10px', color: '#868993' }}>Dealing Range:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['discount', 'equilibrium', 'premium'].map(dr => (
                  <button
                    key={dr}
                    type="button"
                    onClick={() => setDiscountPremium(dr)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      fontSize: '9px',
                      textTransform: 'capitalize',
                      background: discountPremium === dr ? '#2962ff' : 'rgba(255,255,255,0.04)',
                      color: discountPremium === dr ? '#ffffff' : '#b2b5be',
                      border: '1px solid ' + (discountPremium === dr ? '#2962ff' : '#2a2e39'),
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    {dr.substring(0, 5)}
                  </button>
                ))}
              </div>
            </div>

            {/* Checkboxes for sweeps, mss, session, htf */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '2px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '10px', color: '#d1d4dc', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={liquiditySwept}
                  onChange={e => setLiquiditySwept(e.target.checked)}
                  style={{ accentColor: '#2962ff' }}
                />
                <span>Liquidity Swept?</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '10px', color: '#d1d4dc', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={mss}
                  onChange={e => setMss(e.target.checked)}
                  style={{ accentColor: '#2962ff' }}
                />
                <span>MSS / CHoCH?</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '10px', color: '#d1d4dc', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={sessionAligned}
                  onChange={e => setSessionAligned(e.target.checked)}
                  style={{ accentColor: '#2962ff' }}
                />
                <span>Session Aligned?</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '10px', color: '#d1d4dc', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={htfConfluence}
                  onChange={e => setHtfConfluence(e.target.checked)}
                  style={{ accentColor: '#2962ff' }}
                />
                <span>HTF Confluence?</span>
              </label>
            </div>

            {/* Analysis Narrative */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '10px', color: '#868993' }}>Reasoning Narrative:</span>
              <textarea
                value={analysisNarrative}
                onChange={e => setAnalysisNarrative(e.target.value)}
                placeholder="Explain why you drew this zone..."
                style={{
                  width: '100%',
                  height: '45px',
                  fontSize: '10px',
                  background: '#131722',
                  color: '#ffffff',
                  border: '1px solid #2a2e39',
                  borderRadius: '4px',
                  padding: '4px 6px',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'Outfit, sans-serif'
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
        <button 
          className="btn-primary" 
          style={{ flex: 1, height: '26px', padding: 0, fontSize: '11px', justifyContent: 'center', background: '#089981', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
          onClick={() => handleSave(true)}
        >
          Valid ✅
        </button>
        <button 
          className="btn-primary" 
          style={{ flex: 1, height: '26px', padding: 0, fontSize: '11px', justifyContent: 'center', background: '#f23645', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
          onClick={() => handleSave(false)}
        >
          Invalid ❌
        </button>
      </div>
    </div>
  );
}

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
