/**
 * frontend/src/utils/themeResolver.js
 * Unifies visual rendering styles, labels, colors, and priorities
 * for all Price Engine events and candidates.
 */

// Helper to convert hex to RGBA
function hexToRGBA(hex, alpha = 1.0) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const COLOR_BULLISH = '#26a69a'; // Teal/Green
const COLOR_BEARISH = '#ef5350'; // Red
const COLOR_NEUTRAL = '#787b86';  // Gray
const COLOR_LEVEL = '#ff9800';    // Orange for reference levels
const COLOR_BLUE = '#2962ff';     // Blue for special states

function getEventVisualConfig(event, selectedConcept = '') {
  const type = (event.type || '').toLowerCase();
  const concept = (event.concept || '').toLowerCase();
  const state = (event.state || event.concept_state || 'active').toLowerCase();
  const direction = (event.direction || '').toLowerCase();
  const tf = event.timeframe || 1;

  let color = COLOR_BLUE;
  let labelText = type.toUpperCase();
  let borderStyle = 'solid';
  let borderWidth = 1.2;
  let bgOpacity = 0.06;
  let borderOpacity = 0.45;
  let priority = 3;

  // 1. Determine direction-based colors & label text
  if (type === 'fvg') {
    const isBull = direction === 'bullish' || direction === 'bisi';
    
    if (state === 'inverted' || state === 'failed_inverted') {
      // support turned resistance or vice-versa
      color = isBull ? COLOR_BEARISH : COLOR_BULLISH;
      labelText = isBull ? 'IBISI' : 'ISIBI';
      borderStyle = 'dashed';
    } else {
      color = isBull ? COLOR_BULLISH : COLOR_BEARISH;
      labelText = isBull ? 'BISI' : 'SIBI';
    }
  } else if (type === 'ifvg') {
    const isBull = direction === 'bullish' || direction === 'ibisi';
    color = isBull ? COLOR_BULLISH : COLOR_BEARISH;
    labelText = isBull ? 'IBISI' : 'ISIBI';
    borderStyle = 'dashed';
  } else if (type === 'ob') {
    const isBull = direction === 'bullish';
    
    if (state === 'breaker') {
      color = isBull ? COLOR_BEARISH : COLOR_BULLISH; // bullish OB broken becomes bearish breaker
      labelText = 'Breaker';
      borderStyle = 'dashed';
    } else if (state === 'mitigation') {
      color = isBull ? COLOR_BEARISH : COLOR_BULLISH;
      labelText = 'Mitigation';
      borderStyle = 'dashed';
    } else {
      color = isBull ? COLOR_BULLISH : COLOR_BEARISH;
      labelText = 'OB';
    }
  } else if (type === 'swing' || type === 'strong_swing') {
    const isHigh = direction === 'bearish'; // swing high = BSL
    color = isHigh ? COLOR_LEVEL : COLOR_BEARISH; // orange for BSL swing high, red for SSL swing low
    labelText = isHigh ? 'SwH (BSL)' : 'SwL (SSL)';
    borderStyle = 'dotted';
    borderWidth = 1.2;
    bgOpacity = 0.03;
  } else if (type === 'liquidity') {
    const isBSL = direction === 'bsl' || direction === 'eqh' || direction === 'reqh';
    color = isBSL ? COLOR_BULLISH : COLOR_BEARISH;
    labelText = direction.toUpperCase();
  } else if (type === 'reference_level') {
    color = COLOR_LEVEL;
    labelText = direction.toUpperCase();
  } else if (type === 'session') {
    color = COLOR_NEUTRAL;
    labelText = direction.toUpperCase();
  } else if (type === 'macro') {
    color = COLOR_NEUTRAL;
    labelText = 'Macro';
  } else if (type === 'amd') {
    color = direction === 'bullish' ? COLOR_BULLISH : COLOR_BEARISH;
    labelText = `AMD (${direction.toUpperCase()})`;
  } else if (type === 'premium_discount') {
    color = direction === 'premium' ? COLOR_BEARISH : COLOR_BULLISH;
    labelText = direction.toUpperCase();
  } else if (type === 'volume_imbalance') {
    color = direction === 'bullish' ? COLOR_BULLISH : COLOR_BEARISH;
    labelText = 'Vol Imb';
  } else if (type === 'liquidity_void') {
    color = direction === 'bullish' ? COLOR_BULLISH : COLOR_BEARISH;
    labelText = 'Void';
  }

  // 2. Adjust styling options based on state
  if (state === 'mitigated') {
    borderStyle = 'dotted';
    borderWidth = 1.0;
    bgOpacity = 0.02;
    borderOpacity = 0.25;
  } else if (state === 'failed' || state === 'invalidated') {
    borderStyle = 'dotted';
    borderWidth = 0.8;
    bgOpacity = 0.01;
    borderOpacity = 0.15;
  }

  // 3. Compute priority score (1 to 5)
  if (type === 'reference_level' || tf >= 240) {
    priority = 5; // Critical HTF levels
  } else if (state === 'active' || state === 'inverted' || state === 'breaker' || state === 'mitigation') {
    priority = 4; // High relevance active zones
  } else if (state === 'mitigated') {
    priority = 3; // Medium relevance retested zones
  } else {
    priority = 2; // Historical failed zones
  }

  // Color overrides for approved/rejected user validations
  if (event.validation?.status === 'approved') {
    color = COLOR_BULLISH;
  } else if (event.validation?.status === 'rejected') {
    color = COLOR_BEARISH;
  }

  // Convert properties to RGBA colors
  return {
    color,
    fillColor: hexToRGBA(color, bgOpacity),
    borderColor: hexToRGBA(color, borderOpacity),
    borderStyle,
    borderWidth,
    labelText,
    priority,
    bgOpacity,
    borderOpacity
  };
}

export {
  getEventVisualConfig,
  hexToRGBA
};
