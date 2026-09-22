/**
 * 可选 Worker：多核算峰包络。
 * 主线程拷贝窗口切片成本高，默认低速路径用主线程 extractPeaksMulti。
 * 仅当 SharedArrayBuffer 可用时启用（GitHub Pages 通常不可用）。
 */

import { extractPeaksMulti } from "./peak-extract.js";

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type !== "peaks") return;
  try {
    const ring = {
      data: msg.data,
      indices: msg.indices,
      numChannels: msg.numChannels,
      capacity: msg.capacity,
      head: msg.head,
      count: msg.count,
      latestIndex: msg.latestIndex,
    };
    const map = extractPeaksMulti(ring, msg.channelIds, msg.columns, msg.range || null, null);
    const payload = {};
    for (const [id, p] of map) {
      payload[id] = {
        minY: p.minY,
        maxY: p.maxY,
        minIdx: p.minIdx,
        maxIdx: p.maxIdx,
        n: p.n,
        cols: p.cols,
      };
    }
    self.postMessage({ type: "peaks", id: msg.id, peaks: payload });
  } catch (e) {
    self.postMessage({ type: "error", id: msg.id, message: String(e && e.message ? e.message : e) });
  }
};
