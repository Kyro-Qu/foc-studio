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
    this.indices = new Float32Array(capacity);
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
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const slot = (start + i) % this.capacity;
    const values = new Float32Array(this.numChannels);
    const base = slot * this.numChannels;
    for (let c = 0; c < this.numChannels; c++) values[c] = this.data[base + c];
    return { values, sampleIndex: this.indices[slot] };
  }

  /**
   * @param {Array<{name:string}>} channels
   */
  toCsv(channels) {
    const header = ["time_s", ...channels.map((c) => c.name)].join(",");
    const lines = [header];
    const row = new Array(this.numChannels + 1);
    for (let i = 0; i < this.count; i++) {
      const s = this.at(i);
      if (!s) continue;
      row[0] = (s.sampleIndex / this.sampleRate).toFixed(6);
      for (let c = 0; c < this.numChannels; c++) row[c + 1] = s.values[c].toFixed(6);
      lines.push(row.join(","));
    }
    return lines.join("\n");
  }

  toJson(channels) {
    const frames = [];
    for (let i = 0; i < this.count; i++) {
      const s = this.at(i);
      if (!s) continue;
      frames.push({
        t: s.sampleIndex,
        v: Array.from(s.values, (x) => Number(x.toFixed(6))),
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
 * @param {string} text
 * @returns {{channels:string[], frames:{t:number,v:number[]}[]}}
 */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { channels: [], frames: [] };
  const header = lines[0].split(",").map((s) => s.trim());
  // time_s + ch names
  const channels = header.slice(1);
  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const t = Number(cols[0]);
    const v = cols.slice(1).map(Number);
    if (!Number.isFinite(t)) continue;
    frames.push({ t, v });
  }
  return { channels, frames };
}

/**
 * 回放器：追赶式发帧，避免 setInterval 被浏览器夹到 ~4ms 变慢动作。
 */
export class ReplaySource {
  /**
   * @param {{frames:{t:number,v:number[]}[], sampleRate?:number}} session
   * @param {(values:Float32Array, sampleIndex:number)=>void} onFrame
   */
  constructor(session, onFrame) {
    this.frames = session.frames || [];
    this.sampleRate = session.sampleRate || 1000;
    this.onFrame = onFrame;
    this.i = 0;
    this._timer = null;
    this._period = 1;
    this._nextDue = 0;
    this.loop = false;
    this._running = false;
  }

  start(rateHz = 0) {
    this.stop();
    const rate = rateHz || this.sampleRate;
    this._period = 1000 / rate;
    this._nextDue = performance.now();
    this._running = true;
    this._timer = setInterval(() => this._pump(), 2);
  }

  _pump() {
    if (!this._running) return;
    const now = performance.now();
    let n = 0;
    while (now >= this._nextDue && n < 16 && this._running) {
      if (this.i >= this.frames.length) {
        if (this.loop) this.i = 0;
        else {
          this.stop();
          return;
        }
      }
      const f = this.frames[this.i++];
      this.onFrame(Float32Array.from(f.v), f.t);
      this._nextDue += this._period;
      n += 1;
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
