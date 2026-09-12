/**
 * Telemetry 适配层：连接物理流解码器与上层 Store/Dashboard/Terminal
 * 全面支持 FOC-STP v1.0 与 JustFloat
 */

export class TelemetryAdapter {
  /**
   * @param {object} opts
   * @param {(sample: {sampleIndex:number, values:Float32Array, mask?:number, tick?:number}) => void} opts.onSample
   * @param {(text: string) => void} [opts.onText]
   * @param {(status: any) => void} [opts.onStatus]
   * @param {(event: any) => void} [opts.onEvent]
   * @param {(ack: any) => void} [opts.onAck]
   */
  constructor(opts) {
    this.onSample = opts.onSample;
    this.onText = opts.onText ?? null;
    this.onStatus = opts.onStatus ?? null;
    this.onEvent = opts.onEvent ?? null;
    this.onAck = opts.onAck ?? null;
    this.decoder = null;

    // 16 位 seq 解缠绕 (Unwrap) 计数器
    this._lastSeq = -1;
    this._unwrappedSeq = 0;
    this._lostFrames = 0;
  }

  /** @param {any} decoder */
  attach(decoder) {
    this.decoder = decoder;
    if (decoder.onWave !== undefined) {
      // FOC-STP 解码器
      decoder.onWave = (tick, mask, values, seq) => {
        if (this._lastSeq < 0) {
          this._unwrappedSeq = seq;
        } else {
          const delta = (seq - this._lastSeq) & 0xFFFF;
          if (delta > 0 && delta < 32768) {
            this._unwrappedSeq += delta;
            if (delta > 1) {
              this._lostFrames += (delta - 1);
            }
          } else if (delta >= 32768) {
            // 异常倒退（如设备重启），重置基准
            this._unwrappedSeq += 1;
          }
        }
        this._lastSeq = seq;

        if (this.onSample) {
          this.onSample({
            sampleIndex: this._unwrappedSeq,
            rawSeq: seq,
            values,
            mask,
            tick,
            timeMs: tick
          });
        }
      };
      decoder.onStatus = (status, seq) => {
        if (this.onStatus) this.onStatus(status, seq);
      };
      decoder.onEvent = (event, seq) => {
        if (this.onEvent) this.onEvent(event, seq);
      };
      decoder.onText = (text, seq) => {
        if (this.onText) this.onText(text, seq);
      };
      decoder.onAck = (ack, seq) => {
        if (this.onAck) this.onAck(ack, seq);
      };
    } else {
      // 原生 JustFloat 解码器
      decoder.onFrame = (values, sampleIndex) => {
        if (this.onSample) {
          this.onSample({ sampleIndex, values });
        }
      };
      decoder.onText = (text) => {
        if (this.onText) this.onText(text);
      };
    }
  }

  /** @param {Uint8Array} bytes */
  feed(bytes) {
    if (this.decoder) this.decoder.push(bytes);
  }

  reset() {
    this._lastSeq = -1;
    this._unwrappedSeq = 0;
    this._lostFrames = 0;
    if (this.decoder) this.decoder.reset();
  }
}
