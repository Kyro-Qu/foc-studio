/**
 * Canvas2D 波形后端 — 与现网观感一致的峰包络 + 中心线。
 */

const BG = "#151a26";
const GRID = "#243044";
const LABEL = "#9aa8bd";

export class Canvas2DScopeRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.kind = "canvas2d";
    this.dprCap = 2;
  }

  setDprCap(v) {
    this.dprCap = v;
  }

  getDprCap() {
    return this.dprCap;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const pw = Math.max(1, Math.floor(cssW * dpr));
    const ph = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this._dpr = dpr;
  }

  clear(cssW, cssH) {
    const ctx = this.ctx;
    ctx.setTransform(this._dpr || 1, 0, 0, this._dpr || 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  /**
   * @param {{x:number,y:number,w:number,h:number}} area
   * @param {{yMin:number,yMax:number,tS:number,tE:number}} meta
   */
  drawChrome(area, meta) {
    const ctx = this.ctx;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const y = area.y + (area.h * i) / 8;
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
    }
    for (let i = 0; i <= 10; i++) {
      const x = area.x + (area.w * i) / 10;
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
    }
    ctx.stroke();

    ctx.fillStyle = LABEL;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = meta.yMax - ((meta.yMax - meta.yMin) * i) / 4;
      ctx.fillText(v.toFixed(2), area.x - 8, area.y + (area.h * i) / 4);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 5; i++) {
      const t = meta.tS + ((meta.tE - meta.tS) * i) / 5;
      ctx.fillText(`${t.toFixed(2)}s`, area.x + (area.w * i) / 5, area.y + area.h + 6);
    }
  }

  /**
   * @param {{x:number,y:number,w:number,h:number}} area
   * @param {{yMin:number,yMax:number}} meta
   * @param {Array<{color:string,peaks:{n:number,minY:Float32Array,maxY:Float32Array}}>} seriesList
   */
  drawSeries(area, meta, seriesList) {
    const ctx = this.ctx;
    const { yMin, yMax } = meta;
    const yToPx = (v) => area.y + area.h * (1 - (v - yMin) / (yMax - yMin));
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    for (const s of seriesList) {
      const p = s.peaks;
      if (!p || p.n < 1) continue;
      let hasValid = false;
      for (let i = 0; i < p.n; i++) {
        if (Number.isFinite(p.maxY[i])) {
          hasValid = true;
          break;
        }
      }
      if (!hasValid) continue;

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      let envActive = false;
      for (let i = 0; i < p.n; i++) {
        if (!Number.isFinite(p.maxY[i])) {
          envActive = false;
          continue;
        }
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        const y = yToPx(p.maxY[i]);
        if (!envActive) {
          ctx.moveTo(x, y);
          envActive = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      for (let i = p.n - 1; i >= 0; i--) {
        if (!Number.isFinite(p.minY[i])) continue;
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        ctx.lineTo(x, yToPx(p.minY[i]));
      }
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.beginPath();
      let active = false;
      for (let i = 0; i < p.n; i++) {
        const val = (p.maxY[i] + p.minY[i]) * 0.5;
        if (!Number.isFinite(val)) {
          active = false;
          continue;
        }
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        const y = yToPx(val);
        if (!active) {
          ctx.moveTo(x, y);
          active = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
