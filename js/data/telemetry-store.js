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
    // Float64 保证 sampleIndex 在长时间运行后仍精确（>2^24）
    this.indices = new Float64Array(capacity);
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
    const len = Math.min(numChannels, values.length);
    for (let c = 0; c < len; c++) {
      data[base + c] = values[c];
      this.latest[c] = values[c];
    }
    for (let c = len; c < numChannels; c++) {
      data[base + c] = NaN;
      this.latest[c] = NaN;
    }
    indices[this.head] = sampleIndex;
    this.latestIndex = sampleIndex;
    this.head = (this.head + 1) % capacity;
    if (this.count < capacity) this.count += 1;
    this.framesTotal += 1;
  }

  /**
   * 按 32-bit 自解释掩码推入稀疏数据（未订阅通道写 NaN 防假零）
   * @param {number} mask
   * @param {Float32Array|number[]} values
   * @param {number} sampleIndex
   */
  pushSparse(mask, values, sampleIndex) {
    const { numChannels, capacity, data, indices } = this;
    const base = this.head * numChannels;
    let valIdx = 0;
    for (let c = 0; c < numChannels; c++) {
      if ((mask & (1 << c)) !== 0 && valIdx < values.length) {
        const v = values[valIdx++];
        data[base + c] = v;
        this.latest[c] = v;
      } else {
        data[base + c] = NaN;
        // 未订阅的通道在 latest 中保持 NaN
        this.latest[c] = NaN;
      }
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
        lo = NaN;
        hi = NaN;
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

  /**
   * 按 sampleIndex 区间取保峰（触发冻结窗用；与 last-n 绘制对齐）。
   * 区间与环形缓冲求交，超出部分忽略。
   * @returns {{n:number,minY:Float32Array,maxY:Float32Array,minIdx:Float32Array,maxIdx:Float32Array,range:{startIdx:number,endIdx:number}}}
   */
  getSeriesPeaksByRange(channel, startIdx, endIdx, columns, out = null) {
    const cols = Math.max(1, columns | 0);
    const minY = out?.minY && out.minY.length >= cols ? out.minY : new Float32Array(cols);
    const maxY = out?.maxY && out.maxY.length >= cols ? out.maxY : new Float32Array(cols);
    const minIdx = out?.minIdx && out.minIdx.length >= cols ? out.minIdx : new Float32Array(cols);
    const maxIdx = out?.maxIdx && out.maxIdx.length >= cols ? out.maxIdx : new Float32Array(cols);
    const empty = { n: 0, minY, maxY, minIdx, maxIdx, cols: 0, range: { startIdx, endIdx } };
    if (this.count < 1) return empty;

    const oldest = this.latestIndex - this.count + 1;
    const lo = Math.max(startIdx, oldest);
    const hi = Math.min(endIdx, this.latestIndex);
    if (hi < lo) return empty;

    const take = hi - lo + 1;
    const bucket = Math.max(1, Math.ceil(take / cols));
    const { numChannels, capacity, data, indices } = this;
    // lo 对应的窗口内偏移
    const baseOffset = lo - oldest;
    const startSlot = (this.head - this.count + baseOffset + capacity) % capacity;

    let col = 0;
    let i = 0;
    while (i < take && col < cols) {
      const end = Math.min(take, i + bucket);
      let loV = Infinity;
      let hiV = -Infinity;
      let loI = 0;
      let hiI = 0;
      for (let k = i; k < end; k++) {
        const slot = (startSlot + k) % capacity;
        const v = data[slot * numChannels + channel];
        if (!Number.isFinite(v)) continue;
        if (v < loV) {
          loV = v;
          loI = indices[slot];
        }
        if (v > hiV) {
          hiV = v;
          hiI = indices[slot];
        }
      }
      if (!Number.isFinite(loV)) {
        loV = NaN;
        hiV = NaN;
        loI = indices[(startSlot + i) % capacity];
        hiI = loI;
      }
      minY[col] = loV;
      maxY[col] = hiV;
      minIdx[col] = loI;
      maxIdx[col] = hiI;
      col += 1;
      i = end;
    }
    return { n: col, minY, maxY, minIdx, maxIdx, cols: col, range: { startIdx: lo, endIdx: hi } };
  }

  /**
   * sampleIndex → 环形缓冲内偏移。
   *
   * **约束**：假定 push 的 sampleIndex 连续递增（JustFloat/Sim 语义）。
   * 非连续 index 时 offsetOf 可能返回 -1；不要依赖它做乱序索引。
   */
  offsetOf(sampleIndex) {
    if (this.count < 1) return -1;
    const oldest = this.latestIndex - this.count + 1;
    if (sampleIndex < oldest || sampleIndex > this.latestIndex) return -1;
    return sampleIndex - oldest;
  }

  /** @returns {{values:Float32Array, sampleIndex:number}|null} */
  sampleAt(i) {
    if (i < 0 || i >= this.count) return null;
    const out = new Float32Array(this.numChannels);
    const sampleIndex = this.sampleAtInto(i, out);
    return { values: out, sampleIndex };
  }

  /**
   * 低分配读取：结果写入 out
   * @returns {number} sampleIndex；无效返回 -1
   */
  sampleAtInto(i, out) {
    if (i < 0 || i >= this.count || !out || out.length < this.numChannels) return -1;
    const startSlot = (this.head - this.count + this.capacity) % this.capacity;
    const slot = (startSlot + i) % this.capacity;
    const base = slot * this.numChannels;
    for (let c = 0; c < this.numChannels; c++) out[c] = this.data[base + c];
    return this.indices[slot];
  }

  get length() {
    return this.count;
  }
}
