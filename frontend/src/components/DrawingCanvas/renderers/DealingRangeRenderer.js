import { hexToRGBA } from '../../../utils/themeResolver';

export default class DealingRangeRenderer {
  renderType = 'interval';
  layer = 'ZonesLayer';

  project(event, utils) {
    const timeframe = utils.timeframe || 1;
    const allBars = utils.allBars || [];
    
    const t0 = event.timeStart || event.time;
    let t1 = event.timeEnd;
    
    if (t1) {
      // Range is completed. Stop projection at event.timeEnd + 3 bars for readability.
      const idx = allBars.findIndex(b => b.time >= t1);
      if (idx !== -1) {
        const targetIdx = Math.min(allBars.length - 1, idx + 3);
        t1 = allBars[targetIdx].time;
      } else {
        t1 = t1 + timeframe * 60 * 3;
      }
    } else {
      // Range is active. Draw until the latest bar (or current replay limit).
      if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
        t1 = utils.limit;
      } else if (allBars.length > 0) {
        t1 = allBars[allBars.length - 1].time;
      } else {
        t1 = event.time + timeframe * 60 * 20;
      }
    }

    const props = event.properties || {};
    const price100 = props.level_100 !== undefined ? props.level_100 : event.priceHigh;
    const price75  = props.level_75 !== undefined ? props.level_75 : (event.priceLow + 0.75 * (event.priceHigh - event.priceLow));
    const price50  = props.level_50 !== undefined ? props.level_50 : (event.priceLow + 0.50 * (event.priceHigh - event.priceLow));
    const price25  = props.level_25 !== undefined ? props.level_25 : (event.priceLow + 0.25 * (event.priceHigh - event.priceLow));
    const price0   = props.level_0 !== undefined ? props.level_0 : event.priceLow;

    const coordsStart = utils.pointToCoords({ time: t0, price: price100 });
    const coordsEnd = utils.pointToCoords({ time: t1, price: price0 });

    if (!coordsStart || !coordsEnd) return { visible: false };

    const rx0 = Math.round(coordsStart.x);
    const rx1 = Math.round(coordsEnd.x);

    const ry100 = Math.round(utils.pointToCoords({ time: t0, price: price100 })?.y);
    const ry75  = Math.round(utils.pointToCoords({ time: t0, price: price75 })?.y);
    const ry50  = Math.round(utils.pointToCoords({ time: t0, price: price50 })?.y);
    const ry25  = Math.round(utils.pointToCoords({ time: t0, price: price25 })?.y);
    const ry0   = Math.round(utils.pointToCoords({ time: t0, price: price0 })?.y);

    return {
      visible: true,
      rx0,
      rx1,
      ry100,
      ry75,
      ry50,
      ry25,
      ry0,
      price100,
      price75,
      price50,
      price25,
      price0,
      event,
      debugMode: utils.debugMode
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;
    const { rx0, rx1, ry100, ry75, ry50, ry25, ry0, price100, price75, price50, price25, price0, event } = projected;

    ctx.save();

    const yTop = Math.min(ry100, ry0);
    const yBot = Math.max(ry100, ry0);
    const yMid = ry50;

    // 1. Draw premium (top) and discount (bottom) background fills
    ctx.fillStyle = 'rgba(38, 166, 154, 0.50)'; // Premium green fill
    ctx.fillRect(rx0, yTop, rx1 - rx0, yMid - yTop);

    ctx.fillStyle = 'rgba(239, 83, 80, 0.50)'; // Discount red fill
    ctx.fillRect(rx0, yMid, rx1 - rx0, yBot - yMid);

    // 2. Draw left vertical border — solid, clearly visible
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(178, 181, 190, 0.85)';
    ctx.beginPath();
    ctx.moveTo(rx0, yTop);
    ctx.lineTo(rx0, yBot);
    ctx.stroke();

    // 3. Draw horizontal level lines
    const levels = [
      { ry: ry100, label: '100',  price: price100, color: 'rgba(38, 166, 154, 0.95)', width: 2.0 },
      { ry: ry75,  label: '75',   price: price75,  color: 'rgba(38, 166, 154, 0.70)', width: 1.0 },
      { ry: ry50,  label: '50',   price: price50,  color: 'rgba(200, 200, 200, 0.80)', width: 1.5 },
      { ry: ry25,  label: '25',   price: price25,  color: 'rgba(239, 83,  80, 0.70)', width: 1.0 },
      { ry: ry0,   label: '0',    price: price0,   color: 'rgba(239, 83,  80, 0.95)', width: 2.0 }
    ];

    levels.forEach(level => {
      if (level.ry === undefined || isNaN(level.ry)) return;
      ctx.lineWidth = level.width;
      ctx.strokeStyle = level.color;
      ctx.beginPath();
      ctx.moveTo(rx0, level.ry);
      ctx.lineTo(rx1, level.ry);
      ctx.stroke();
    });

    // 4. Draw the text labels at the right end of each line
    ctx.font = '11.5px "Inter", "Outfit", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    
    levels.forEach(level => {
      if (level.ry === undefined || isNaN(level.ry)) return;
      ctx.fillStyle = level.color;
      const priceFmt = level.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const text = `${level.label} (${priceFmt})`;
      ctx.fillText(text, rx1 + 6, level.ry);
    });

    ctx.restore();
  }
}
