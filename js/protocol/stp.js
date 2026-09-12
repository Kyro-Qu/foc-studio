/**
 * @file    stp.js
 * @brief   FOC 自解释掩码遥测协议 (FOC-STP v1.0) JS 流式状态机解码器
 */

export const FOC_STP_SYNC0 = 0xA5;
export const FOC_STP_SYNC1 = 0x5A;
export const FOC_STP_VERSION = 1;

export const FOC_STP_TYPE_WAVE = 0x01;
export const FOC_STP_TYPE_STATUS = 0x02;
export const FOC_STP_TYPE_EVENT = 0x03;
export const FOC_STP_TYPE_TEXT = 0x04;
export const FOC_STP_TYPE_ACK = 0x05;

export const FOC_STP_HEADER_SIZE = 6;
export const FOC_STP_CRC_SIZE = 2;
export const FOC_STP_OVERHEAD = 8;

/**
 * CRC16-CCITT-FALSE:
 * 多项式: 0x1021, 初始值: 0xFFFF, 结果异或: 0x0000, 不反转
 * 测试向量 "123456789" -> 0x29B1
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {number} len
 * @returns {number}
 */
export function crc16Ccitt(data, offset = 0, len = data.length - offset) {
  let crc = 0xFFFF;
  const end = offset + len;
  for (let i = offset; i < end; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

export class StpDecoder {
  /**
   * @param {object} [opts]
   * @param {(tick: number, mask: number, values: Float32Array, seq: number) => void} [opts.onWave]
   * @param {(status: {timestampMs:number, vbus:number, motorFault:number, shuntFault:number, state:number, mode:number, tempC:number, rpmEst:number, iqEst:number}, seq:number) => void} [opts.onStatus]
   * @param {(event: {timestampMs:number, eventId:number, motorFault:number, shuntFault:number, detail:number}, seq:number) => void} [opts.onEvent]
   * @param {(text: string, seq: number) => void} [opts.onText]
   * @param {(ack: {cmdCode:number, status:number, effectiveMask:number, effectiveRateHz:number}, seq:number) => void} [opts.onAck]
   */
  constructor(opts = {}) {
    this.onWave = opts.onWave ?? null;
    this.onStatus = opts.onStatus ?? null;
    this.onEvent = opts.onEvent ?? null;
    this.onText = opts.onText ?? null;
    this.onAck = opts.onAck ?? null;

    this.buf = new Uint8Array(65536);
    this.len = 0;
    this.framesOk = 0;
    this.bytesIn = 0;
    this.crcErrors = 0;
    this.desync = 0;
    this._textDecoder = new TextDecoder("utf-8");
  }

  reset() {
    this.len = 0;
    this.framesOk = 0;
    this.bytesIn = 0;
    this.crcErrors = 0;
    this.desync = 0;
  }

  /**
   * 推送字节片断进行流式解包
   * @param {Uint8Array} chunk
   */
  push(chunk) {
    this.bytesIn += chunk.length;
    let off = 0;
    while (off < chunk.length) {
      if (this.len >= this.buf.length) {
        this._drain();
        if (this.len >= this.buf.length) {
          this.desync += 1;
          const drop = this.len >> 1;
          this.buf.copyWithin(0, drop);
          this.len -= drop;
        }
      }
      const n = Math.min(this.buf.length - this.len, chunk.length - off);
      this.buf.set(chunk.subarray(off, off + n), this.len);
      this.len += n;
      off += n;
      this._drain();
    }
  }

  _findSync(from) {
    const { buf, len } = this;
    for (let i = from; i + 1 < len; i++) {
      if (buf[i] === FOC_STP_SYNC0 && buf[i + 1] === FOC_STP_SYNC1) {
        return i;
      }
    }
    return -1;
  }

  _emitRawText(start, end) {
    if (end <= start || !this.onText) return;
    const slice = this.buf.subarray(start, end);
    let s = "";
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      if (b === 0x0A || b === 0x0D || (b >= 0x20 && b < 0x7F)) {
        s += String.fromCharCode(b);
      }
    }
    if (s.length >= 2) {
      this.onText(s, 0);
    }
  }

  _drain() {
    const { buf } = this;

    for (;;) {
      if (this.len < FOC_STP_OVERHEAD) {
        return;
      }

      const syncPos = this._findSync(0);
      if (syncPos < 0) {
        // 没找到帧头，将前面大部分字节当作潜在文本处理后丢弃，保留最后 1 字节（防跨块同步字被切）
        if (this.len > 1) {
          this._emitRawText(0, this.len - 1);
          buf[0] = buf[this.len - 1];
          this.len = 1;
        }
        return;
      }

      if (syncPos > 0) {
        // 同步字之前有杂散字节
        this._emitRawText(0, syncPos);
        buf.copyWithin(0, syncPos);
        this.len -= syncPos;
        continue;
      }

      // 当前处于同步字 0xA5, 0x5A
      const verType = buf[2];
      const ver = (verType >> 4) & 0x0F;
      const type = verType & 0x0F;
      const payloadLen = buf[3];
      const totalLen = FOC_STP_OVERHEAD + payloadLen;

      // 提前合理性门禁：防止伪同步字带异常大 LEN (如 255) 导致阻塞等待
      let lenValid = false;
      switch (type) {
        case FOC_STP_TYPE_WAVE:
          lenValid = (payloadLen >= 8 && payloadLen <= 72 && ((payloadLen - 8) % 4 === 0));
          break;
        case FOC_STP_TYPE_STATUS:
          lenValid = (payloadLen === 15);
          break;
        case FOC_STP_TYPE_EVENT:
          lenValid = (payloadLen === 11);
          break;
        case FOC_STP_TYPE_TEXT:
          lenValid = (payloadLen >= 1 && payloadLen <= 128);
          break;
        case FOC_STP_TYPE_ACK:
          lenValid = (payloadLen === 8);
          break;
        default:
          lenValid = false;
          break;
      }

      if (ver !== FOC_STP_VERSION || !lenValid) {
        // 版本不匹配或长度/类型不合法，跳过假同步字寻找下一个
        this.desync += 1;
        buf.copyWithin(0, 1);
        this.len -= 1;
        continue;
      }

      if (this.len < totalLen) {
        // 帧尚未接收完整，等待后续数据
        return;
      }

      // 校验 CRC16
      const seq = buf[4] | (buf[5] << 8);
      const crcExpected = buf[totalLen - 2] | (buf[totalLen - 1] << 8);
      const crcCalculated = crc16Ccitt(buf, 2, 4 + payloadLen);

      if (crcCalculated !== crcExpected) {
        // CRC 损坏，跳过假同步字寻找下一个
        this.crcErrors += 1;
        buf.copyWithin(0, 1);
        this.len -= 1;
        continue;
      }

      // CRC 校验通过，开始解析对应类型的 Payload
      const payloadOffset = FOC_STP_HEADER_SIZE;
      const view = new DataView(buf.buffer, buf.byteOffset + payloadOffset, payloadLen);

      try {
        switch (type) {
          case FOC_STP_TYPE_WAVE: {
            const sampleTick = view.getUint32(0, true);
            const channelMask = view.getUint32(4, true);
            const valCount = (payloadLen - 8) >> 2;

            // 严格校验 popcount 与 valCount 一致性
            let bitCount = 0;
            let m = channelMask;
            while (m !== 0) {
              bitCount += (m & 1);
              m >>>= 1;
            }
            if (bitCount !== valCount || bitCount > 16) {
              this.desync += 1;
              buf.copyWithin(0, 1);
              this.len -= 1;
              continue;
            }

            const values = new Float32Array(valCount);
            for (let k = 0; k < valCount; k++) {
              values[k] = view.getFloat32(8 + k * 4, true);
            }
            this.framesOk += 1;
            if (this.onWave) {
              this.onWave(sampleTick, channelMask, values, seq);
            }
            break;
          }

          case FOC_STP_TYPE_STATUS: {
            if (payloadLen >= 15) {
              const timestampMs = view.getUint32(0, true);
              const vbusCvolts = view.getUint16(4, true);
              const motorFault = view.getUint8(6);
              const shuntFault = view.getUint8(7);
              const state = view.getUint8(8);
              const mode = view.getUint8(9);
              const tempC = view.getInt8(10);
              const rpmEst = view.getInt16(11, true);
              const iqEstCa = view.getInt16(13, true);

              this.framesOk += 1;
              if (this.onStatus) {
                this.onStatus({
                  timestampMs,
                  vbus: vbusCvolts / 100.0,
                  motorFault,
                  shuntFault,
                  state,
                  mode,
                  tempC,
                  rpmEst,
                  iqEst: iqEstCa / 100.0,
                }, seq);
              }
            }
            break;
          }

          case FOC_STP_TYPE_EVENT: {
            if (payloadLen >= 11) {
              const timestampMs = view.getUint32(0, true);
              const eventId = view.getUint8(4);
              const motorFault = view.getUint8(5);
              const shuntFault = view.getUint8(6);
              const detail = view.getUint32(7, true);

              this.framesOk += 1;
              if (this.onEvent) {
                this.onEvent({ timestampMs, eventId, motorFault, shuntFault, detail }, seq);
              }
            }
            break;
          }

          case FOC_STP_TYPE_TEXT: {
            const textSlice = buf.subarray(payloadOffset, payloadOffset + payloadLen);
            const text = this._textDecoder.decode(textSlice);
            this.framesOk += 1;
            if (this.onText) {
              this.onText(text, seq);
            }
            break;
          }

          case FOC_STP_TYPE_ACK: {
            if (payloadLen >= 8) {
              const cmdCode = view.getUint8(0);
              const status = view.getUint8(1);
              const effectiveMask = view.getUint32(2, true);
              const effectiveRateHz = view.getUint16(6, true);

              this.framesOk += 1;
              if (this.onAck) {
                this.onAck({ cmdCode, status, effectiveMask, effectiveRateHz }, seq);
              }
            }
            break;
          }

          default:
            // 未知帧类型
            break;
        }
      } catch {
        // 保护回调异常不中断解码流
      }

      // 消费该帧
      buf.copyWithin(0, totalLen);
      this.len -= totalLen;
    }
  }
}
