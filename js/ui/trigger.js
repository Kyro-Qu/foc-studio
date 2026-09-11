/**
 * 显示触发引擎（纯前端）。
 * 不依赖固件：在滚动缓冲上检测源通道穿越电平，锁定显示窗。
 */

export const TriggerMode = {
  OFF: "off",
  AUTO: "auto",
  NORMAL: "normal",
};

export class TriggerEngine {
  constructor() {
    this.mode = TriggerMode.OFF;
    this.source = 1; // ch id
    this.edge = "rising"; // rising | falling
    this.level = 0;
    this.preRatio = 0.2;
    this.autoTimeoutMs = 2000;
    this.armed = false;
    this.frozen = false;
    /** 触发点 sampleIndex */
    this.triggerIndex = -1;
    this._lastValue = null;
    this._armedAt = 0;
    this._windowPoints = 5000;
  }

  configure(opts = {}) {
    if (opts.mode) this.mode = opts.mode;
    if (opts.source !== undefined) this.source = opts.source;
    if (opts.edge) this.edge = opts.edge;
    if (opts.level !== undefined) this.level = opts.level;
    if (opts.windowPoints) this._windowPoints = opts.windowPoints;
  }

  arm() {
    this.armed = true;
    this.frozen = false;
    this.triggerIndex = -1;
    this._lastValue = null;
    this._armedAt = Date.now();
  }

  disarm() {
    this.armed = false;
    this.frozen = false;
    this.triggerIndex = -1;
  }

  /**
   * 送入最新样本；返回是否刚刚触发
   * @param {Float32Array} values
   * @param {number} sampleIndex
   */
  push(values, sampleIndex) {
    if (this.mode === TriggerMode.OFF) return false;
    if (this.frozen) return false;

    const v = values[this.source];
    if (!Number.isFinite(v)) return false;

    let fired = false;
    if (this._lastValue !== null) {
      const prev = this._lastValue;
      if (this.edge === "rising" && prev < this.level && v >= this.level) fired = true;
      if (this.edge === "falling" && prev > this.level && v <= this.level) fired = true;
    }
    this._lastValue = v;

    if (fired && this.armed) {
      this.triggerIndex = sampleIndex;
      this.frozen = true;
      this.armed = false;
      return true;
    }

    // NORMAL 无超时；AUTO 超时后强制刷新（不冻结）
    if (this.mode === TriggerMode.AUTO && Date.now() - this._armedAt > this.autoTimeoutMs) {
      this._armedAt = Date.now();
      // 保持 armed，但不 freeze —— 交给 UI 继续滚动
    }
    return false;
  }

  /**
   * 显示窗口：以触发点为中心 pre/post；末尾不超过 latest。
   * @returns {{startIdx:number,endIdx:number,triggerIndex:number}|null}
   */
  viewWindow(totalPoints, latestIndex) {
    if (!this.frozen || this.triggerIndex < 0) return null;
    const pre = Math.floor(this._windowPoints * this.preRatio);
    const post = this._windowPoints - pre;
    let startIdx = this.triggerIndex - pre;
    let endIdx = this.triggerIndex + post;
    if (Number.isFinite(latestIndex) && endIdx > latestIndex) {
      const shift = endIdx - latestIndex;
      endIdx = latestIndex;
      startIdx = startIdx - shift;
    }
    return { startIdx, endIdx, triggerIndex: this.triggerIndex };
  }
}
