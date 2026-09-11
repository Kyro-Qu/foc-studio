/**
 * 窗口测量统计：min / max / mean / rms / p2p / last
 */

/**
 * @param {ArrayLike<number>} y
 * @returns {{n:number,min:number,max:number,mean:number,rms:number,p2p:number,last:number}}
 */
export function measureSeries(y) {
  const n = y?.length ?? 0;
  if (!n) {
    return { n: 0, min: NaN, max: NaN, mean: NaN, rms: NaN, p2p: NaN, last: NaN };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSq = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
    cnt += 1;
  }
  if (cnt === 0) {
    return { n: 0, min: NaN, max: NaN, mean: NaN, rms: NaN, p2p: NaN, last: NaN };
  }
  const mean = sum / cnt;
  const rms = Math.sqrt(sumSq / cnt);
  return {
    n: cnt,
    min,
    max,
    mean,
    rms,
    p2p: max - min,
    last: y[n - 1],
  };
}

/**
 * 从 TelemetryStore 拉最近 window 点某通道并测量
 * @param {import('../data/telemetry-store.js').TelemetryStore} store
 * @param {number} channel
 * @param {number} windowPoints
 */
export function measureChannel(store, channel, windowPoints) {
  const take = Math.min(windowPoints, store.length);
  if (take <= 0) return measureSeries([]);
  const s = store.getSeries(channel, take);
  return measureSeries(s.y.subarray(0, s.n));
}
