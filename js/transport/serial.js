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
    /** 最近一次成功 connect 的波特率，供重连 */
    this.lastBaud = 0;
    /** 最近一次 requestPort 的结果（同设备重连可复用，浏览器允许时） */
    this._lastPort = null;
  }

  static supported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  get generation() {
    return this._gen;
  }

  isConnected() {
    return this.state === SerialState.CONNECTED || this.state === SerialState.READING;
  }

  _setState(s, err = null) {
    this.state = s;
    this.error = err;
    if (this.onState) this.onState(s, err);
    if (err && this.onError) this.onError(err);
  }

  /**
   * 独立请求选择串口设备，保存在 _lastPort 供后续打开
   */
  async selectPort() {
    if (!SerialTransport.supported()) {
      const err = new Error("当前浏览器不支持 Web Serial，请使用 Chrome / Edge");
      this._setState(SerialState.ERROR, err);
      throw err;
    }
    const port = await navigator.serial.requestPort();
    this._lastPort = port;
    return port;
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
      let port = this._lastPort;
      if (!port) {
        port = await navigator.serial.requestPort();
      }
      if (gen !== this._gen) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        throw new Error("connect cancelled");
      }
      try {
        await port.open({
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
          flowControl: "none",
        });
      } catch (openErr) {
        // 如果旧缓存端口因为物理拔插失效无法打开，自动清除缓存并重新弹窗挑选
        if (this._lastPort) {
          this._lastPort = null;
          port = await navigator.serial.requestPort();
          if (gen !== this._gen) throw new Error("connect cancelled");
          await port.open({
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "none",
          });
        } else {
          throw openErr;
        }
      }
      if (gen !== this._gen) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        throw new Error("connect cancelled");
      }
      this.port = port;
      this._lastPort = port;
      this.lastBaud = baudRate;

      // 显式拉高 DTR 与 RTS 信号线，确保 USB CDC 虚拟串口桥的端点始终唤醒不挂起
      try {
        if (typeof port.setSignals === "function") {
          await port.setSignals({ dataTerminalReady: true, requestToSend: true });
        }
      } catch {
        /* 部分非标准平台不支持 setSignals，安全忽略 */
      }

      this._setState(SerialState.CONNECTED);
      void this._readLoop(gen);
    } catch (e) {
      this.port = null;
      this._lastPort = null;
      this._setState(SerialState.DISCONNECTED, e);
      throw e;
    }
  }

  /**
   * 用上次 port + baud 重连（拔插后可能仍有效）。
   * @param {number} [baudRate]
   */
  async reconnect(baudRate = 0) {
    if (this.state === SerialState.CONNECTED || this.state === SerialState.READING) return;
    if (this.state === SerialState.DISCONNECTING) throw new Error("busy: DISCONNECTING");
    const baud = baudRate || this.lastBaud || 6500000;
    if (!this._lastPort) {
      return this.connect(baud);
    }
    await this.connect(baud);
  }

  /** 放弃缓存的 port，下次 connect 必须重新选择 */
  forgetPort() {
    this._lastPort = null;
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
      if (priority) {
        // 急停/最高优先级写入：清除并拒绝队列中积压的普通写入任务，防止急停后又发出排队中的启动/控制命令
        const dropped = this._writeQueue.splice(0, this._writeQueue.length);
        for (const j of dropped) {
          j.reject(new Error("E-STOP 取消排队写入"));
        }
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
