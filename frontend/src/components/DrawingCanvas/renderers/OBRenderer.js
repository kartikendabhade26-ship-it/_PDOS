import { hexToRGBA } from '../../../utils/themeResolver';

export default class OBRenderer {
  renderType = 'interval';
  layer = 'ZonesLayer';

  project(event, utils) {
    const timeframe = utils.timeframe || 1;
    const allBars = utils.allBars || [];

    const t0 = event.timeStart || (event.time - timeframe * 60);
    
    let t1;
    if (event.timeEnd && !event.outcome) {
      t1 = event.timeEnd;
    } else if (event.touchedZone && event.barsToTouch !== undefined) {
      t1 = event.time + (event.barsToTouch * timeframe * 60);
    } else {
      if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
        t1 = utils.limit;
      } else if (allBars.length > 0) {
        t1 = allBars[allBars.length - 1].time;
      } else {
        t1 = event.time + timeframe * 60 * 10;
      }
    }

    if (utils.replayMode && utils.limit && t1 > utils.limit) {
      t1 = utils.limit;
    }

    const coords0 = utils.pointToCoords({ time: t0, price: event.priceHigh });
    const coords1 = utils.pointToCoords({ time: t1, price: event.priceLow });

    if (!coords0 || !coords1) return { visible: false };

    const rx0 = Math.round(Math.min(coords0.x, coords1.x));
    const ry0 = Math.round(Math.min(coords0.y, coords1.y));
    const rx1 = Math.round(Math.max(coords0.x, coords1.x));
    const ry1 = Math.round(Math.max(coords0.y, coords1.y));
    const rw = rx1 - rx0;
    const rh = ry1 - ry0;

    return {
      visible: true,
      rx0,
      ry0,
      rx1,
      ry1,
      rw,
      rh,
      event
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;
    const { rx0, ry0, rx1, ry1, rw, rh, event } = projected;
    const color = config.color || '#2962ff';
    const validationStatus = event.validation?.status;

    // Fill background for Order Blocks
    ctx.save();
    ctx.fillStyle = hexToRGBA(color, isSelected ? 0.22 : 0.06);
    ctx.fillRect(rx0, ry0, rw, rh);

    // Border
    ctx.strokeStyle = hexToRGBA(color, isSelected ? 1.0 : 0.45);
    ctx.lineWidth = isSelected ? 2.5 : 1.2;
    if (!validationStatus && !event.outcome) {
      ctx.setLineDash([4, 4]); // dashed border
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.rect(rx0, ry0, rw, rh);
    ctx.stroke();

    // Draw midline if selected
    if (isSelected || event.outcome === 'bounce_50pct') {
      const midY = Math.round(ry0 + rh / 2);
      ctx.strokeStyle = hexToRGBA(color, 0.5);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rx0, midY);
      ctx.lineTo(rx1, midY);
      ctx.stroke();
    }
    ctx.restore();

    // Draw small text label pill in corner
    ctx.save();
    let labelText = '';
    if (validationStatus) {
      labelText = validationStatus === 'approved' ? '✅ Valid' : '❌ Invalid';
    } else {
      if (event.type === 'premium_discount') {
        const isExternal = event.properties && event.properties.isExternal;
        labelText = `${isExternal ? 'External' : 'Internal'} ${event.direction === 'premium' ? 'Premium' : 'Discount'}`;
      } else {
        labelText = config.labelText || (event.direction === 'bullish' ? 'Bullish OB' : 'Bearish OB');
      }
    }

    if (event.confidence !== undefined) {
      labelText += ` | Gemma: ${(event.confidence * 100).toFixed(0)}%`;
    }

    if (event.properties?.displacementAtrRatio !== undefined) {
      labelText += ` | Disp: ${event.properties.displacementAtrRatio.toFixed(1)}x ATR`;
    }

    if (event.outcome && event.outcome !== 'no_touch') {
      const outcomeLabel = event.outcome === 'bounce_edge' ? 'Edge Bounce' :
                           event.outcome === 'bounce_50pct' ? '50% Bounce' :
                           event.outcome === 'mitigated' ? 'Mitigated' :
                           event.outcome === 'sweep_reverse' ? 'Sweep & Rev' : event.outcome;
      labelText += ` | ${outcomeLabel}`;
    }

    ctx.font = isSelected ? '600 10px Outfit, sans-serif' : '9px Outfit, sans-serif';
    const textW = ctx.measureText(labelText).width;
    const padX = 6, padY = 3;
    const badgeW = textW + padX * 2;
    const badgeH = 16;
    const badgeX = rx0 + 4;
    const badgeY = ry0 + 4;

    // Only draw badge if it fits in the zone width
    if (rw >= badgeW + 8) {
      ctx.fillStyle = 'rgba(28, 32, 48, 0.85)';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(labelText, badgeX + padX, badgeY + 8);
    }
    ctx.restore();
  }
}
