/**
 * SwingRenderer.js
 *
 * Renders ICT fractal swing pivots with degree-based visual hierarchy:
 *
 *   degree=1  → STH / STL  (small, grey/muted)
 *   degree=2  → ITH / ITL  (medium, gold)
 *   degree=3  → LTH / LTL  (large, red/green)
 *
 * The degree is read from event.properties.degree or event.concept_label.
 * All label/size/colour decisions live here — the backend never knows about them.
 */

// Degree-specific visual config
const DEGREE_CONFIG = {
  1: {
    label_high: 'STH',
    label_low:  'STL',
    color_high: '#9e9e9e',   // muted grey  — STH
    color_low:  '#9e9e9e',   // muted grey  — STL
    size: 4,
    fontSize: '8px',
    fontWeight: '400',
    lineOffset: 8             // px from candle tip to triangle
  },
  2: {
    label_high: 'ITH',
    label_low:  'ITL',
    color_high: '#ffa726',   // amber gold — ITH
    color_low:  '#ffa726',   // amber gold — ITL
    size: 6,
    fontSize: '9px',
    fontWeight: '600',
    lineOffset: 10
  },
  3: {
    label_high: 'LTH',
    label_low:  'LTL',
    color_high: '#ef5350',   // red   — LTH
    color_low:  '#26a69a',   // teal  — LTL
    size: 9,
    fontSize: '10px',
    fontWeight: '700',
    lineOffset: 14
  }
};

// Map concept_label string → degree number (fallback for events before resync)
const LABEL_TO_DEGREE = {
  STH: 1, STL: 1,
  ITH: 2, ITL: 2,
  LTH: 3, LTL: 3
};

function getDegree(event) {
  // Prefer explicit degree property
  if (event.properties?.degree) return event.properties.degree;
  // Derive from concept_label
  if (event.concept_label) {
    const d = LABEL_TO_DEGREE[event.concept_label.toUpperCase()];
    if (d) return d;
  }
  // Legacy: old 'Swing' concept_type events default to degree=1
  return 1;
}
export default class SwingRenderer {
  renderType = 'point';
  layer = 'SwingsLayer';

  project(event, utils) {
    const isBullish = event.direction === 'bullish';
    
    // Check visibility based on structural status and viewMode
    const isStructural = event.isStructural !== false && event.properties?.isStructural !== false;
    const viewMode = utils.viewMode || 'analysis';

    if (viewMode === 'narrative' && !isStructural) {
      return { coords: null, isBullish, event };
    }

    const visible = event.visible !== false && event.properties?.visible !== false;
    const renderHint = event.renderHint || event.properties?.renderHint;
    if (!visible || renderHint === 'hidden') {
      if (viewMode !== 'debug' && viewMode !== 'analysis') {
        return { coords: null, isBullish, event };
      }
    }

    // Hide unconfirmed swings in replay mode
    let confirmIdx = event.confirmationBarIndex !== undefined ? event.confirmationBarIndex :
                     event.properties?.confirmationBar !== undefined ? event.properties.confirmationBar :
                     (event.barIndex + 1);
    if (utils.replayMode && utils.replayIndex > 0) {
      if (utils.replayIndex <= confirmIdx) {
        return { coords: null, isBullish, event };
      }
    }

    const price = isBullish ? event.priceLow : event.priceHigh;
    const coords = utils.pointToCoords({ time: event.time, price });

    // Debug audit info
    let debugInfo = null;
    if (utils.debugMode && utils.allBars) {
      const pivotIdx = utils.allBars.findIndex(b => b.time === event.time);
      if (pivotIdx !== -1) {
        const prevBar = utils.allBars[pivotIdx - 1];
        const currBar = utils.allBars[pivotIdx];
        const nextBar = utils.allBars[pivotIdx + 1];
        if (prevBar && currBar && nextBar) {
          debugInfo = {
            idx: pivotIdx,
            prevVal: isBullish ? prevBar.low : prevBar.high,
            currVal: isBullish ? currBar.low : currBar.high,
            nextVal: isBullish ? nextBar.low : nextBar.high,
            confirm: confirmIdx
          };
        }
      }
    }

    const degree = getDegree(event);
    const eventTimeframe = event.timeframe || 1;
    const chartTimeframe = utils.timeframe || 1;
    return { coords, isBullish, event, debugMode: utils.debugMode, debugInfo, degree, isStructural, eventTimeframe, chartTimeframe, labelOccupied: utils.labelOccupied || null };
  }

  draw(ctx, projected, config, isSelected) {
    const { coords, isBullish, event, debugMode, debugInfo, degree, isStructural, eventTimeframe, chartTimeframe, labelOccupied } = projected;
    if (!coords) return;

    const degCfg = DEGREE_CONFIG[degree] || DEGREE_CONFIG[1];
    const color = isBullish ? degCfg.color_low : degCfg.color_high;
    const label = isBullish ? degCfg.label_low : degCfg.label_high;
    const size  = isSelected ? degCfg.size + 3 : degCfg.size;
    const off   = degCfg.lineOffset;

    // ── Debug Mode (audit triangles + metric values) ────────────────────────
    if (debugMode) {
      ctx.save();
      if (!isStructural) {
        ctx.globalAlpha = 0.40; // Faded visual for raw non-structural wicks
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 2 : 1;

      ctx.beginPath();
      if (isBullish) {
        ctx.moveTo(coords.x, coords.y + 4);
        ctx.lineTo(coords.x - size, coords.y + 4 + size * 1.5);
        ctx.lineTo(coords.x + size, coords.y + 4 + size * 1.5);
      } else {
        ctx.moveTo(coords.x, coords.y - 4);
        ctx.lineTo(coords.x - size, coords.y - 4 - size * 1.5);
        ctx.lineTo(coords.x + size, coords.y - 4 - size * 1.5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = `bold 8px Outfit, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;

      if (debugInfo) {
        const lines = [
          `${label} d${degree} (i:${debugInfo.idx})`,
          `prev:${debugInfo.prevVal}`,
          `pivot:${debugInfo.currVal}`,
          `next:${debugInfo.nextVal}`,
          `conf:${debugInfo.confirm}`
        ];
        lines.forEach((line, lineIdx) => {
          const yOffset = isBullish ? (18 + lineIdx * 9) : (-12 - (lines.length - 1 - lineIdx) * 9);
          ctx.fillText(line, coords.x, coords.y + yOffset);
        });
      } else {
        ctx.fillText(label, coords.x, isBullish ? coords.y + 20 : coords.y - 15);
      }
      ctx.restore();
      return;
    }

    // ── Normal Mode ─────────────────────────────────────────────────────────
    ctx.save();
    if (!isStructural) {
      ctx.globalAlpha = 0.40; // Faded visual for raw non-structural wicks
    }

    // Optional glow for higher degrees
    if (degree >= 2) {
      ctx.shadowColor = color;
      ctx.shadowBlur = degree === 3 ? 8 : 4;
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = degree >= 2 ? '#ffffff' : 'transparent';
    ctx.lineWidth = isSelected ? 2 : 1;

    // Draw triangle
    ctx.beginPath();
    if (isBullish) {
      ctx.moveTo(coords.x, coords.y + off);
      ctx.lineTo(coords.x - size, coords.y + off + size * 1.5);
      ctx.lineTo(coords.x + size, coords.y + off + size * 1.5);
    } else {
      ctx.moveTo(coords.x, coords.y - off);
      ctx.lineTo(coords.x - size, coords.y - off - size * 1.5);
      ctx.lineTo(coords.x + size, coords.y - off - size * 1.5);
    }
    ctx.closePath();
    ctx.fill();
    if (degree >= 2) ctx.stroke();

    // Reset glow before label
    ctx.shadowBlur = 0;

    // Label — only for structural swings to prevent clutter
    if (isStructural) {
      ctx.font = `${degCfg.fontWeight} ${isSelected ? '11px' : degCfg.fontSize} Outfit, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';

      // Label collision guard — bucket canvas into 12px rows to prevent stacking
      const labelY = isBullish
        ? coords.y + off + size * 1.5 + 11
        : coords.y - off - size * 1.5 - 4;
      const labelBucket = Math.round(labelY / 12);
      if (!labelOccupied || !labelOccupied.has(labelBucket)) {
        ctx.fillText(label, coords.x, labelY);
        if (labelOccupied) labelOccupied.add(labelBucket);
      }
    }

    ctx.restore();
  }

}
