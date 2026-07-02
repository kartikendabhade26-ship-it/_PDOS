// SwingPrimitive.js
// Custom series primitive representing visual overlay swings (wick arrows and labels)

export class SwingPrimitive {
  constructor(time, price, label, options = {}) {
    this._time = time;
    this._price = price;
    this._label = label;
    this._options = {
      color: '#26a69a',
      isHigh: true,
      ...options
    };
    this._attached = null;
    this._paneView = {
      renderer: () => this._renderer(),
    };
  }

  attached(param) {
    this._attached = param;
  }

  detached() {
    this._attached = null;
  }

  paneViews() {
    return [this._paneView];
  }

  update(newData) {
    this._time = newData.time ?? this._time;
    this._price = newData.price ?? this._price;
    this._label = newData.label ?? this._label;
    if (newData.options) {
      this._options = { ...this._options, ...newData.options };
    }
    if (this._attached) {
      this._attached.requestUpdate();
    }
  }

  _renderer() {
    if (!this._attached) return null;
    const { chart, series } = this._attached;
    const ts = chart.timeScale();

    const x = ts.timeToCoordinate(this._time);
    const y = series.priceToCoordinate(this._price);

    if (x === null || y === null) return null;

    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          const h = scope.horizontalPixelRatio;
          const v = scope.verticalPixelRatio;

          ctx.save();
          ctx.fillStyle = this._options.color;

          // Draw wick triangle
          ctx.beginPath();
          if (this._options.isHigh) {
            ctx.moveTo(x * h, (y - 12) * v);
            ctx.lineTo((x - 5) * h, (y - 20) * v);
            ctx.lineTo((x + 5) * h, (y - 20) * v);
          } else {
            ctx.moveTo(x * h, (y + 12) * v);
            ctx.lineTo((x - 5) * h, (y + 20) * v);
            ctx.lineTo((x + 5) * h, (y + 20) * v);
          }
          ctx.fill();

          // Draw label text
          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.round(9 * h)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const textY = this._options.isHigh ? (y - 25) : (y + 25);
          ctx.fillText(this._label, x * h, textY * v);

          ctx.restore();
        });
      }
    };
  }
}
