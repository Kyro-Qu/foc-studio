/**
 * 峰包络列提取 — 可在主线程或 Worker 使用。
 * 与 TelemetryStore.getSeriesPeaks 同算法；支持一次扫多通道。
 */

/**
 * 环形缓冲描述
 * @typedef {{data:Float32Array, indices:Float64Array, numChannels:number, capacity:number, head:number, count:number, latestIndex:number}} RingDesc
 */

/**
 * 按 last-n 或 sampleIndex 区间，对 channelIds 一次扫描出 min/max 列包络。
 * @param {RingDesc} ring
 * @param {number[]} channelIds
 * @param {number} columns
 * @param {{startIdx?:number, endIdx?:number}} [range] 有则按区间（触发冻结）
 * @param {Map<number, {minY:Float32Array,maxY:Float32Array,minIdx:Float32Array,maxIdx:Float32Array,n:number,cols:number}>} [reuse]
 */
export function extractPeaksMulti(ring, channelIds, columns, range = null, reuse = null) {
  const cols = Math.max(1, columns | 0);
  const { data, indices, numChannels, capacity, head, count, latestIndex } = ring;
  const out = reuse || new Map();
  const ensure = (id) => {
    let p = out.get(id);
    if (!p || p.minY.length < cols) {
      p = {
        minY: new Float32Array(cols),
        maxY: new Float32Array(cols),
        minIdx: new Float32Array(cols),
        maxIdx: new Float32Array(cols),
        n: 0,
        cols: 0,
      };
      out.set(id, p);
    } else {
      p.n = 0;
      p.cols = 0;
    }
    return p;
  };
  const packs = channelIds.map((id) => ({ id, p: ensure(id) }));

  if (count < 1 || !packs.length) {
    for (const { p } of packs) {
      p.n = 0;
      p.cols = 0;
    }
    return out;
  }

  const oldest = latestIndex - count + 1;
  let lo = oldest;
  let hi = latestIndex;
  if (range && Number.isFinite(range.startIdx) && Number.isFinite(range.endIdx)) {
    lo = Math.max(range.startIdx, oldest);
    hi = Math.min(range.endIdx, latestIndex);
    if (hi < lo) {
      for (const { p } of packs) {
        p.n = 0;
        p.cols = 0;
      }
      return out;
    }
  }
  const take = hi - lo + 1;
  const bucket = Math.max(1, Math.ceil(take / cols));
  const startSlot = (head - count + (lo - oldest) + capacity) % capacity;

  // 列级累积
  for (let col = 0; col < cols; col++) {
    const i0 = col * bucket;
    if (i0 >= take) break;
    const end = Math.min(take, i0 + bucket);
    for (const { p } of packs) {
      p.minY[col] = Infinity;
      p.maxY[col] = -Infinity;
      p.minIdx[col] = indices[(startSlot + i0) % capacity];
      p.maxIdx[col] = p.minIdx[col];
    }
    for (let k = i0; k < end; k++) {
      const slot = (startSlot + k) % capacity;
      const base = slot * numChannels;
      const idx = indices[slot];
      for (const { id, p } of packs) {
        const v = data[base + id];
        if (!Number.isFinite(v)) continue;
        if (v < p.minY[col]) {
          p.minY[col] = v;
          p.minIdx[col] = idx;
        }
        if (v > p.maxY[col]) {
          p.maxY[col] = v;
          p.maxIdx[col] = idx;
        }
      }
    }
    for (const { p } of packs) {
      if (!Number.isFinite(p.minY[col])) {
        p.minY[col] = NaN;
        p.maxY[col] = NaN;
      }
    }
  }

  for (const { p } of packs) {
    p.n = Math.min(cols, Math.ceil(take / bucket));
    p.cols = p.n;
  }
  return out;
}
