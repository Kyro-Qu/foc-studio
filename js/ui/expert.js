/**
 * 高级算法与新特性看板组件
 * 覆盖：
 * 1. 纯无感 7 状态机监控 (Sensorless Primary)
 * 2. 故障黑匣子 (Blackbox 512 拍) 快速拉取与波形展示
 * 3. 抗齿槽力矩 (Anti-cogging 144 点) 标定与分布可视化
 */

export class ExpertPanel {
  /**
   * @param {HTMLElement} root
   * @param {{send:(cmd:string)=>Promise<void>|void, sendCapture:(cmd:string, ms?:number)=>Promise<string>}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.send = opts.send;
    this.sendCapture = opts.sendCapture;

    // 黑匣子数据缓存
    this.bbData = null;
    // 抗齿槽 144 点数据缓存
    this.acogTable = new Float32Array(144);
    this.acogLoaded = false;

    this._wireEvents();
  }

  _wireEvents() {
    // 1. 无感主控控制
    this.root.querySelector("#btn-sl-query")?.addEventListener("click", () => this.querySensorlessStatus());
    this.root.querySelector("#btn-sl-mode")?.addEventListener("click", async () => {
      if (confirm("确认切换为主控纯无感模式 (I/F -> VESC)？")) {
        await this.send("feedback sensorless");
        await this.querySensorlessStatus();
      }
    });
    this.root.querySelector("#btn-sl-auto")?.addEventListener("click", async () => {
      await this.send("feedback auto");
      await this.querySensorlessStatus();
    });

    // 2. 黑匣子控制
    this.root.querySelector("#btn-bb-dump")?.addEventListener("click", () => this.dumpBlackbox());
    this.root.querySelector("#btn-bb-clear")?.addEventListener("click", () => {
      this.bbData = null;
      this._renderBlackbox();
    });

    // 3. 抗齿槽控制
    this.root.querySelector("#btn-acog-read")?.addEventListener("click", () => this.readAcogTable());
    this.root.querySelector("#btn-acog-start")?.addEventListener("click", async () => {
      if (confirm("请确保电机已在速度模式以 20~30 RPM 恒速转动，开始采样？")) {
        await this.send("acog start");
        this._setAcogBadge("采集中 (Run >=3 turns)", "warn");
      }
    });
    this.root.querySelector("#btn-acog-finish")?.addEventListener("click", async () => {
      await this.send("acog finish");
      await this.readAcogTable();
    });
    this.root.querySelector("#btn-acog-toggle")?.addEventListener("click", async () => {
      const isEn = this._acogEnabled;
      await this.send(`acog enable ${isEn ? 0 : 1}`);
      await this.send("acog");
      setTimeout(() => this.readAcogTable(), 200);
    });

    // 初始清空画布
    this._renderBlackbox();
    this._renderAcogTable();
  }

  _setAcogBadge(text, cls = "") {
    const b = this.root.querySelector("#acog-status-badge");
    if (!b) return;
    b.textContent = text;
    b.className = `wf-badge ${cls}`;
  }

  /** 查询单片机无感状态并刷新 UI */
  async querySensorlessStatus() {
    if (!this.sendCapture) {
      await this.send("feedback");
      return;
    }
    let res = "";
    try {
      res = await this.sendCapture("feedback", 350);
    } catch {
      return;
    }
    this.updateSensorlessFromText(res);
  }

  /**
   * 解析 feedback 回显文本
   * 例: feedback: mode=sensorless state=run blend=1.00 delta=2.1deg spd_open=800.0 spd_obs=798.5 lock=1 conf=0.98 streak=150 lost=0 if_curr=0.50 if_rpm=800
   */
  updateSensorlessFromText(text) {
    if (!text || !text.includes("feedback:")) return;

    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };

    const state = pick(/state=([a-zA-Z0-9_]+)/) || "unknown";
    const delta = pick(/delta=([0-9.-]+)deg/);
    const spdOpen = pick(/spd_open=([0-9.-]+)/);
    const spdObs = pick(/spd_obs=([0-9.-]+)/);
    const lock = pick(/lock=([0-9]+)/);
    const conf = pick(/conf=([0-9.]+)/);

    // 1. 更新 5 步状态机高亮
    const steps = ["if_start", "if_accel", "obs_locking", "blend", "run"];
    const stepEls = this.root.querySelectorAll(".sl-step");
    let matchedIdx = steps.indexOf(state.toLowerCase());

    stepEls.forEach((el, idx) => {
      const sKey = el.getAttribute("data-step");
      el.classList.remove("active", "success");
      if (sKey === state.toLowerCase()) {
        el.classList.add("active");
      } else if (matchedIdx > idx) {
        el.classList.add("success");
      }
    });

    // 2. 指标数值
    const lockEl = this.root.querySelector("#sl-val-lock");
    if (lockEl && lock !== null) {
      const isLocked = Number(lock) === 1;
      lockEl.textContent = isLocked ? "LOCKED (已锁定)" : "UNLOCKED (未锁定)";
      lockEl.style.color = isLocked ? "var(--ok)" : "var(--err)";
    }

    const confEl = this.root.querySelector("#sl-val-conf");
    const barEl = this.root.querySelector("#sl-bar-conf");
    if (confEl && conf !== null) {
      const pct = Math.min(100, Math.max(0, Math.round(Number(conf) * 100)));
      confEl.textContent = `${pct} %`;
      if (barEl) {
        barEl.style.width = `${pct}%`;
        barEl.style.background = pct >= 80 ? "var(--ok)" : (pct >= 50 ? "var(--warn)" : "var(--err)");
      }
    }

    const deltaEl = this.root.querySelector("#sl-val-delta");
    if (deltaEl && delta !== null) {
      const d = parseFloat(delta);
      deltaEl.textContent = `${d.toFixed(1)} °`;
      deltaEl.style.color = Math.abs(d) <= 15 ? "var(--ok)" : (Math.abs(d) <= 25 ? "var(--warn)" : "var(--err)");
    }

    const speedsEl = this.root.querySelector("#sl-val-speeds");
    if (speedsEl && spdOpen !== null && spdObs !== null) {
      speedsEl.textContent = `${Math.round(Number(spdOpen))} / ${Math.round(Number(spdObs))} RPM`;
    }
  }

  /**
   * 消费波形流中的无感遥测 (Ch20~23) 进行毫秒级连续平滑更新
   */
  updateSensorlessFromTelemetry(values) {
    if (!values) return;
    const obsSpeed = values[21];
    const obsErr = values[22];
    const obsConf = values[23];

    if (Number.isFinite(obsConf)) {
      const confEl = this.root.querySelector("#sl-val-conf");
      const barEl = this.root.querySelector("#sl-bar-conf");
      const pct = Math.min(100, Math.max(0, Math.round(obsConf * 100)));
      if (confEl) confEl.textContent = `${pct} %`;
      if (barEl) {
        barEl.style.width = `${pct}%`;
        barEl.style.background = pct >= 80 ? "var(--ok)" : (pct >= 50 ? "var(--warn)" : "var(--err)");
      }
    }

    if (Number.isFinite(obsErr)) {
      const deltaEl = this.root.querySelector("#sl-val-delta");
      if (deltaEl) {
        deltaEl.textContent = `${obsErr.toFixed(1)} °`;
        deltaEl.style.color = Math.abs(obsErr) <= 15 ? "var(--ok)" : (Math.abs(obsErr) <= 25 ? "var(--warn)" : "var(--err)");
      }
    }
  }

  /**
   * 拉取并解析 512 拍黑匣子波形
   */
  async dumpBlackbox() {
    const badge = this.root.querySelector("#bb-status-badge");
    if (badge) badge.textContent = "正在拉取...";

    if (!this.sendCapture) {
      await this.send("blackbox");
      if (badge) badge.textContent = "已发送命令";
      return;
    }

    let text = "";
    try {
      text = await this.sendCapture("blackbox", 1200);
    } catch (e) {
      if (badge) badge.textContent = "拉取失败";
      return;
    }

    if (text.includes("blackbox inactive")) {
      if (badge) badge.textContent = "无跳闸记录";
      this.bbData = null;
      this._renderBlackbox();
      return;
    }

    // 解析 512 行十六进制: [idx] [iu] [iw] [th] [iq] [id]
    const lines = text.split("\n");
    const samples = [];
    const buf = new ArrayBuffer(4);
    const u32 = new Uint32Array(buf);
    const f32 = new Float32Array(buf);

    const parseHexFloat = (hexStr) => {
      u32[0] = parseInt(hexStr, 16);
      return f32[0];
    };

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6) {
        const idx = parseInt(parts[0], 10);
        if (!isNaN(idx) && parts[1].length === 8) {
          samples.push({
            idx,
            iu: parseHexFloat(parts[1]),
            iw: parseHexFloat(parts[2]),
            th: parseHexFloat(parts[3]),
            iq: parseHexFloat(parts[4]),
            id: parseHexFloat(parts[5]),
          });
        }
      }
    }

    if (samples.length > 0) {
      this.bbData = samples;
      if (badge) badge.textContent = `已载入 ${samples.length} 拍`;
      this._renderBlackbox();
    } else {
      if (badge) badge.textContent = "未解析到有效帧";
    }
  }

  _renderBlackbox() {
    const canvas = this.root.querySelector("#bb-canvas");
    const emptyEl = this.root.querySelector("#bb-empty");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!this.bbData || this.bbData.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    // 背景与网格
    ctx.fillStyle = "#151a26";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a2332";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += 40) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // 0 电流基准线 (中间)
    const midY = h * 0.5;
    ctx.strokeStyle = "#2d3748";
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const n = this.bbData.length;
    // 自动缩放幅度
    let maxI = 1.0;
    for (const d of this.bbData) {
      maxI = Math.max(maxI, Math.abs(d.iu), Math.abs(d.iw), Math.abs(d.iq), Math.abs(d.id));
    }
    maxI = maxI * 1.15; // 留余量

    const drawCurve = (prop, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        let v = this.bbData[i][prop];
        if (prop === "th") {
          // 角度归一化到画布
          v = (v / 6.2831853) * maxI;
        }
        const y = midY - (v / maxI) * (h * 0.45);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawCurve("iu", "#ef4444");
    drawCurve("iw", "#3b82f6");
    drawCurve("th", "#eab308");
    drawCurve("iq", "#10b981");
    drawCurve("id", "#a855f7");

    // 标尺标注
    ctx.fillStyle = "#64748b";
    ctx.font = "10px monospace";
    ctx.fillText(`+${maxI.toFixed(2)}A`, 6, 14);
    ctx.fillText(`-${maxI.toFixed(2)}A`, 6, h - 6);
    ctx.fillText("0A", 6, midY - 4);
    ctx.fillText(`跳闸前 512 拍 (~32ms)`, w - 140, 14);
  }

  /**
   * 读取抗齿槽力矩 144 点分布表 (acog dump)
   */
  async readAcogTable() {
    const badge = this.root.querySelector("#acog-status-badge");
    if (badge) badge.textContent = "读取中...";

    if (!this.sendCapture) {
      await this.send("acog dump");
      if (badge) badge.textContent = "已发命令";
      return;
    }

    let text = "";
    try {
      text = await this.sendCapture("acog dump", 1000);
      const statText = await this.sendCapture("acog", 300);
      if (statText.includes("enable=1")) {
        this._acogEnabled = true;
        this._setAcogBadge("已使能 (ENABLED)", "ok");
      } else {
        this._acogEnabled = false;
        this._setAcogBadge("未使能 (DISABLED)", "");
      }
    } catch {
      if (badge) badge.textContent = "读取失败";
      return;
    }

    // 解析 [idx] [deg] [hex_float]
    const buf = new ArrayBuffer(4);
    const u32 = new Uint32Array(buf);
    const f32 = new Float32Array(buf);
    let count = 0;

    const lines = text.split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const idx = parseInt(parts[0], 10);
        if (idx >= 0 && idx < 144 && parts[2].length === 8) {
          u32[0] = parseInt(parts[2], 16);
          this.acogTable[idx] = f32[0];
          count++;
        }
      }
    }

    if (count > 0) {
      this.acogLoaded = true;
      this._renderAcogTable();
    }
  }

  _renderAcogTable() {
    const canvas = this.root.querySelector("#acog-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#151a26";
    ctx.fillRect(0, 0, w, h);

    // 网格与 0A 基准线
    ctx.strokeStyle = "#1a2332";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let deg = 0; deg <= 360; deg += 45) {
      const x = (deg / 360) * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    const midY = h * 0.5;
    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!this.acogLoaded) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("暂无前馈补偿表 · 请点击「读取补偿表」或进行标定", w / 2, midY + 4);
      return;
    }

    // 峰值
    let maxI = 0.05;
    for (let i = 0; i < 144; i++) {
      maxI = Math.max(maxI, Math.abs(this.acogTable[i]));
    }
    maxI = maxI * 1.2;

    // 绘制 144 点补偿柱状图/折线图
    ctx.strokeStyle = "#38bdf8";
    ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 144; i++) {
      const x = (i / 143) * w;
      const val = this.acogTable[i];
      const y = midY - (val / maxI) * (h * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 绘制每个槽的点
    ctx.fillStyle = "#38bdf8";
    for (let i = 0; i < 144; i++) {
      const x = (i / 143) * w;
      const val = this.acogTable[i];
      const y = midY - (val / maxI) * (h * 0.42);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // 标尺文字
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`+${maxI.toFixed(3)} A (Iq 前馈)`, 6, 14);
    ctx.fillText(`-${maxI.toFixed(3)} A`, 6, h - 6);
    ctx.fillText("0°", 6, midY - 4);
    ctx.fillText("180°", w * 0.5 - 12, midY - 4);
    ctx.fillText("360°", w - 30, midY - 4);
  }
}
