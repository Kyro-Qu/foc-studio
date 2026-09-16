/**
 * Canvas 圆弧仪表盘（转速/电流/电压等）。
 * 参考 VESC Tool / 传统指针表：圆弧 + 指针 + 中心数值。
 */

export class Gauge {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {string} opts.label
   * @param {string} [opts.unit]
   * @param {number} [opts.min]
   * @param {number} [opts.max]
   * @param {string} [opts.color]
   * @param {number} [opts.digits]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.label = opts.label || "";
    this.unit = opts.unit || "";
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 100;
    this.color = opts.color || "#58a6ff";
    this.digits = opts.digits ?? 1;
    this.value = NaN;
    this._ro = null;
    this._resize();
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        this._resize();
        this.draw();
      });
      this._ro.observe(canvas.parentElement || canvas);
    }
  }

  destroy() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    this._destroyed = true;
  }

  setRange(min, max) {
    if (max > min) {
      this.min = min;
      this.max = max;
    }
  }

  setValue(v) {
    if (this._destroyed) return;
    this.value = Number.isFinite(v) ? v : NaN;
    this.draw();
  }

  _resize() {
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    // 固定 160px 正方形，三表盘圆心/半径完全一致
    const size = 160;
    if (this.canvas) {
      this.canvas.width = Math.floor(size * dpr);
      this.canvas.height = Math.floor(size * dpr);
      if (this.canvas.style) {
        this.canvas.style.width = `${size}px`;
        this.canvas.style.height = `${size}px`;
      }
      if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.cssW = size;
    this.cssH = size;
  }

  draw() {
    if (this._destroyed || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.cssW || 160;
    const h = this.cssH || 160;
    const cx = w / 2;
    const cy = h * 0.52;
    const r = Math.min(w, h) * 0.38;

    ctx.clearRect(0, 0, w, h);

    // 背景弧 240°（-210° → 30°）
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a3448";
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();

    let frac = 0;
    if (Number.isFinite(this.value)) {
      frac = (this.value - this.min) / (this.max - this.min);
      frac = Math.max(0, Math.min(1, frac));
    }

    if (frac > 0) {
      const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      grad.addColorStop(0, this.color);
      grad.addColorStop(1, "#7fd962");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
      ctx.stroke();
    }

    // 刻度
    ctx.fillStyle = "#9aa8bd";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks;
      const a = a0 + (a1 - a0) * f;
      const tx = cx + Math.cos(a) * (r - 16);
      const ty = cy + Math.sin(a) * (r - 16);
      const val = this.min + (this.max - this.min) * f;
      ctx.fillText(this._fmtTick(val), tx, ty);
    }

    // 指针
    if (Number.isFinite(this.value)) {
      const a = a0 + (a1 - a0) * frac;
      ctx.strokeStyle = "#e6edf3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      ctx.fillStyle = "#e6edf3";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 中心读数
    ctx.fillStyle = Number.isFinite(this.value) ? "#eef2f8" : "#9aa8bd";
    ctx.font = "600 18px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = Number.isFinite(this.value) ? this.value.toFixed(this.digits) : "—";
    ctx.fillText(text, cx, cy + r * 0.35);

    ctx.fillStyle = "#9aa8bd";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(this.unit ? `${this.label} · ${this.unit}` : this.label, cx, cy + r * 0.35 + 20);
  }

  _fmtTick(v) {
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(0);
    return v.toFixed(1);
  }
}
