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
    /** 相对最新样本的时间偏移（0=贴最新；负值=回看历史） */
    this.viewOffset = 0;
    this.cursor = null;
    this.trigger = null;
    this.math = null;
    this.onCursor = null;
    this.onWheelWindow = null;
    /** Y 范围被手动缩放/平移时回调，用于关掉自动 Y 并同步输入框 */
    this.onYRange = null;
    /** 自动 Y 被手动关闭时回调 */
    this.onAutoScale = null;
    this._raf = 0;
    this._running = false;
    this._needsDraw = true;
    this.cssW = 0;
    this.cssH = 0;
    this._peakCache = new Map();
    this._mathBuf = new Map();
    this._destroyed = false;
    this._resizePending = 0;
    this._drag = null;

    this._onPointerMove = (e) => this._onPointer(e, false);
    this._onPointerLeave = () => {
      if (!this._drag) {
        this.cursor = null;
        if (this.onCursor) this.onCursor(null);
        this._needsDraw = true;
      }
    };
    this._onPointerDown = (e) => this._onPointer(e, true);
    this._onPointerUp = () => this._endDrag();
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
    canvas.addEventListener("pointerup", this._onPointerUp);
    canvas.addEventListener("pointercancel", this._onPointerUp);
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
    c.removeEventListener("pointerup", this._onPointerUp);
    c.removeEventListener("pointercancel", this._onPointerUp);
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
    this.cursor = null;
    if (this.onCursor) this.onCursor(null);
    this._needsDraw = true;
  }

  clearCursors() {
    this.cursor = null;
    if (this.onCursor) this.onCursor(null);
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
    const latest = this.store.latestIndex + this.viewOffset;
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

  /** Y 缩放：以锚点值为中心缩放；自动关掉自动 Y */
  _zoomY(factor, anchorClientY) {
    const area = this._plotArea();
    let anchor = (this.yMin + this.yMax) / 2;
    if (Number.isFinite(anchorClientY)) {
      const rect = this.canvas.getBoundingClientRect();
      const py = anchorClientY - rect.top;
      const t = 1 - (py - area.y) / Math.max(1, area.h);
      anchor = this.yMin + (this.yMax - this.yMin) * Math.max(0, Math.min(1, t));
    }
    const half = ((this.yMax - this.yMin) / 2) * factor;
    if (!(half > 1e-12) || !Number.isFinite(half)) return;
    this.yMin = anchor - (anchor - this.yMin) * factor;
    this.yMax = anchor + (this.yMax - anchor) * factor;
    if (this.autoScale) {
      this.autoScale = false;
      if (this.onAutoScale) this.onAutoScale(false);
    }
    this._needsDraw = true;
    if (this.onYRange) this.onYRange(this.yMin, this.yMax);
  }

  /** Y 平移：dy 像素（向下为正 → 波形上移，范围上移） */
  _panY(dyPx) {
    const area = this._plotArea();
    if (!area.h) return;
    const span = this.yMax - this.yMin;
    if (!(span > 0)) return;
    const dv = (dyPx / area.h) * span;
    this.yMin += dv;
    this.yMax += dv;
    if (this.autoScale) {
      this.autoScale = false;
      if (this.onAutoScale) this.onAutoScale(false);
    }
    this._needsDraw = true;
    if (this.onYRange) this.onYRange(this.yMin, this.yMax);
  }

  /** X 平移：dx 像素（向右为正 → 看更旧数据，offset 更负） */
  _panX(dxPx) {
    const area = this._plotArea();
    const n = this._windowPoints();
    if (!area.w || n < 1) return;
    const dSamples = Math.round((dxPx / area.w) * n);
    if (!dSamples) return;
    const minOff = Math.min(0, this.store.length - n - this.store.latestIndex);
    // 允许贴到最新（0）或回看历史
    this.viewOffset = Math.min(0, Math.max(minOff, this.viewOffset - dSamples));
    if (this.onWheelWindow) this.onWheelWindow(this.windowSec, this.viewOffset);
    this._needsDraw = true;
  }

  _endDrag() {
    this._drag = null;
  }

  _onWheelEvent(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    // Ctrl+滚轮：Y 缩放（围绕光标）
    if (e.ctrlKey || e.metaKey) {
      this._zoomY(factor, e.clientY);
      return;
    }
    // Shift+滚轮：X 平移
    if (e.shiftKey) {
      const area = this._plotArea();
      const n = this._windowPoints();
      if (!area.w || n < 1) return;
      const dx = (e.deltaY > 0 ? 1 : -1) * area.w * 0.08;
      this._panX(dx);
      return;
    }
    // 普通滚轮：X 缩放（以视图中心为锚，避免跳到最新）
    const range = this._viewRange();
    const n = this._windowPoints();
    const center = range ? (range.startIdx + range.endIdx) / 2 : this.store.latestIndex;
    this.setWindowSec(this.windowSec * factor);
    const n2 = this._windowPoints();
    if (n2 > 0 && n > 0) {
      // 保持中心样本位置
      this.viewOffset = Math.round(center - this.store.latestIndex - (n2 - 1) / 2);
      const minOff = Math.min(0, this.store.length - n2 - this.store.latestIndex);
      this.viewOffset = Math.min(0, Math.max(minOff, this.viewOffset));
    }
    if (this.onWheelWindow) this.onWheelWindow(this.windowSec, this.viewOffset);
  }

  _onPointer(e, isDown) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.cursor = { x, y };

    if (isDown) {
      this._drag = {
        x: e.clientX,
        y: e.clientY,
        moved: false,
        button: e.button,
      };
      this.canvas.setPointerCapture?.(e.pointerId);
      this._needsDraw = true;
      this._emitCursor();
      return;
    }

    // 拖拽平移（左键且已移动超过阈值）
    if (this._drag && (e.buttons & 1) !== 0) {
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      if (!this._drag.moved && Math.hypot(dx, dy) < 4) return;
      this._drag.moved = true;
      this._panX(dx);
      this._panY(dy);
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
      this._needsDraw = true;
      this._emitCursor();
      return;
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

    this.onCursor({
      t: s.sampleIndex / this.sampleRate,
      samples,
    });
  }

  /**
   * 刷新示波器常驻 Mini HUD
   * @param {{vbus:number, faultCode?:number, state:number, mode?:number}} status 10B 精简心跳（不含 mode/rpm/iq）
   * @param {string} [uiMode] 本地跟踪的控制模式 id（vf|iq|vel|pos），STATUS 不带 mode 时使用
   */
  updateMiniHud(status, uiMode) {
    if (!status) return;
    const vbusEl = document.getElementById("hud-vbus");
    const rpmEl = document.getElementById("hud-rpm");
    const iqEl = document.getElementById("hud-iq");
    const stateEl = document.getElementById("hud-state");
    const modeEl = document.getElementById("hud-mode");
    const faultEl = document.getElementById("hud-fault");

    // 转速/电流只来自 500Hz 波形（ch2/ch5）；旧 15B 心跳的 rpmEst/iqEst 仅作兼容回退
    const latest = this.store.latest;
    const vbus = Number.isFinite(status.vbus) ? status.vbus : latest[26];
    const rpm = Number.isFinite(latest[2]) ? latest[2] : status.rpmEst;
    const iq = Number.isFinite(latest[5]) ? latest[5] : status.iqEst;

    if (vbusEl && Number.isFinite(vbus)) {
      vbusEl.textContent = `${vbus.toFixed(2)} V`;
      vbusEl.className = "";
      if (vbus < 10.0 || vbus > 28.0) {
        vbusEl.classList.add("hud-vbus-bad");
      } else if (vbus < 11.5) {
        vbusEl.classList.add("hud-vbus-warn");
      } else {
        vbusEl.classList.add("hud-vbus-ok");
      }
    }

    if (rpmEl) {
      rpmEl.textContent = Number.isFinite(rpm) ? `${Math.round(rpm)} RPM` : "— RPM";
    }

    if (iqEl) {
      iqEl.textContent = Number.isFinite(iq) ? `${iq.toFixed(2)} A` : "— A";
    }

    if (stateEl) {
      const STATE_NAMES = ["IDLE", "RUN", "CALIB", "FAULT"];
      const sName = STATE_NAMES[status.state] || "UNKNOWN";
      stateEl.textContent = sName;
      stateEl.className = `state-pill state-${sName.toLowerCase()}`;
    }

    if (modeEl) {
      const MODE_NAMES = ["VF", "CURRENT", "VELOCITY", "POSITION"];
      const MODE_IDS = ["vf", "iq", "vel", "pos"];
      const idx = Number.isFinite(status.mode) ? status.mode : MODE_IDS.indexOf(uiMode);
      modeEl.textContent = MODE_NAMES[idx] || "—";
    }

    if (faultEl) {
      const fCode = status.faultCode !== undefined ? status.faultCode : (status.motorFault || status.shuntFault);
      const hasFault = fCode !== 0;
      if (hasFault) {
        faultEl.textContent = `FAULT ${fCode}`;
        faultEl.className = "hud-fault-bad";
      } else {
        faultEl.textContent = "OK";
        faultEl.className = "hud-fault-ok";
      }
    }
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

    ctx.fillStyle = "#151a26";
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
    ctx.strokeStyle = "#243044";
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

    ctx.fillStyle = "#9aa8bd";
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

      let hasValid = false;
      for (let i = 0; i < p.n; i++) {
        if (Number.isFinite(p.maxY[i])) {
          hasValid = true;
          break;
        }
      }
      if (!hasValid) continue;

      ctx.strokeStyle = s.ch.color;
      ctx.lineWidth = 1.2;

      // 半透明包络线（跳过 NaN 缺口）
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
        if (!Number.isFinite(p.minY[i])) {
          continue;
        }
        const x = area.x + (area.w * i) / Math.max(1, p.n - 1);
        ctx.lineTo(x, yToPx(p.minY[i]));
      }
      ctx.stroke();

      // 中心折线（遇到 NaN 断线跳过）
      ctx.globalAlpha = 1.0;
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
    // 单游标：跟随鼠标 X，读数栏显示各通道 Y
    if (this.cursor) {
      const frac = (this.cursor.x - area.x) / area.w;
      if (frac >= 0 && frac <= 1) {
        drawVLine(this.cursor.x, "rgba(230,237,243,0.55)", "");
        // 游标点上打点，便于对准波形
        for (const ch of this.channels) {
          if (!ch.visible) continue;
          const s = this._sampleNear(Math.round(this._xToSampleIndex(area, this.cursor.x, range)));
          if (!s) continue;
          const v = s.values[ch.id];
          if (!Number.isFinite(v)) continue;
          const y = yToPx(v);
          if (y < area.y || y > area.y + area.h) continue;
          ctx.fillStyle = ch.color;
          ctx.beginPath();
          ctx.arc(this.cursor.x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.strokeStyle = "#2f384c";
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
