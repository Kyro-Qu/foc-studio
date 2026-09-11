/**
 * Telemetry 适配层：Scope/Dashboard 只认这一层的样本结构。
 * Phase 2 在此挂 FocProtocolDecoder，不必改 UI。
 *
 * 样本：{ sampleIndex, values: Float32Array }
 */

export class TelemetryAdapter {
  /**
   * @param {object} opts
   * @param {(sample: {sampleIndex:number, values:Float32Array}) => void} opts.onSample
   * @param {(text: string) => void} [opts.onText]
   */
  constructor(opts) {
    this.onSample = opts.onSample;
    this.onText = opts.onText ?? null;
    this.decoder = null;
  }

  /** @param {import('./justfloat.js').JustFloatDecoder} decoder */
  attach(decoder) {
    this.decoder = decoder;
    decoder.onFrame = (values, sampleIndex) => {
      this.onSample({ sampleIndex, values });
    };
    decoder.onText = (text) => {
      if (this.onText) this.onText(text);
    };
  }

  /** @param {Uint8Array} bytes */
  feed(bytes) {
    if (this.decoder) this.decoder.push(bytes);
  }

  reset() {
    if (this.decoder) this.decoder.reset();
  }
}
