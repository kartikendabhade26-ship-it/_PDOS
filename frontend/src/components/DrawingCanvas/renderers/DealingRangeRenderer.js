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
    const opacity = isSelected ? 1.0 : (isHistorical ? 0.2 : 0.85);

    const priceHigh = event.priceHigh;
    const priceLow = event.priceLow;
    const equilibriumPrice = (priceHigh + priceLow) / 2;

    const height = ryLow - ryHigh;
    const ryEq = ryHigh + height * 0.5;
    const ry25 = ryHigh + height * 0.75;
    const ry75 = ryHigh + height * 0.25;

    const direction = event.direction; // 'bullish' | 'bearish'
    const colorPremium = '#ff1744'; // Pink/Red
    const colorDiscount = '#00b0ff'; // Teal/Blue

    if (debugMode) {
      ctx.save();
      ctx.fillStyle = hexToRGBA(direction === 'bullish' ? colorDiscount : colorPremium, opacity * 0.03);
      ctx.fillRect(rx0, ryHigh, rx1 - rx0, height);

      ctx.strokeStyle = hexToRGBA(direction === 'bullish' ? colorDiscount : colorPremium, opacity * 0.5);
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(rx0, ryHigh, rx1 - rx0, height);

      ctx.strokeStyle = hexToRGBA('#ffffff', opacity * 0.5);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rx0, ryEq);
      ctx.lineTo(rx1, ryEq);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.font = 'bold 9px Outfit, monospace';
      ctx.fillStyle = hexToRGBA('#ffffff', opacity * 0.8);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`Range (${event.direction})`, rx0 + 8, ryHigh + 10);
      ctx.fillText('EQ (50%)', rx1 + 6, ryEq);
      ctx.fillText('High (100%)', rx1 + 6, ryHigh);
      ctx.fillText('Low (0%)', rx1 + 6, ryLow);
      ctx.restore();
      return;
    }

    ctx.save();
    
    // Draw Premium zone shading (High to Eq)
    ctx.fillStyle = hexToRGBA(colorPremium, opacity * 0.04);
    ctx.fillRect(rx0, ryHigh, rx1 - rx0, ryEq - ryHigh);

    // Draw Discount zone shading (Eq to Low)
    ctx.fillStyle = hexToRGBA(colorDiscount, opacity * 0.04);
    ctx.fillRect(rx0, ryEq, rx1 - rx0, ryLow - ryEq);

    // Draw grid lines
    ctx.lineWidth = isSelected ? 1.8 : 1.0;
    
    // High Boundary
    ctx.strokeStyle = hexToRGBA(colorPremium, opacity * 0.4);
    ctx.beginPath();
    ctx.moveTo(rx0, ryHigh);
    ctx.lineTo(rx1, ryHigh);
    ctx.stroke();

    // Low Boundary
    ctx.strokeStyle = hexToRGBA(colorDiscount, opacity * 0.4);
    ctx.beginPath();
    ctx.moveTo(rx0, ryLow);
    ctx.lineTo(rx1, ryLow);
    ctx.stroke();

    // Equilibrium (50%)
    ctx.strokeStyle = hexToRGBA(direction === 'bullish' ? colorDiscount : colorPremium, opacity * 0.5);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(rx0, ryEq);
    ctx.lineTo(rx1, ryEq);
    ctx.stroke();

    // 25% and 75% Fibonacci levels
    ctx.strokeStyle = hexToRGBA('#ffffff', opacity * 0.3);
    ctx.setLineDash([2, 2]);
    
    ctx.beginPath();
    ctx.moveTo(rx0, ry25);
    ctx.lineTo(rx1, ry25);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rx0, ry75);
    ctx.lineTo(rx1, ry75);
    ctx.stroke();

    ctx.restore();

    // Draw Right Axis Brackets / labels
    ctx.save();
    ctx.font = '9px Outfit, sans-serif';
    ctx.fillStyle = hexToRGBA('#ffffff', opacity * 0.75);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    
    ctx.fillText('100% (High)', rx1 + 6, ryHigh);
    ctx.fillText('75%', rx1 + 6, ry75);
    ctx.fillText('50% (EQ)', rx1 + 6, ryEq);
    ctx.fillText('25%', rx1 + 6, ry25);
    ctx.fillText('0% (Low)', rx1 + 6, ryLow);
    
    ctx.restore();
  }
}
