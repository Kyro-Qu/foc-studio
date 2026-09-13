/**
 * 无板自测信号源：追赶式发帧，支持 Normal 1 kHz / Stress 5 kHz。
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
    this.values = new Float32Array(32);
    this._nextDue = 0;
    this._maxCatchUp = 16;
  }

  /** @param {number} [rateHz] 覆盖采样率 */
  start(rateHz = 0) {
    if (this._timer) return;
    if (rateHz > 0) this.rateHz = rateHz;
    this._nextDue = performance.now();
    this._timer = setInterval(() => this._pump(), 2);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  get running() {
    return this._timer != null;
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
    if (this._nextDue < now - 50) this._nextDue = now;
  }

  _tick() {
    const t = this.t;
    const v = this.values;
    const dt = 1 / this.rateHz;

    let velRef = 800;
    if (t > 1.5) velRef = 1800;
    else if (t > 0.5) velRef = 1200;

    const tau = 0.25;
    const prevVel = Number.isFinite(v[2]) ? v[2] : 0;
    const vel = prevVel + (velRef - prevVel) * (dt / tau);

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
    v[13] = id + (Math.random() - 0.5) * 0.05;
    v[14] = 0;
    v[15] = vel + (Math.random() - 0.5) * 6;
    v[16] = 0;
    v[17] = (t * 2 * Math.PI * (vel / 60)) % (2 * Math.PI);
    v[18] = 0.5 + 0.35 * Math.sin(theta - 2.094);
    v[19] = 0.5 + 0.35 * Math.sin(theta + 2.094);
    v[20] = (theta + obsErr) % (2 * Math.PI);
    v[21] = vel + 3 * Math.sin(t * 6);
    v[22] = obsErr * 57.2958;
    v[23] = 0.9 + 0.05 * Math.sin(t * 1.3);
    v[24] = 0.0009;
    v[25] = 1.5 * (vd * id + vq * iq);
    v[26] = vbus;
    v[27] = 1.5 * 7 * 0.0009 * iq;
    v[28] = iqRef - iqRaw;
    v[29] = 0 - id;
    v[30] = velRef - vel;
    v[31] = 4;

    this.onFrame(v, this.sampleIndex);
    this.sampleIndex += 1;
    this.t += dt;
  }
}
