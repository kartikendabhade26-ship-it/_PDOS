import { hexToRGBA } from '../../../utils/themeResolver';

/**
 * LiquidityObjectRenderer — Sprint 1.1 (rev 2)
 *
 * Renders a Liquidity line from the swing origin to the first candle
 * that touches (or crosses) the liquidity price level.
 *
 * Termination rule (rendering only — NOT a sweep / classification engine):
 *   Buy-Side Liquidity  (swing high origin):  terminates when candle.high  >= liquidity.price
 *   Sell-Side Liquidity (swing low  origin):  terminates when candle.low   <= liquidity.price
 *
 * Rev 2 fix: scan uses TIMESTAMP binary-search instead of DB bar-index.
 * The DB barIndex is relative to the full historical CSV and does NOT map
 * 1:1 to allBars[] positions in the browser.  Using event.time (unix seconds)
 * for positioning is always correct regardless of how many bars are loaded.
 */

export default class LiquidityObjectRenderer {
  renderType = 'interval';
  layer = 'LiquidityLayer';

  project(event, utils) {
    const allBars   = utils.allBars || [];
    const timeframe = utils.timeframe || 1;

    // Compatible with both liquidity_object (priceHigh) and structure_event (levelPrice/priceHigh/priceLow)
    const price = event.priceHigh !== undefined ? event.priceHigh : (event.levelPrice || event.priceLow);
    
    // Resolve BSL vs SSL: buy_side/bearish is BSL, sell_side/bullish is SSL
    const side      = event.properties?.liquiditySide;
    const isBuySide = side === 'buy_side' || event.direction === 'bearish' || event.concept_label?.toLowerCase() === 'bsl';

    // event.time is the UNIX timestamp of the origin (swing pivot) candle.
    const originTime = event.time;
    const firstBarTime = allBars.length > 0 ? allBars[0].time : originTime;
    const isOldSwing   = allBars.length > 0 && originTime < firstBarTime;

    // Use stateful start and end times calculated by DrawingCanvas state tracker
    const t0 = utils.statefulLiquidity?.startBarTime !== undefined && utils.statefulLiquidity.startBarTime !== null
      ? utils.statefulLiquidity.startBarTime 
      : (isOldSwing ? firstBarTime : originTime);

    const endBarTime = utils.statefulLiquidity?.endBarTime !== undefined
      ? utils.statefulLiquidity.endBarTime
      : null;

    // Visibility gate: if we don't even have a valid startBarTime (swing pivot index+1 doesn't exist yet), hide it!
    if (utils.statefulLiquidity && utils.statefulLiquidity.startBarTime === null) {
      return { visible: false };
    }

    const isTerminated = endBarTime !== null;
    let   t1;
    if (isTerminated) {
      t1 = endBarTime;
    } else if (utils.replayMode && utils.limit && utils.limit !== Infinity) {
      t1 = utils.limit;
    } else if (allBars.length > 0) {
      t1 = allBars[allBars.length - 1].time;
    } else {
      t1 = originTime + timeframe * 60 * 10;
    }

    // --- Canvas coordinates ----------------------------------------------
    const coords0 = utils.pointToCoords({ time: t0, price });
    const coords1 = utils.pointToCoords({ time: t1, price });
    if (!coords0 || !coords1) return { visible: false };

    const rx0     = Math.round(Math.min(coords0.x, coords1.x));
    const rx1     = Math.round(Math.max(coords0.x, coords1.x));
    const ryLevel = Math.round(coords0.y);

    const takenAlpha = utils.takenLiqOpacity ?? 0.25;

    const eventTimeframe = event.timeframe || 1;
    const chartTimeframe = utils.timeframe || 1;

    return {
      visible: true,
      rx0,
      rx1,
      ryLevel,
      isTerminated,
      takenAlpha,
      eventTimeframe,
      chartTimeframe,
      event,
      debugMode: utils.debugMode,
      labelOccupied: utils.labelOccupied || null,
    };
  }

  draw(ctx, projected, config, isSelected) {
    if (!projected.visible) return;

    const { rx0, rx1, ryLevel, isTerminated, takenAlpha, eventTimeframe, chartTimeframe, event } = projected;
    const side      = event.properties?.liquiditySide;
    const isBuySide = side === 'buy_side' || event.direction === 'bearish' || event.concept_label?.toLowerCase() === 'bsl';

    // BSL → red, SSL → teal
    const color = isBuySide ? '#ef5350' : '#26a69a';
    // Taken levels use the user-controlled opacity; active levels stay bold
    const alpha = isSelected ? 0.95 : (isTerminated ? takenAlpha : 0.65);

    // --- Dashed horizontal line ------------------------------------------
    ctx.save();
    ctx.strokeStyle = hexToRGBA(color, alpha);
    ctx.lineWidth   = isSelected ? 2.0 : 1.0;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(rx0, ryLevel);
    ctx.lineTo(rx1, ryLevel);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // --- Terminal dot (●) at the taken candle ----------------------------
    if (isTerminated) {
      const r = isSelected ? 4.5 : 3.0;
      ctx.save();
      ctx.fillStyle   = hexToRGBA(color, isSelected ? 0.95 : 0.65);
      ctx.strokeStyle = hexToRGBA('#ffffff', 0.35);
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.arc(rx1, ryLevel, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // --- Label at right edge -------------------------------------------------
    // Only active (untouched) levels show a label; taken levels only when selected.
    if (!isTerminated || isSelected) {
      const label = isBuySide ? 'BSL' : 'SSL';

      // Label collision guard — skip if this Y row is already occupied
      const labelOccupied = projected.labelOccupied;
      const labelBucket = Math.round(ryLevel / 12);
      if (!labelOccupied || !labelOccupied.has(labelBucket)) {
        ctx.save();
        ctx.font         = isSelected ? '600 10px Outfit, sans-serif' : '9px Outfit, sans-serif';
        ctx.fillStyle    = hexToRGBA(color, isSelected ? 0.95 : 0.55);
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rx1 + 6, ryLevel);
        ctx.restore();
        if (labelOccupied) labelOccupied.add(labelBucket);
      }
    }
  }
}
