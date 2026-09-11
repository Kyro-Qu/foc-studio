/**
 * VOFA+ JustFloat 帧解复用器。
 *
 * 帧格式：N × float32-LE + tail {0x00,0x00,0x80,0x7F}
 * 当前固件 N=16，帧长 68 字节。
 *
 * CLI 文本与 JustFloat 会在同一 UART 交错
 * （foc_cmd_print 每次 suspend 后打印，行间隙遥测恢复），
 * 因此必须常驻双路解复用。
 *
 * 抗假 tail：+Inf 的 IEEE754 字节恰好是 00 00 80 7F。
 * 成功解出连续帧后进入 locked 状态，只按对齐消费；
 * 失步后退回扫描模式。
 */

export const JUSTFLOAT_TAIL = [0x00, 0x00, 0x80, 0x7f];
export const JUSTFLOAT_CHANNELS = 16;
export const JUSTFLOAT_FRAME_SIZE = JUSTFLOAT_CHANNELS * 4 + 4;

export class JustFloatDecoder {
  /**
   * @param {object} opts
   * @param {number} [opts.channels=16]
   * @param {(values: Float32Array, sampleIndex: number) => void} [opts.onFrame]
   * @param {(text: string) => void} [opts.onText]
   */
  constructor(opts = {}) {
    this.channels = opts.channels ?? JUSTFLOAT_CHANNELS;
    this.frameSize = this.channels * 4 + 4;
    this.onFrame = opts.onFrame ?? null;
    this.onText = opts.onText ?? null;

    this.buf = new Uint8Array(65536);
    this.len = 0;
    this.sampleIndex = 0;
    this.framesOk = 0;
    this.bytesIn = 0;
    this.textOut = 0;
    this.desync = 0;
    /** 连续成功解帧后锁定对齐，避免 float 内 Inf 伪 tail */
    this.locked = false;
    this.lockStreak = 0;
  }

  reset() {
    this.len = 0;
    this.sampleIndex = 0;
    this.framesOk = 0;
    this.bytesIn = 0;
    this.textOut = 0;
    this.desync = 0;
    this.locked = false;
    this.lockStreak = 0;
  }

  resetSampleIndex() {
    this.sampleIndex = 0;
  }

  /**
   * 支持任意大小分片；缓冲区写满前先 drain。
   * @param {Uint8Array} chunk
   */
  push(chunk) {
    this.bytesIn += chunk.length;
    let off = 0;
    while (off < chunk.length) {
      if (this.len >= this.buf.length) {
        this._drain();
        if (this.len >= this.buf.length) {
          // drain 后仍满（全是无法消费的数据）：丢弃一半并记失步
          this.desync += 1;
          this.locked = false;
          this.lockStreak = 0;
          const drop = this.len >> 1;
          this.buf.copyWithin(0, drop);
          this.len -= drop;
        }
        continue;
      }
      const n = Math.min(this.buf.length - this.len, chunk.length - off);
      this.buf.set(chunk.subarray(off, off + n), this.len);
      this.len += n;
      off += n;
      this._drain();
    }
  }

  _findTail(from) {
    const { buf, len } = this;
    for (let i = from; i + 3 < len; i++) {
      if (
        buf[i] === JUSTFLOAT_TAIL[0] &&
        buf[i + 1] === JUSTFLOAT_TAIL[1] &&
        buf[i + 2] === JUSTFLOAT_TAIL[2] &&
        buf[i + 3] === JUSTFLOAT_TAIL[3]
      ) {
        return i;
      }
    }
    return -1;
  }

  _hasTailAt(pos) {
    const { buf, len } = this;
    if (pos < 0 || pos + 3 >= len) return false;
    return (
      buf[pos] === JUSTFLOAT_TAIL[0] &&
      buf[pos + 1] === JUSTFLOAT_TAIL[1] &&
      buf[pos + 2] === JUSTFLOAT_TAIL[2] &&
      buf[pos + 3] === JUSTFLOAT_TAIL[3]
    );
  }

  _emitText(start, end) {
    if (end <= start || !this.onText) return;
    const slice = this.buf.subarray(start, end);
    // 只接受可打印 ASCII + CR/LF；过短碎片多半是二进制误切，丢弃
    let s = "";
    let run = "";
    const flushRun = (force) => {
      if (!run) return;
      const hasNl = run.includes("\n") || run.includes("\r");
      if (hasNl || run.length >= 6 || force) {
        s += run;
      }
      run = "";
    };
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      if (b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)) {
        run += String.fromCharCode(b);
      } else {
        flushRun(false);
      }
    }
    flushRun(true);
    if (s) {
      this.textOut += s.length;
      this.onText(s);
    }
  }

  /**
   * @returns {Float32Array|null} null 表示坏帧
   */
  _decodeFrameAt(frameStart) {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + frameStart, this.channels * 4);
    const values = new Float32Array(this.channels);
    let finite = 0;
    for (let i = 0; i < this.channels; i++) {
      const v = view.getFloat32(i * 4, true);
      values[i] = v;
      if (Number.isFinite(v)) finite++;
    }
    // 至少一半通道有限才接受，避免把随机二进制当帧
    return finite >= this.channels / 2 ? values : null;
  }

  _emitFrame(values) {
    this.framesOk += 1;
    this.lockStreak = Math.min(this.lockStreak + 1, 8);
    if (this.lockStreak >= 2) this.locked = true;
    if (this.onFrame) this.onFrame(values, this.sampleIndex);
    this.sampleIndex += 1;
  }

  _drain() {
    const { buf } = this;
    const payload = this.channels * 4;

    for (;;) {
      // 锁定态：按对齐尝试解一帧
      if (this.locked) {
        if (this.len < this.frameSize) return;
        if (!this._hasTailAt(payload)) {
          // 对齐丢失（常见于 CLI 文本插入）——不算错误失步
          this.locked = false;
          this.lockStreak = 0;
          continue;
        }
        const values = this._decodeFrameAt(0);
        if (values) {
          this._emitFrame(values);
          buf.copyWithin(0, this.frameSize);
          this.len -= this.frameSize;
          continue;
        }
        this.locked = false;
        this.lockStreak = 0;
        this.desync += 1;
        continue;
      }

      // 扫描态：找 tail
      const tailPos = this._findTail(0);
      if (tailPos < 0) {
        const keep = Math.max(this.frameSize - 1, 3);
        if (this.len > keep) {
          this._emitText(0, this.len - keep);
          buf.copyWithin(0, this.len - keep);
          this.len = keep;
        }
        return;
      }

      const frameStart = tailPos - payload;
      if (frameStart < 0) {
        this.desync += 1;
        this._emitText(0, tailPos);
        const consume = tailPos + 4;
        buf.copyWithin(0, consume);
        this.len -= consume;
        continue;
      }

      if (frameStart > 0) {
        this._emitText(0, frameStart);
      }

      const values = this._decodeFrameAt(frameStart);
      if (values) {
        this._emitFrame(values);
      } else {
        this.desync += 1;
        this.lockStreak = 0;
      }

      const consume = frameStart + this.frameSize;
      buf.copyWithin(0, consume);
      this.len -= consume;
    }
  }
}
