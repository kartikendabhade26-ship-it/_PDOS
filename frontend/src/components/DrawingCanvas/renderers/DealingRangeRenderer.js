import { hexToRGBA } from '../../../utils/themeResolver';

export default class DealingRangeRenderer {
  renderType = 'interval';
  layer = 'ZonesLayer';

  project(event, utils) {
    const timeframe = utils.timeframe || 1;
    const allBars = utils.allBars || [];
    
    const t0 = event.timeStart || event.time;
    let t1 = event.timeEnd;
    if (!t1 || (utils.replayMode && utils.limit && t1 > utils.limit)) {
      if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
        t1 = utils.limit;
      } else if (allBars.length > 0) {
        t1 = allBars[allBars.length - 1].time;
      } else {
        t1 = event.time + timeframe * 60 * 10;
      }
    }

    const coordsStart = utils.pointToCoords({ time: t0, price: event.priceHigh });
    const coordsEnd = utils.pointToCoords({ time: t1, price: event.priceLow });

    if (!coordsStart || !coordsEnd) return { visible: false };

    const rx0 = Math.round(Math.min(coordsStart.x, coordsEnd.x));
    const rx1 = Math.round(Math.max(coordsStart.x, coordsEnd.x));
    const ryHigh = Math.round(Math.min(coordsStart.y, coordsEnd.y));
    const ryLow = Math.round(Math.max(coordsStart.y, coordsEnd.y));

    return {
      visible: true,
      rx0,
      rx1,
      ryHigh,
      ryLow,
      event,
      debugMode: utils.debugMode
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;
    const { rx0, rx1, ryHigh, ryLow, event, debugMode } = projected;
    
    // Check if event is active/developing vs completed vs invalidated
    const isHistorical = event.state === 'completed' || event.state === 'invalidated';
    const opacity = isSelected ? 1.0 : (isHistorical ? 0.25 : 0.85);

    const priceHigh = event.priceHigh;
    const priceLow = event.priceLow;
    
    const height = ryLow - ryHigh;
    const ryEq = ryHigh + height * 0.5;
    const ry25 = ryHigh + height * 0.75;
    const ry75 = ryHigh + height * 0.25;

    ctx.save();
    
    // Neutral clean styling (semi-translucent white line strokes)
    ctx.strokeStyle = hexToRGBA('#ffffff', opacity * 0.4);
    ctx.lineWidth = isSelected ? 1.5 : 1.0;
    
    // 1. Draw Left and Right Vertical Brackets (start and end anchors of the range)
    ctx.beginPath();
    ctx.moveTo(rx0, ryHigh);
    ctx.lineTo(rx0, ryLow);
    ctx.moveTo(rx1, ryHigh);
    ctx.lineTo(rx1, ryLow);
    ctx.stroke();

    // 2. Draw Horizontal Levels
    ctx.beginPath();
    // Level 1 (High)
    ctx.moveTo(rx0, ryHigh);
    ctx.lineTo(rx1, ryHigh);
    // Level 0.75
    ctx.moveTo(rx0, ry75);
    ctx.lineTo(rx1, ry75);
    // Level 0.5 (EQ)
    ctx.moveTo(rx0, ryEq);
    ctx.lineTo(rx1, ryEq);
    // Level 0.25
    ctx.moveTo(rx0, ry25);
    ctx.lineTo(rx1, ry25);
    // Level 0 (Low)
    ctx.moveTo(rx0, ryLow);
    ctx.lineTo(rx1, ryLow);
    
    ctx.stroke();
    ctx.restore();

    // 3. Draw Right-Aligned Level Labels: "{fraction} ({price})"
    ctx.save();
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = hexToRGBA('#e1e2e7', opacity * 0.85);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const priceRange = priceHigh - priceLow;
    const price75 = priceLow + priceRange * 0.75;
    const priceEq = priceLow + priceRange * 0.5;
    const price25 = priceLow + priceRange * 0.25;

    ctx.fillText(`1 (${priceHigh.toFixed(2)})`, rx1 + 6, ryHigh);
    ctx.fillText(`0.75 (${price75.toFixed(2)})`, rx1 + 6, ry75);
    ctx.fillText(`0.5 (${priceEq.toFixed(2)})`, rx1 + 6, ryEq);
    ctx.fillText(`0.25 (${price25.toFixed(2)})`, rx1 + 6, ry25);
    ctx.fillText(`0 (${priceLow.toFixed(2)})`, rx1 + 6, ryLow);
    
    ctx.restore();
  }
}
