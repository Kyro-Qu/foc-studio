/**
 * 会话录制 / CSV 回放（不改固件）。
 * CSV 格式与 v0.1 导出一致：time_s,ch0..ch15
 */

export class SessionRecorder {
  /**
   * @param {number} numChannels
   * @param {number} capacity
   */
  constructor(numChannels = 16, capacity = 60000) {
    this.numChannels = numChannels;
    this.capacity = capacity;
    this.data = new Float32Array(numChannels * capacity);
    // Float64：长时间录制 sampleIndex 仍精确
    this.indices = new Float64Array(capacity);
    this.marks = [];
    this.head = 0;
    this.count = 0;
    this.recording = false;
    this.sampleRate = 1000;
  }

  start() {
    this.head = 0;
    this.count = 0;
    this.marks = [];
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  toggle() {
    if (this.recording) this.stop();
    else this.start();
    return this.recording;
  }

  /** @param {Float32Array} values @param {number} sampleIndex */
  push(values, sampleIndex) {
    if (!this.recording) return;
    const { numChannels, capacity, data, indices } = this;
    const base = this.head * numChannels;
    for (let c = 0; c < numChannels; c++) data[base + c] = values[c];
    indices[this.head] = sampleIndex;
    this.head = (this.head + 1) % capacity;
    if (this.count < capacity) this.count += 1;
  }

  mark(text) {
    if (!this.recording || this.count === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    const m = { sampleIndex: this.indices[idx], text: text || `mark${this.marks.length + 1}` };
    this.marks.push(m);
    return m;
  }

  /** @returns {{values:Float32Array, sampleIndex:number}|null} */
  at(i) {
    if (i < 0 || i >= this.count) return null;
    const values = new Float32Array(this.numChannels);
    const sampleIndex = this.atInto(i, values);
    if (sampleIndex < 0 && this.count > 0) {
      /* keep */
    }
    return { values, sampleIndex };
  }

  /**
   * 低分配读取
   * @returns {number} sampleIndex or -1
   */
  atInto(i, out) {
    if (i < 0 || i >= this.count || !out || out.length < this.numChannels) return -1;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const slot = (start + i) % this.capacity;
    const base = slot * this.numChannels;
    for (let c = 0; c < this.numChannels; c++) out[c] = this.data[base + c];
    return this.indices[slot];
  }

  /**
   * @param {Array<{name:string}>} channels
   */
  toCsv(channels) {
    const header = ["time_s", ...channels.map((c) => c.name)].join(",");
    const lines = [header];
    const row = new Array(this.numChannels + 1);
    const buf = new Float32Array(this.numChannels);
    for (let i = 0; i < this.count; i++) {
      const idx = this.atInto(i, buf);
      if (idx < 0 && this.count === 0) continue;
      row[0] = (idx / this.sampleRate).toFixed(6);
      for (let c = 0; c < this.numChannels; c++) row[c + 1] = buf[c].toFixed(6);
      lines.push(row.join(","));
    }
    return lines.join("\n");
  }

  toJson(channels) {
    const frames = [];
    const buf = new Float32Array(this.numChannels);
    for (let i = 0; i < this.count; i++) {
      const t = this.atInto(i, buf);
      frames.push({
        t,
        v: Array.from(buf, (x) => Number(x.toFixed(6))),
      });
    }
    return JSON.stringify(
      {
        version: 1,
        sampleRate: this.sampleRate,
        channels: channels.map((c) => ({ id: c.id, name: c.name, unit: c.unit })),
        marks: this.marks,
        frames,
      },
      null,
      0
    );
  }
}

/**
 * 解析 v0.1/v0.2 CSV
 * 严格校验时间戳单调性，过滤重复与异常帧，并自动推导采样率。
 * @param {string} text
 * @returns {{channels:string[], frames:{t:number,v:number[],timeMs:number}[], sampleRate:number}}
 */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { channels: [], frames: [], sampleRate: 1000 };
  const header = lines[0].split(",").map((s) => s.trim());
  // time_s + ch names
  const channels = header.slice(1);
  const rawFrames = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const t = Number(cols[0]);
    const v = cols.slice(1).map(Number);
    if (!Number.isFinite(t)) continue;
    rawFrames.push({ t, v });
  }

  // 校验时间戳单调性，过滤重复与倒流
  const frames = [];
  const dts = [];
  let lastT = -Infinity;
  const t0 = rawFrames.length ? rawFrames[0].t : 0;
  for (let i = 0; i < rawFrames.length; i++) {
    const f = rawFrames[i];
    if (f.t > lastT) {
      if (lastT !== -Infinity) {
        const dt = f.t - lastT;
        if (dt > 1e-7) dts.push(dt);
      }
      frames.push({
        t: f.t,
        v: f.v,
        timeMs: (f.t - t0) * 1000,
      });
      lastT = f.t;
    }
  }

  let sampleRate = 1000;
  if (dts.length > 0) {
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    if (medianDt > 1e-7) {
      const estHz = Math.round(1 / medianDt);
      if (estHz >= 1 && estHz <= 100000) {
        sampleRate = estHz;
      }
    }
  }

  return { channels, frames, sampleRate };
}

/**
 * 回放器：追赶式发帧，按 CSV 真实时间戳或固定采样周期调度。
 */
export class ReplaySource {
  /**
   * @param {{frames:{t:number,v:number[],timeMs?:number}[], sampleRate?:number}} session
   * @param {(values:Float32Array, sampleIndex:number)=>void} onFrame
   */
  constructor(session, onFrame) {
    this.frames = session.frames || [];
    this.sampleRate = session.sampleRate || 1000;
    this.onFrame = onFrame;
    this.i = 0;
    this._timer = null;
    this._period = 1000 / this.sampleRate;
    this._nextDue = 0;
    this._startTime = 0;
    this.loop = false;
    this._running = false;
  }

  start(rateHz = 0) {
    this.stop();
    const rate = rateHz || this.sampleRate;
    this.sampleRate = rate;
    this._period = 1000 / rate;
    this.i = 0;
    this._startTime = performance.now();
    this._nextDue = this._startTime;
    this._running = true;
    this._timer = setInterval(() => this._pump(), 2);
  }

  _pump() {
    if (!this._running) return;
    const now = performance.now();
    let n = 0;
    while (now >= this._nextDue && n < 16 && this._running) {
      if (this.i >= this.frames.length) {
        if (this.loop) {
          this.i = 0;
          this._startTime = now;
          this._nextDue = now;
        } else {
          this.stop();
          return;
        }
      }
      const f = this.frames[this.i];
      this.onFrame(Float32Array.from(f.v), f.t);
      this.i += 1;
      n += 1;

      if (this.i < this.frames.length) {
        const nextF = this.frames[this.i];
        if (typeof nextF.timeMs === "number") {
          if (this._startTime === 0 && this._nextDue > 0) {
            this._startTime = this._nextDue;
          }
          this._nextDue = this._startTime + nextF.timeMs;
        } else {
          this._nextDue += this._period;
        }
      } else {
        this._nextDue += this._period;
      }
    }
    if (this._nextDue < now - 50) this._nextDue = now;
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  get done() {
    return this.i >= this.frames.length;
  }
}
