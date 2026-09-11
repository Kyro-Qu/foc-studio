/**
 * Web Serial 传输层 v0.3.1
 * - generation 防止旧 read loop / write 污染新连接
 * - 串行写队列（E-STOP 可插队）
 * - 任意异常最终回到 DISCONNECTED
 */

export const SerialState = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  READING: "READING",
  DISCONNECTING: "DISCONNECTING",
  ERROR: "ERROR",
};

export class SerialTransport {
  constructor() {
    this.port = null;
    this.reader = null;
    this.state = SerialState.DISCONNECTED;
    this.error = null;
    this.onState = null;
    this.onData = null;
    this.onError = null;
    this.bytesRx = 0;
    this.bytesTx = 0;

    this._gen = 0;
    this._reading = false;
    this._disconnecting = false;
    /** @type {Promise<void>} */
    this._writeChain = Promise.resolve();
    /** @type {Array<{bytes:Uint8Array, resolve:Function, reject:Function, priority:number}>} */
    this._writeQueue = [];
    this._writing = false;
    /** @type {object|null} 当前 in-flight write job */
    this._inFlight = null;
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
   */
  async connect(baudRate = 6500000) {
    if (!SerialTransport.supported()) {
      const err = new Error("当前浏览器不支持 Web Serial，请使用 Chrome / Edge");
      this._setState(SerialState.ERROR, err);
      throw err;
    }
    if (this.state === SerialState.CONNECTING || this.state === SerialState.DISCONNECTING) {
      throw new Error(`busy: ${this.state}`);
    }
    if (this.state === SerialState.CONNECTED || this.state === SerialState.READING) {
      return; // 已连接，幂等
    }

    // 清理可能残留的 port
    if (this.port) {
      await this._teardownPort();
    }

    this._setState(SerialState.CONNECTING);
    const gen = ++this._gen;
    try {
      const port = await navigator.serial.requestPort();
      if (gen !== this._gen) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        throw new Error("connect cancelled");
      }
      await port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
      if (gen !== this._gen) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        throw new Error("connect cancelled");
      }
      this.port = port;
      this._setState(SerialState.CONNECTED);
      void this._readLoop(gen);
    } catch (e) {
      this.port = null;
      this._setState(SerialState.DISCONNECTED, e);
      throw e;
    }
  }

  async _readLoop(gen) {
    if (!this.port || !this.port.readable || gen !== this._gen) return;
    this._reading = true;
    this._setState(SerialState.READING);
    try {
      while (this.port && this.port.readable && this._reading && gen === this._gen) {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (gen !== this._gen) break;
            if (value && value.length) {
              this.bytesRx += value.length;
              if (this.onData) this.onData(value);
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
          if (this.reader === reader) this.reader = null;
        }
      }
    } catch (e) {
      if (gen === this._gen && this._reading) {
        this._setState(SerialState.ERROR, e);
      }
    } finally {
      if (gen === this._gen) {
        this._reading = false;
        if (
          this.state === SerialState.READING ||
          this.state === SerialState.CONNECTED ||
          this.state === SerialState.ERROR
        ) {
          // 拔线等：确保回到干净 DISCONNECTED
          if (!this._disconnecting) {
            await this.disconnect();
          }
        }
      }
    }
  }

  /**
   * @param {Uint8Array|string} data
   * @param {{priority?:number}} [opts] priority=1 插到队首（E-STOP）
   */
  write(data, opts = {}) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const priority = opts.priority === 1 ? 1 : 0;
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.writable || this.state === SerialState.DISCONNECTED) {
        reject(new Error("串口未连接"));
        return;
      }
      const job = { bytes, resolve, reject, priority };
      if (priority) this._writeQueue.unshift(job);
      else this._writeQueue.push(job);
      void this._drainWrites();
    });
  }

  /** 高优先级急停 */
  writePriority(data) {
    return this.write(data, { priority: 1 });
  }

  async _drainWrites() {
    if (this._writing) return;
    this._writing = true;
    try {
      while (this._writeQueue.length) {
        const job = this._writeQueue.shift();
        const gen = this._gen;
        if (!this.port || !this.port.writable || gen !== this._gen || this._disconnecting) {
          job.reject(new Error("串口已断开"));
          continue;
        }
        this._inFlight = job;
        const writer = this.port.writable.getWriter();
        try {
          await writer.write(job.bytes);
          // generation 已失效：不得当作成功
          if (gen !== this._gen) {
            job.reject(new Error("串口已断开"));
          } else {
            this.bytesTx += job.bytes.length;
            job.resolve();
          }
        } catch (e) {
          job.reject(e);
        } finally {
          this._inFlight = null;
          try {
            writer.releaseLock();
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      this._writing = false;
    }
  }

  async _teardownPort() {
    const port = this.port;
    this.port = null;
    if (!port) return;
    try {
      if (this.reader) {
        await this.reader.cancel();
      }
    } catch {
      /* ignore */
    }
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }

  async disconnect() {
    if (this._disconnecting) return;
    if (this.state === SerialState.DISCONNECTED && !this.port) return;
    this._disconnecting = true;
    this._setState(SerialState.DISCONNECTING);
    this._reading = false;
    this._gen += 1; // 使旧 loop/write 失效

    // 拒绝排队中的发送
    const pending = this._writeQueue.splice(0);
    for (const job of pending) {
      job.reject(new Error("串口已断开"));
    }

    await this._teardownPort();
    this._disconnecting = false;
    this._setState(SerialState.DISCONNECTED);
  }
}
