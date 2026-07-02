// Helper utilities for geometric calculations
const getDistance = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

const getDistanceToSegment = (px, py, x1, y1, x2, y2) => {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return getDistance(px, py, x1, y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return getDistance(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
};

const extendLineToViewport = (p1, p2, extendLeft, extendRight, w, h) => {
  let { x: x1, y: y1 } = p1;
  let { x: x2, y: y2 } = p2;

  const dx = x2 - x1;
  const dy = y2 - y1;

  const intersectX = (targetX) => (dx !== 0 ? (targetX - x1) / dx : null);
  const intersectY = (targetY) => (dy !== 0 ? (targetY - y1) / dy : null);

  const getYatX = (t) => y1 + t * dy;
  const getXatY = (t) => x1 + t * dx;

  const candidates = [];
  const tLeft = intersectX(0);
  if (tLeft !== null) {
    const yAtLeft = getYatX(tLeft);
    if (yAtLeft >= 0 && yAtLeft <= h) candidates.push({ t: tLeft, x: 0, y: yAtLeft });
  }
  const tRight = intersectX(w);
  if (tRight !== null) {
    const yAtRight = getYatX(tRight);
    if (yAtRight >= 0 && yAtRight <= h) candidates.push({ t: tRight, x: w, y: yAtRight });
  }
  const tTop = intersectY(0);
  if (tTop !== null) {
    const xAtTop = getXatY(tTop);
    if (xAtTop >= 0 && xAtTop <= w) candidates.push({ t: tTop, x: xAtTop, y: 0 });
  }
  const tBottom = intersectY(h);
  if (tBottom !== null) {
    const xAtBottom = getXatY(tBottom);
    if (xAtBottom >= 0 && xAtBottom <= w) candidates.push({ t: tBottom, x: xAtBottom, y: h });
  }

  candidates.sort((a, b) => a.t - b.t);

  let startPt = { x: x1, y: y1 };
  let endPt = { x: x2, y: y2 };

  if (extendLeft && candidates.length > 0) {
    const behind = candidates.filter(c => c.t < 0);
    if (behind.length > 0) {
      startPt = behind[behind.length - 1];
    }
  }
  if (extendRight && candidates.length > 0) {
    const ahead = candidates.filter(c => c.t > 1);
    if (ahead.length > 0) {
      endPt = ahead[0];
    }
  }

  return { x1: startPt.x, y1: startPt.y, x2: endPt.x, y2: endPt.y };
};

const getLineDegrees = (x1, y1, x2, y2) => {
  return Math.atan2(-(y2 - y1), x2 - x1) * (180 / Math.PI);
};

const hexToRGBA = (hex, alpha) => {
  let r = 41, g = 98, b = 255;
  if (hex && hex.startsWith('#')) {
    const cleanHex = hex.replace('#', '');
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const TrendLine = {
  type: 'trendline',

  draw(ctx, shape, isSelected, pointToCoords, w, h) {
    if (!shape.points || shape.points.length < 2) return;

    const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
    if (coords.length < 2) return;

    const color = shape.color || '#2962ff';
    const opacity = shape.opacity !== undefined ? shape.opacity : 1.0;

    ctx.save();
    ctx.strokeStyle = hexToRGBA(color, opacity);
    ctx.lineWidth = shape.width || 2;

    if (shape.lineStyle === 'dashed') {
      ctx.setLineDash([6, 6]);
    } else if (shape.lineStyle === 'dotted') {
      ctx.setLineDash([2, 3]);
    } else {
      ctx.setLineDash([]);
    }

    const extendLeft = shape.extendLeft || false;
    const extendRight = shape.extendRight || false;
    const ext = extendLineToViewport(coords[0], coords[1], extendLeft, extendRight, w, h);

    const pLeft = coords[0].x <= coords[1].x ? coords[0] : coords[1];
    const pRight = coords[0].x <= coords[1].x ? coords[1] : coords[0];
    const L = Math.sqrt((pRight.x - pLeft.x) ** 2 + (pRight.y - pLeft.y) ** 2);
    const angle = Math.atan2(pRight.y - pLeft.y, pRight.x - pLeft.x);

    // Project extended coordinates into rotated space
    const dx1 = ext.x1 - pLeft.x;
    const dy1 = ext.y1 - pLeft.y;
    const startX = dx1 * Math.cos(-angle) - dy1 * Math.sin(-angle);

    const dx2 = ext.x2 - pLeft.x;
    const dy2 = ext.y2 - pLeft.y;
    const endX = dx2 * Math.cos(-angle) - dy2 * Math.sin(-angle);

    // Check if we need to split/shorten the line due to middle text
    const hasText = shape.text && shape.text.trim() !== '';
    const textValign = shape.textValign || 'top';
    const textHalign = shape.textHalign || 'center';

    let segments = [];
    if (hasText && textValign === 'middle') {
      // Measure text width
      ctx.save();
      let fontStyle = '';
      if (shape.italic) fontStyle += 'italic ';
      if (shape.bold) fontStyle += '600 ';
      const fontSize = shape.fontSize || 12;
      ctx.font = `${fontStyle}${fontSize}px Outfit, sans-serif`;
      const textW = ctx.measureText(shape.text).width;
      ctx.restore();

      const pad = 4;
      if (textHalign === 'left') {
        const gapEnd = 8 + textW + pad;
        segments.push({ from: startX, to: 0 });
        segments.push({ from: gapEnd, to: endX });
      } else if (textHalign === 'right') {
        const gapStart = L - 8 - textW - pad;
        segments.push({ from: startX, to: gapStart });
        segments.push({ from: L, to: endX });
      } else { // center
        const gapStart = L / 2 - textW / 2 - pad;
        const gapEnd = L / 2 + textW / 2 + pad;
        segments.push({ from: startX, to: gapStart });
        segments.push({ from: gapEnd, to: endX });
      }
    } else {
      segments.push({ from: startX, to: endX });
    }

    // Draw segments in rotated coordinate space
    ctx.save();
    ctx.translate(pLeft.x, pLeft.y);
    ctx.rotate(angle);
    segments.forEach(seg => {
      if (seg.from < seg.to) {
        ctx.beginPath();
        ctx.moveTo(seg.from, 0);
        ctx.lineTo(seg.to, 0);
        ctx.stroke();
      }
    });
    ctx.restore();

    // Draw Price Labels on Y-axis (only for saved shapes, not preview)
    if (shape.showPriceLabel !== false && shape.id) {
      const labelPad = 4;
      const labelH = 18;
      ctx.setLineDash([]);
      ctx.font = '500 11px Outfit, sans-serif';

      const drawPriceTag = (price, cy) => {
        if (price === undefined || price === null || cy === null || cy === undefined) return;
        const label = price.toFixed(2);
        const tw = ctx.measureText(label).width + labelPad * 2;
        const tx = w - tw - 2;
        const ty = cy - labelH / 2;
        ctx.fillStyle = color;
        ctx.fillRect(tx, ty, tw, labelH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, tx + labelPad, cy + 4);
      };

      // P1 label (left anchor)
      if (shape.points[0].price !== undefined) {
        drawPriceTag(shape.points[0].price, coords[0].y);
      }

      // P2 label — when extendRight, show price at right-edge intersection (TradingView behavior)
      if (shape.points[1].price !== undefined) {
        let p2LabelY = coords[1].y;
        let p2Price = shape.points[1].price;

        if (extendRight && ext.x2 >= w - 1) {
          // Compute price at right-edge via linear interpolation between p1 and p2
          const dy = coords[1].y - coords[0].y;
          p2LabelY = ext.y2;
          if (Math.abs(dy) > 0.5) {
            const t = (ext.y2 - coords[0].y) / dy;
            p2Price = shape.points[0].price + t * (shape.points[1].price - shape.points[0].price);
          } else {
            p2Price = shape.points[0].price; // horizontal line — same price everywhere
          }
        }

        if (Math.abs(p2LabelY - coords[0].y) > 4) {
          drawPriceTag(p2Price, p2LabelY);
        }
      }
    }

    // Draw Angle Label
    if (shape.showAngle) {
      const deg = getLineDegrees(coords[0].x, coords[0].y, coords[1].x, coords[1].y);
      const midX = (coords[0].x + coords[1].x) / 2;
      const midY = (coords[0].y + coords[1].y) / 2;
      ctx.setLineDash([]);
      ctx.font = '600 10px Outfit, sans-serif';
      const angleText = `${deg.toFixed(1)}°`;
      const tw = ctx.measureText(angleText).width + 8;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(midX - tw / 2, midY - 20, tw, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(angleText, midX - tw / 2 + 4, midY - 7);
    }

    // Draw selection handles
    if (isSelected) {
      ctx.setLineDash([]);

      // Endpoint handles (p1 and p2)
      coords.forEach(c => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });

      // Midpoint handle — drag this to move the entire line (TradingView behavior)
      const midX = (coords[0].x + coords[1].x) / 2;
      const midY = (coords[0].y + coords[1].y) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(midX, midY, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  },

  hitTest(x, y, shape, pointToCoords, w, h, isSelected) {
    if (!shape.points || shape.points.length < 2) return null;

    const coords = shape.points.map(p => pointToCoords(p)).filter(Boolean);
    if (coords.length < 2) return null;

    // Check handles first if selected
    if (isSelected) {
      // Midpoint handle — checked before endpoints to prioritise centre drag
      const midX = (coords[0].x + coords[1].x) / 2;
      const midY = (coords[0].y + coords[1].y) / 2;
      if (getDistance(x, y, midX, midY) < 8) {
        return { type: 'handle', pointIdx: 'mid' };
      }

      // Endpoint handles
      for (let i = 0; i < coords.length; i++) {
        if (getDistance(x, y, coords[i].x, coords[i].y) < 8) {
          return { type: 'handle', pointIdx: i };
        }
      }
    }

    // Check body segment (respects extend left/right)
    const extendLeft = shape.extendLeft || false;
    const extendRight = shape.extendRight || false;
    const ext = extendLineToViewport(coords[0], coords[1], extendLeft, extendRight, w, h);

    const d = getDistanceToSegment(x, y, ext.x1, ext.y1, ext.x2, ext.y2);
    if (d < 6) {
      return { type: 'body' };
    }

    return null;
  }
};
