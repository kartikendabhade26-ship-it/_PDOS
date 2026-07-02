import { hexToRGBA } from '../../../utils/themeResolver';

export default class DeliveryLegRenderer {
  renderType = 'interval';
  layer = 'ZonesLayer';

  project(event, utils) {
    const timeframe = utils.timeframe || 1;
    const allBars = utils.allBars || [];
    
    const tStart = event.timeStart || event.time;
    let tEnd = event.timeEnd;
    if (!tEnd || (utils.replayMode && utils.limit && tEnd > utils.limit)) {
      if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
        tEnd = utils.limit;
      } else if (allBars.length > 0) {
        tEnd = allBars[allBars.length - 1].time;
      } else {
        tEnd = event.time + timeframe * 60 * 10;
      }
    }

    const anchorPrice = event.properties?.anchorPrice || event.priceHigh;
    let currentExtremum = event.properties?.deliveryState?.current_extremum || event.properties?.currentExtremum || event.priceLow;

    // Dynamically calculate extremum up to the replay limit to avoid look-ahead bias
    if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
      const startIdx = allBars.findIndex(b => b.time >= tStart);
      const limitIdx = utils.replayIndex - 1;
      if (startIdx !== -1 && limitIdx >= startIdx) {
        let ext = anchorPrice;
        for (let idx = startIdx; idx <= limitIdx; idx++) {
          const b = allBars[idx];
          if (event.direction === 'bullish') {
            if (b.high > ext) ext = b.high;
          } else {
            if (b.low < ext) ext = b.low;
          }
        }
        currentExtremum = ext;
      }
    }

    const coordsStart = utils.pointToCoords({ time: tStart, price: anchorPrice });
    const coordsEnd = utils.pointToCoords({ time: tEnd, price: currentExtremum });

    if (!coordsStart || !coordsEnd) return { visible: false };

    return {
      visible: true,
      x0: coordsStart.x,
      y0: coordsStart.y,
      x1: coordsEnd.x,
      y1: coordsEnd.y,
      event,
      debugMode: utils.debugMode
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;
    const { x0, y0, x1, y1, event, debugMode } = projected;
    
    const isHistorical = event.state === 'completed' || event.state === 'invalidated';
    const opacity = isSelected ? 1.0 : (isHistorical ? 0.2 : 0.85);

    const direction = event.direction; // 'bullish' | 'bearish'
    const color = direction === 'bullish' ? '#00e676' : '#ff1744'; // Bright Green / Bright Red

    if (debugMode) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Label at middle
      ctx.font = 'bold 9px Outfit, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(`Leg (${direction})`, (x0 + x1) / 2, (y0 + y1) / 2 - 5);

      ctx.restore();
      return;
    }
    ctx.save();
    
    // Draw vector line
    ctx.strokeStyle = hexToRGBA(color, opacity * 0.8);
    ctx.lineWidth = isSelected ? 3.0 : 2.0;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Draw arrow head at the end of the leg
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const arrowLength = 10;
    ctx.fillStyle = hexToRGBA(color, opacity * 0.9);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - arrowLength * Math.cos(angle - Math.PI / 6), y1 - arrowLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x1 - arrowLength * Math.cos(angle + Math.PI / 6), y1 - arrowLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
