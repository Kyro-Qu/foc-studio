/**
 * Web Serial 传输层 + 连接状态机。
 * DISCONNECTED → CONNECTING → CONNECTED → READING → ERROR → DISCONNECTED
 */

export const SerialState = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  READING: "READING",
  ERROR: "ERROR",
};

export class SerialTransport {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readableClosed = null;
    this.state = SerialState.DISCONNECTED;
    this.error = null;
    this.onState = null;
    this.onData = null;
    this.onError = null;
    this._reading = false;
    this.bytesRx = 0;
    this.bytesTx = 0;
  }

  static supported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  _setState(s, err = null) {
    this.state = s;
    this.error = err;
    if (this.onState) this.onState(s, err);
    if (err && this.onError) this.onError(err);
  }

  /**
   * @param {number} baudRate
   * @param {number} [dataBits]
   */
  async connect(baudRate = 6500000) {
    if (!SerialTransport.supported()) {
      const err = new Error("当前浏览器不支持 Web Serial，请使用 Chrome / Edge");
      this._setState(SerialState.ERROR, err);
      throw err;
    }
    if (this.state !== SerialState.DISCONNECTED && this.state !== SerialState.ERROR) {
      return;
    }
    this._setState(SerialState.CONNECTING);
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
      this._setState(SerialState.CONNECTED);
      this._startReadLoop();
    } catch (e) {
      this.port = null;
      this._setState(SerialState.DISCONNECTED, e);
      throw e;
    }
  }

  async _startReadLoop() {
    if (!this.port || !this.port.readable) return;
    this._reading = true;
    this._setState(SerialState.READING);
    const decoder = null;
    try {
      while (this.port && this.port.readable && this._reading) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.length) {
              this.bytesRx += value.length;
              if (this.onData) this.onData(value);
            }
          }
        } finally {
          try {
            this.reader.releaseLock();
          } catch {
            /* ignore */
          }
          this.reader = null;
        }
      }
    } catch (e) {
      if (this._reading) {
        this._setState(SerialState.ERROR, e);
      }
    } finally {
      this._reading = false;
      if (this.state === SerialState.READING || this.state === SerialState.CONNECTED) {
        this._setState(SerialState.DISCONNECTED);
      }
    }
  }

  /** @param {Uint8Array|string} data */
  async write(data) {
    if (!this.port || !this.port.writable) {
      throw new Error("串口未连接");
    }
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.writer = this.port.writable.getWriter();
    try {
      await this.writer.write(bytes);
      this.bytesTx += bytes.length;
    } finally {
      try {
        this.writer.releaseLock();
      } catch {
        /* ignore */
      }
      this.writer = null;
    }
  }

  async disconnect() {
    this._reading = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
    this._setState(SerialState.DISCONNECTED);
  }
}
