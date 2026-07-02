import { hexToRGBA } from '../../../utils/themeResolver';

export default class LiquidityRenderer {
  renderType = 'interval';
  layer = 'LiquidityLayer';

  project(event, utils) {
    const timeframe = utils.timeframe || 1;
    const allBars = utils.allBars || [];
    
    const t0 = event.timeStart || (event.time - timeframe * 60);
    let t1;
    const stateHistory = event.properties?.stateHistory || [];
    const takenEvent = stateHistory.find(h => 
      (h.state === 'taken' || h.state === 'swept') && 
      (!utils.replayMode || !utils.limit || h.time <= utils.limit)
    );
    
    if (takenEvent) {
      t1 = takenEvent.time;
    } else {
      if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
        t1 = utils.limit;
      } else if (allBars.length > 0) {
        t1 = allBars[allBars.length - 1].time;
      } else {
        t1 = event.time + timeframe * 60 * 10;
      }
    }

    const levelPrice = event.properties?.levelPrice || event.levelPrice || ((event.priceHigh + event.priceLow) / 2);
    
    const coords0 = utils.pointToCoords({ time: t0, price: event.priceHigh });
    const coords1 = utils.pointToCoords({ time: t1, price: event.priceLow });
    const coordsLevel = utils.pointToCoords({ time: event.time, price: levelPrice });

    if (!coords0 || !coords1) return { visible: false };

    const rx0 = Math.round(Math.min(coords0.x, coords1.x));
    const rx1 = Math.round(Math.max(coords0.x, coords1.x));
    const ryLevel = coordsLevel ? Math.round(coordsLevel.y) : Math.round(Math.min(coords0.y, coords1.y) + Math.abs(coords0.y - coords1.y) / 2);

    return {
      visible: true,
      rx0,
      rx1,
      ryLevel,
      event,
      debugMode: utils.debugMode,
      isTraded: !!takenEvent
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;
    const { rx0, rx1, ryLevel, event, debugMode, isTraded } = projected;
    const color = config.color || '#2962ff';
    const validationStatus = event.validation?.status;

    ctx.save();
    const opacity = isSelected ? 1.0 : (isTraded ? 0.20 : 0.85);
    ctx.strokeStyle = hexToRGBA(color, opacity);
    ctx.lineWidth = isSelected ? 2.2 : 1.2;
    if (debugMode) {
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([3, 3]);
    }
    ctx.beginPath();
    ctx.moveTo(rx0, ryLevel);
    ctx.lineTo(rx1, ryLevel);
    ctx.stroke();
    ctx.restore();

    // Render BSL/SSL/EQH/EQL label at the right end of the line
    ctx.save();
    ctx.font = isSelected ? '600 10px Outfit, sans-serif' : '9px Outfit, sans-serif';
    ctx.fillStyle = hexToRGBA(color, opacity);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let labelText = event.direction.toUpperCase();
    if (labelText === 'EQH') labelText = 'REQH';
    if (labelText === 'EQL') labelText = 'REQL';
    
    const isMajor = event.properties?.isMajor || false;
    if (isMajor) {
      labelText = 'Major ' + labelText;
    }

    if (validationStatus) {
      labelText += validationStatus === 'approved' ? ' (Valid)' : ' (Invalid)';
    }
    ctx.fillText(labelText, rx1 + 6, ryLevel);
    ctx.restore();
  }
}
