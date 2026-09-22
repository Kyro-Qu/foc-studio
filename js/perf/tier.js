/**
 * 运行时性能分档 — 只降绘制策略，绝不砍通道/游标/触发等功能。
 * High: 全列包络 + 中线 60fps
 * Mid:  合并 pass / 限制 dpr
 * Low:  Canvas2D 兜底 / 有数据才画
 */

export const TIERS = {
  HIGH: "high",
  MID: "mid",
  LOW: "low",
};

export class TierController {
  constructor(opts = {}) {
    this.tier = opts.initialTier || TIERS.HIGH;
    this.minFpsHigh = opts.minFpsHigh ?? 55;
    this.minFpsMid = opts.minFpsMid ?? 45;
    this.window = 30;
    this._samples = [];
    this._lowSince = 0;
    this._highSince = 0;
    this._onTier = opts.onTier || null;
  }

  get name() {
    return this.tier;
  }

  /** @param {number} dtMs last frame cost / interval */
  pushFrameTime(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const fps = 1000 / dtMs;
    this._samples.push(fps);
    if (this._samples.length > this.window) this._samples.shift();
    if (this._samples.length < 10) return;
    const avg = this._samples.reduce((a, b) => a + b, 0) / this._samples.length;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    let next = this.tier;
    if (avg < this.minFpsMid) {
      if (!this._lowSince) this._lowSince = now;
      if (now - this._lowSince > 1200 && this.tier !== TIERS.LOW) next = TIERS.LOW;
      this._highSince = 0;
    } else if (avg < this.minFpsHigh) {
      this._lowSince = 0;
      if (this.tier === TIERS.HIGH) next = TIERS.MID;
    } else {
      this._lowSince = 0;
      if (this.tier !== TIERS.HIGH) {
        if (!this._highSince) this._highSince = now;
        if (now - this._highSince > 2000) next = TIERS.HIGH;
      }
    }
    if (next !== this.tier) this._setTier(next);
  }

  /** 外部强制（如 context lost → low） */
  force(tier) {
    this._setTier(tier);
  }

  _setTier(tier) {
    this.tier = tier;
    this._samples.length = 0;
    this._lowSince = 0;
    this._highSince = 0;
    if (this._onTier) this._onTier(tier);
  }

  /** High/Mid 画 GL 波形；Low 可回 Canvas2D */
  useWebGL(preferWebGL) {
    if (!preferWebGL) return false;
    return this.tier === TIERS.HIGH || this.tier === TIERS.MID;
  }

  /** 是否画中心折线（Mid 仍画；极低档可只画包络 — 当前始终 true 保体验） */
  drawCenterLine() {
    return true;
  }

  /** 峰列数缩放（1 = 像素宽）；仅 Low 且超多通道时略减，仍保峰 */
  peakColsFactor(visibleCount) {
    if (this.tier === TIERS.LOW && visibleCount >= 24) return 0.75;
    return 1;
  }
}
