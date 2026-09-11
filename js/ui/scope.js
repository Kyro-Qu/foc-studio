/**
 * Canvas 多通道示波器 v0.2
 * 双游标、触发冻结、滚轮缩放、截图、测量、数学通道叠加
 */

import { channelLabel } from "../channels.js";
import { getLang } from "../i18n.js";

export class Scope {
  constructor(canvas, store, channels) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.store = store;
    this.channels = channels;
    this.sampleRate = 1000;
    this.windowSec = 5;
    this.paused = false;
    this.autoScale = true;
    this.yMin = -1;
    this.yMax = 1;
    this.cursor = null;
    this.cursorT1 = null;
    this.cursorT2 = null;
    this.trigger = null;
    this.math = null;
    this.onCursor = null;
    this.onWheelWindow = null;
    this._raf = 0;
    this._running = false;
    this._needsDraw = true;
    this.cssW = 0;
    this.cssH = 0;
    this._peakCache = new Map();
    this._mathBuf = new Map();
    this._destroyed = false;
    this._resizePending = 0;

    this._onPointerMove = (e) => this._onPointer(e, false);
    this._onPointerLeave = () => {
      this.cursor = null;
      if (this.onCursor) this.onCursor(null);
      this._needsDraw = true;
    };
    this._onPointerDown = (e) => this._onPointer(e, true);
    this._onWheel = (e) => this._onWheelEvent(e);
    this._onResize = () => {
      if (this._resizePending) return;
      this._resizePending = requestAnimationFrame(() => {
        this._resizePending = 0;
        if (!this._destroyed) this._resize();
      });
    };

    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(canvas.parentElement || canvas);
    this._resize();

    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("pointerleave", this._onPointerLeave);
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
  }

  destroy() {
    this._destroyed = true;
    this.stop();
    if (this._resizePending) {
      cancelAnimationFrame(this._resizePending);
      this._resizePending = 0;
    }
    this._ro.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointermove", this._onPointerMove);
    c.removeEventListener("pointerleave", this._onPointerLeave);
    c.removeEventListener("pointerdown", this._onPointerDown);
    c.removeEventListener("wheel", this._onWheel);
  }

  /** 幂等启动：重复 start 不会产生多个 RAF */
  start() {
    if (this._running || this._destroyed) return;
    this._running = true;
    const loop = () => {
      if (!this._running || this._destroyed) return;
      if (this._needsDraw || !this.paused) {
        this.draw();
        this._needsDraw = false;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  setChannels(channels) {
    this.channels = channels;
    this._needsDraw = true;
  }

  setSampleRate(hz) {
    this.sampleRate = hz;
    if (this.math) this.math.sampleRate = hz;
    this._needsDraw = true;
  }

  setWindowSec(s) {
    this.windowSec = Math.min(30, Math.max(0.1, s));
    this._needsDraw = true;
  }

  setPaused(p) {
    this.paused = p;
    this._needsDraw = true;
  }

  setAutoScale(a) {
    this.autoScale = a;
    this._needsDraw = true;
  }

  setYRange(min, max) {
    if (!(max > min)) return;
    this.yMin = min;
    this.yMax = max;
    this._needsDraw = true;
  }

  setTrigger(t) {
    this.trigger = t;
    this._needsDraw = true;
  }

  setMath(m) {
    this.math = m;
    this._needsDraw = true;
  }

  clear() {
    this.store.clear();
    this.cursorT1 = null;
    this.cursorT2 = null;
    this._needsDraw = true;
  }

  clearCursors() {
    this.cursorT1 = null;
    this.cursorT2 = null;
    this._needsDraw = true;
  }

  invalidate() {
    this._needsDraw = true;
  }

  start() {
    if (this._running || this._destroyed) return;
    this._running = true;
    const loop = () => {
      if (!this._running || this._destroyed) return;
      if (this._needsDraw || !this.paused) {
        this.draw();
        this._needsDraw = false;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, parent.clientWidth || 640);
    const h = Math.max(220, parent.clientHeight || 360);
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this._needsDraw = true;
  }

  _plotArea() {
    return {
      x: 56,
      y: 10,
      w: Math.max(50, this.cssW - 68),
      h: Math.max(40, this.cssH - 38),
    };
  }

  _windowPoints() {
    return Math.min(Math.floor(this.windowSec * this.sampleRate), this.store.length);
  }

  /** 显示用的时间范围（sampleIndex） */
  _viewRange() {
    const n = this._windowPoints();
    if (n < 1) return null;
    if (this.trigger && this.trigger.frozen) {
      const vw = this.trigger.viewWindow(n, this.store.latestIndex);
      if (vw) return vw;
    }
    const latest = this.store.latestIndex;
    return { startIdx: latest - n + 1, endIdx: latest, triggerIndex: this.trigger ? this.trigger.triggerIndex : -1 };
  }

  _sampleIndexToX(area, idx, range) {
    const span = Math.max(1, range.endIdx - range.startIdx);
    return area.x + ((idx - range.startIdx) / span) * area.w;
  }

  _xToSampleIndex(area, x, range) {
    const span = Math.max(1, range.endIdx - range.startIdx);
    return range.startIdx + ((x - area.x) / area.w) * span;
  }

  _onWheelEvent(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    this.setWindowSec(this.windowSec * factor);
    if (this.onWheelWindow) this.onWheelWindow(this.windowSec);
  }

  _onPointer(e, isDown) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.cursor = { x, y };
    if (isDown) {
      if (e.shiftKey) this.cursorT2 = x;
      else if (e.altKey) this.cursorT1 = x;
      else {
        // 普通点击：交替设置 t1/t2
        if (this.cursorT1 === null) this.cursorT1 = x;
        else if (this.cursorT2 === null) this.cursorT2 = x;
        else {
          this.cursorT1 = x;
          this.cursorT2 = null;
        }
      }
    }
    this._needsDraw = true;
    this._emitCursor();
  }

  _emitCursor() {
    if (!this.onCursor) return;
    const area = this._plotArea();
    const range = this._viewRange();
    if (!range || !this.cursor) {
      this.onCursor(null);
      return;
    }
    const idx = Math.round(this._xToSampleIndex(area, this.cursor.x, range));
    const s = this._sampleNear(idx);
    if (!s) {
      this.onCursor(null);
      return;
    }
    const samples = [];
    for (const ch of this.channels) {
      if (!ch.visible) continue;
      samples.push({
        name: channelLabel(ch.id, getLang()),
        unit: ch.unit,
        color: ch.color,
        value: s.values[ch.id],
      });
    }
    if (this.math) {
      for (const m of this.math.items) {
        if (!m.visible) continue;
        const va = s.values[m.a];
        const vb = s.values[m.b];
        let mv = NaN;
        if (m.op === "sub") mv = va - vb;
        else if (m.op === "add") mv = va + vb;
        else if (m.op === "abs") mv = Math.abs(va);
        else if (m.op === "dt") {
          const off = this.store.offsetOf(s.sampleIndex);
          const prev = off > 0 ? this.store.sampleAt(off - 1) : null;
          if (prev) mv = (va - prev.values[m.a]) * this.sampleRate;
        }
        samples.push({ name: m.name, unit: m.op === "dt" ? "1/s" : "", color: m.color, value: mv });
      }
    }

    let cursorDelta = null;
    if (this.cursorT1 !== null && this.cursorT2 !== null) {
      const i1 = Math.round(this._xToSampleIndex(area, this.cursorT1, range));
      const i2 = Math.round(this._xToSampleIndex(area, this.cursorT2, range));
      const s1 = this._sampleNear(i1);
      const s2 = this._sampleNear(i2);
      if (s1 && s2) {
        const dt = (s2.sampleIndex - s1.sampleIndex) / this.sampleRate;
        const deltas = [];
        for (const ch of this.channels) {
          if (!ch.visible) continue;
          deltas.push({
            name: channelLabel(ch.id, getLang()),
            unit: ch.unit,
            delta: s2.values[ch.id] - s1.values[ch.id],
          });
        }
        cursorDelta = { dt, deltas };
      }
    }

    this.onCursor({
      t: s.sampleIndex / this.sampleRate,
      samples,
      delta: cursorDelta,
    });
  }

  _chIdByName(name) {
    const ch = this.channels.find((c) => c.name === name);
    return ch ? ch.id : -1;
  }

  _sampleNear(sampleIndex) {
    const off = this.store.offsetOf(Math.round(sampleIndex));
    if (off < 0) return null;
    return this.store.sampleAt(off);
  }

  /** 导出 PNG */
  toPngBlob() {
    return new Promise((resolve) => {
      this.canvas.toBlob((b) => resolve(b), "image/png");
    });
  }

  _autoScale(seriesList) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of seriesList) {
      if (s.peaks) {
        for (let i = 0; i < s.peaks.n; i++) {
          if (Number.isFinite(s.peaks.minY[i]) && s.peaks.minY[i] < mn) mn = s.peaks.minY[i];
          if (Number.isFinite(s.peaks.maxY[i]) && s.peaks.maxY[i] > mx) mx = s.peaks.maxY[i];
        }
      } else if (s.y) {
        for (let i = 0; i < s.n; i++) {
          if (!Number.isFinite(s.y[i])) continue;
          if (s.y[i] < mn) mn = s.y[i];
          if (s.y[i] > mx) mx = s.y[i];
        }
      }
    }
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) {
      mn = -1;
      mx = 1;
    }
    if (mx - mn < 1e-6) mx = mn + 1;
    const pad = (mx - mn) * 0.08;
    this.yMin = mn - pad;
    this.yMax = mx + pad;
  }

  /** 冻结时按 sampleIndex 区间取序列；否则 last-n。复用缓冲降低 GC。 */
  _series(channelId) {
    const range = this._viewRange();
    const frozen = !!(this.trigger && this.trigger.frozen && range);
    const n = this._windowPoints();
    if (n < 1) return null;
    let buf = this._mathBuf.get(channelId);
    if (frozen) {
      const off0 = this.store.offsetOf(range.startIdx);
      const off1 = this.store.offsetOf(range.endIdx);
      if (off0 < 0 || off1 < 0 || off1 < off0) return null;
      const take = off1 - off0 + 1;
      if (!buf || buf.length < take) {
        buf = new Float32Array(take);
        this._mathBuf.set(channelId, buf);
      }
      const view = buf.subarray(0, take);
      const tmp = this.store._scratch || (this.store._scratch = new Float32Array(this.store.numChannels));
      for (let i = 0; i < take; i++) {
        const idx = this.store.sampleAtInto(off0 + i, tmp);
        view[i] = idx >= 0 ? tmp[channelId] : NaN;
      }
      return view;
    }
    const take = Math.min(n, this.store.length);
    if (!buf || buf.length < take) {
      buf = new Float32Array(take);
      this._mathBuf.set(channelId, buf);
    }
    const s = this.store.getSeries(channelId, take, null, buf);
    return s.n ? buf.subarray(0, s.n) : null;
  }

  draw() {
    if (!this.cssW || !this.cssH) this._resize();
    const ctx = this.ctx;
    const area = this._plotArea();

    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const vis = this.channels.filter((c) => c.visible);
    const nWant = this._windowPoints();
    const cols = Math.max(2, Math.floor(area.w));
    const seriesList = [];
    const range = this._viewRange() || {
      startIdx: this.store.latestIndex - Math.max(0, nWant - 1),
      endIdx: this.store.latestIndex,
      triggerIndex: -1,
    };
    const frozen = !!(this.trigger && this.trigger.frozen && this.trigger.triggerIndex >= 0);

    for (const ch of vis) {
      let peaks = this._peakCache.get(ch.id);
      if (!peaks) {
        peaks = {};
        this._peakCache.set(ch.id, peaks);
      }
      // 冻结：只画触发窗内数据，避免 live 轨迹继续滚动
      const p = frozen
        ? this.store.getSeriesPeaksByRange(ch.id, range.startIdx, range.endIdx, cols, peaks)
        : this.store.getSeriesPeaks(ch.id, nWant, cols, peaks);
      seriesList.push({ ch: { ...ch, color: ch.color }, peaks: p, n: nWant, y: null });
    }

    // 数学通道
    if (this.math) {
      for (const m of this.math.items) {
        if (!m.visible) continue;
        const ya = this._series(m.a);
        const yb = m.op === "sub" || m.op === "add" ? this._series(m.b) : null;
        if (!ya || ya.length < 1) continue;
        const out = this.math.compute(m, ya, yb || ya);
        const minY = new Float32Array(cols);
        const maxY = new Float32Array(cols);
        const minIdx = new Float32Array(cols);
        const maxIdx = new Float32Array(cols);
        const bucket = Math.max(1, Math.ceil(out.length / cols));
        let col = 0;
        for (let i = 0; i < out.length && col < cols; i += bucket, col++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let k = i; k < Math.min(out.length, i + bucket); k++) {
            if (out[k] < lo) lo = out[k];
            if (out[k] > hi) hi = out[k];
          }
          if (!Number.isFinite(lo)) {
            lo = 0;
            hi = 0;
          }
          minY[col] = lo;
          maxY[col] = hi;
        }
        seriesList.push({
          ch: { id: `m${m.id}`, name: m.name, color: m.color, unit: "" },
          peaks: { n: col, minY, maxY, minIdx, maxIdx },
          n: out.length,
          y: out,
        });
      }
    }

    if (this.autoScale) this._autoScale(seriesList);
    const { yMin, yMax } = this;
    const yToPx = (v) => area.y + area.h * (1 - (v - yMin) / (yMax - yMin));

    // 网格
    ctx.strokeStyle = "#21262d";
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

    ctx.fillStyle = "#8b949e";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = yMax - ((yMax - yMin) * i) / 4;
      ctx.fillText(v.toFixed(2), area.x - 8, area.y + (area.h * i) / 4);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tS = range.startIdx / this.sampleRate;
    const tE = range.endIdx / this.sampleRate;
    for (let i = 0; i <= 5; i++) {
      const t = tS + ((tE - tS) * i) / 5;
      ctx.fillText(`${t.toFixed(2)}s`, area.x + (area.w * i) / 5, area.y + area.h + 6);
    }

    // 波形
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    for (const s of seriesList) {
      const p = s.peaks;
      if (!p || p.n < 1) continue;
      ctx.strokeStyle = s.ch.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < p.n; i++) {
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        const y = yToPx(p.maxY[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = p.n - 1; i >= 0; i--) {
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        ctx.lineTo(x, yToPx(p.minY[i]));
      }
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < p.n; i++) {
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        const y = yToPx((p.maxY[i] + p.minY[i]) * 0.5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 触发电平线
    if (this.trigger && this.trigger.mode !== "off") {
      const ly = yToPx(this.trigger.level);
      if (ly >= area.y && ly <= area.y + area.h) {
        ctx.strokeStyle = "rgba(210, 153, 34, 0.85)";
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(area.x, ly);
        ctx.lineTo(area.x + area.w, ly);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 触发位置竖线
    if (this.trigger && this.trigger.frozen && range.triggerIndex >= 0) {
      const tx = this._sampleIndexToX(area, range.triggerIndex, range);
      ctx.strokeStyle = "#d29922";
      ctx.beginPath();
      ctx.moveTo(tx, area.y);
      ctx.lineTo(tx, area.y + area.h);
      ctx.stroke();
      ctx.fillStyle = "#d29922";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("T", tx, area.y + 4);
    }

    // 游标
    const drawVLine = (x, color, label) => {
      if (x === null || x < area.x || x > area.x + area.w) return;
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, x + 3, area.y + area.h - 16);
    };
    drawVLine(this.cursorT1, "#58a6ff", "t1");
    drawVLine(this.cursorT2, "#f07178", "t2");
    if (this.cursor) {
      const frac = (this.cursor.x - area.x) / area.w;
      if (frac >= 0 && frac <= 1) {
        drawVLine(this.cursor.x, "rgba(230,237,243,0.35)", "");
      }
    }

    ctx.strokeStyle = "#30363d";
    ctx.strokeRect(area.x, area.y, area.w, area.h);

    if (this.paused) {
      ctx.fillStyle = "rgba(210, 153, 34, 0.92)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("PAUSED", area.x + 10, area.y + 8);
    }
    if (this.trigger && this.trigger.frozen) {
      ctx.fillStyle = "rgba(210, 153, 34, 0.92)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("TRIG", area.x + area.w - 10, area.y + 8);
    }
  }
}
