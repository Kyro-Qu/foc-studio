/**
 * 无板自测信号源：基于 performance.now 的追赶式 1 kHz 发帧，
 * 避免 setInterval 被浏览器夹到 ~4ms。
 */

export class SimulationSource {
  /**
   * @param {object} opts
   * @param {(values: Float32Array, sampleIndex: number) => void} opts.onFrame
   * @param {number} [opts.rateHz]
   */
  constructor(opts) {
    this.onFrame = opts.onFrame;
    this.rateHz = opts.rateHz ?? 1000;
    this._timer = null;
    this.t = 0;
    this.sampleIndex = 0;
    this.values = new Float32Array(16);
    this._nextDue = 0;
    this._maxCatchUp = 8;
  }

  start() {
    if (this._timer) return;
    this._nextDue = performance.now();
    const interval = 2; // ms，主循环足够密
    this._timer = setInterval(() => this._pump(), interval);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  reset() {
    this.t = 0;
    this.sampleIndex = 0;
    this._nextDue = performance.now();
  }

  _pump() {
    const now = performance.now();
    const period = 1000 / this.rateHz;
    let n = 0;
    while (now >= this._nextDue && n < this._maxCatchUp) {
      this._tick();
      this._nextDue += period;
      n += 1;
    }
    // 严重落后则对齐到当前时刻，避免螺旋追赶
    if (this._nextDue < now - 50) {
      this._nextDue = now;
    }
  }

  _tick() {
    const t = this.t;
    const v = this.values;
    const dt = 1 / this.rateHz;

    let velRef = 800;
    if (t > 1.5) velRef = 1800;
    else if (t > 0.5) velRef = 1200;

    const tau = 0.25;
    const vel = (Number.isFinite(v[2]) ? v[2] : 0) + (velRef - (Number.isFinite(v[2]) ? v[2] : 0)) * (dt / tau);

    const iqRef = (velRef - vel) * 0.01 + 0.4 + 0.15 * Math.sin(t * 4);
    const iq = iqRef + 0.08 * Math.sin(t * 40) + (Math.random() - 0.5) * 0.04;
    const iqRaw = iq + (Math.random() - 0.5) * 0.12;
    const id = 0.02 * Math.sin(t * 3) + (Math.random() - 0.5) * 0.02;
    const theta = (t * 2 * Math.PI * (vel / 60) * 4) % (2 * Math.PI);
    const vq = 1.2 + 0.8 * iq;
    const vd = -0.1 * id;
    const duty = 0.5 + 0.35 * Math.sin(theta);
    const vbus = 14.2 + 0.05 * Math.sin(t * 2);
    const obsErr = 0.02 * Math.sin(t * 8);

    v[0] = theta;
    v[1] = iqRaw;
    v[2] = vel;
    v[3] = velRef;
    v[4] = id;
    v[5] = iq;
    v[6] = iqRef;
    v[7] = vd;
    v[8] = vq;
    v[9] = iq * Math.sin(theta);
    v[10] = iq * Math.sin(theta - 2.094);
    v[11] = iq * Math.sin(theta + 2.094);
    v[12] = duty;
    v[13] = 0;
    v[14] = obsErr;
    v[15] = vbus;

    this.onFrame(v, this.sampleIndex);
    this.sampleIndex += 1;
    this.t += dt;
  }
}
