/**
 * 统一遥测环形缓冲：Scope 与 Dashboard 共用同一帧。
 * 时间轴用 sampleIndex / sampleRate。
 */

export class TelemetryStore {
  /**
   * @param {number} numChannels
   * @param {number} capacity 最大样本数
   */
  constructor(numChannels, capacity = 30000) {
    this.numChannels = numChannels;
    this.capacity = capacity;
    this.data = new Float32Array(numChannels * capacity);
    this.indices = new Float32Array(capacity);
    this.head = 0;
    this.count = 0;
    this.latest = new Float32Array(numChannels);
    this.latestIndex = 0;
    this.framesTotal = 0;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.framesTotal = 0;
    this.latest.fill(NaN);
    this.latestIndex = 0;
  }

  /** @param {Float32Array} values @param {number} sampleIndex */
  push(values, sampleIndex) {
    const { numChannels, capacity, data, indices } = this;
    const base = this.head * numChannels;
    for (let c = 0; c < numChannels; c++) {
      data[base + c] = values[c];
      this.latest[c] = values[c];
    }
    indices[this.head] = sampleIndex;
    this.latestIndex = sampleIndex;
    this.head = (this.head + 1) % capacity;
    if (this.count < capacity) this.count += 1;
    this.framesTotal += 1;
  }

  /**
   * 取最近 n 个样本的某一通道，按时间正序。
   * 结果写入可选 out 缓冲，避免每帧分配。
   * @returns {{t: Float32Array, y: Float32Array, n: number}}
   */
  getSeries(channel, n, outT = null, outY = null) {
    const take = Math.min(n, this.count);
    const t = outT && outT.length >= take ? outT : new Float32Array(Math.max(take, 1));
    const y = outY && outY.length >= take ? outY : new Float32Array(Math.max(take, 1));
    if (take === 0) return { t, y, n: 0 };

    const { numChannels, capacity, data, indices } = this;
    const startSlot = (this.head - take + capacity) % capacity;
    for (let i = 0; i < take; i++) {
      const slot = (startSlot + i) % capacity;
      t[i] = indices[slot];
      y[i] = data[slot * numChannels + channel];
    }
    return { t, y, n: take };
  }

  /**
   * 将最近 n 点按像素列做 min/max 下采样（保峰，适合示波器）。
   * @returns {{n:number, minY:Float32Array, maxY:Float32Array, minIdx:Float32Array, maxIdx:Float32Array}}
   */
  getSeriesPeaks(channel, n, columns, out = null) {
    const take = Math.min(n, this.count);
    const cols = Math.max(1, columns | 0);
    const minY = out?.minY && out.minY.length >= cols ? out.minY : new Float32Array(cols);
    const maxY = out?.maxY && out.maxY.length >= cols ? out.maxY : new Float32Array(cols);
    const minIdx = out?.minIdx && out.minIdx.length >= cols ? out.minIdx : new Float32Array(cols);
    const maxIdx = out?.maxIdx && out.maxIdx.length >= cols ? out.maxIdx : new Float32Array(cols);
    if (take === 0) return { n: 0, minY, maxY, minIdx, maxIdx, cols: 0 };

    const { numChannels, capacity, data, indices } = this;
    const startSlot = (this.head - take + capacity) % capacity;
    const bucket = Math.max(1, Math.ceil(take / cols));

    let col = 0;
    let i = 0;
    while (i < take && col < cols) {
      const end = Math.min(take, i + bucket);
      let lo = Infinity;
      let hi = -Infinity;
      let loIdx = 0;
      let hiIdx = 0;
      for (let k = i; k < end; k++) {
        const slot = (startSlot + k) % capacity;
        const v = data[slot * numChannels + channel];
        if (!Number.isFinite(v)) continue;
        if (v < lo) {
          lo = v;
          loIdx = indices[slot];
        }
        if (v > hi) {
          hi = v;
          hiIdx = indices[slot];
        }
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 0;
        loIdx = indices[(startSlot + i) % capacity];
        hiIdx = loIdx;
      }
      minY[col] = lo;
      maxY[col] = hi;
      minIdx[col] = loIdx;
      maxIdx[col] = hiIdx;
      col += 1;
      i = end;
    }
    return { n: col, minY, maxY, minIdx, maxIdx, cols: col };
  }

  /** @returns {{values:Float32Array, sampleIndex:number}|null} */
  sampleAt(i) {
    const take = this.count;
    if (i < 0 || i >= take) return null;
    const startSlot = (this.head - take + this.capacity) % this.capacity;
    const slot = (startSlot + i) % this.capacity;
    const out = new Float32Array(this.numChannels);
    const base = slot * this.numChannels;
    for (let c = 0; c < this.numChannels; c++) out[c] = this.data[base + c];
    return { values: out, sampleIndex: this.indices[slot] };
  }

  get length() {
    return this.count;
  }
}
