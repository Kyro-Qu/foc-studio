/**
 * 六步调试工作流 UI — 超前于固件的能力也先做在上位机里。
 * 每步发既有 CLI；无固件命令时给出说明并禁用或标为「待固件」。
 */

import { t } from "../i18n.js";
import { MODES, MODE_CONTROLS, OBS_COMMANDS } from "./console.js";

const STEPS = [
  { id: "device", key: "wf.device" },
  { id: "motor", key: "wf.motor" },
  { id: "encoder", key: "wf.encoder" },
  { id: "pid", key: "wf.pid" },
  { id: "run", key: "wf.run" },
];

/** 固件标准故障码定义映射 */
export const FAULT_NAMES = {
  0: "NONE (正常)",
  1: "CURRENT_SENSE (电流采样失效)",
  2: "CALIB_OVERCURRENT (校准过流)",
  3: "RUN_OVERCURRENT (运行过流)",
  4: "CALIB_TIMEOUT (校准超时)",
  5: "CALIB_STATE (校准状态异常)",
  6: "NOT_CALIBRATED (未校准)",
  7: "CONTROL_NAN (控制量溢出/NaN)",
  8: "STALL (电机堵转)",
  9: "OBSERVER (无感观测器失锁)",
  10: "BAD_CONFIG (参数非法)",
  11: "UNDERVOLTAGE (母线欠压)",
  12: "OVERVOLTAGE (母线过压)",
};

/** 解析硬件复位标志 */
export function parseResetFlags(text) {
  // 匹配形如 rst_flags=0x0C000000 (IWDG=0 SFT=0 BOR=0 PIN=1)
  const bracketMatch = text.match(/rst_flags=(0x[0-9A-Fa-f]+)\s*\(([^)]+)\)/);
  if (bracketMatch) {
    const rawHex = bracketMatch[1];
    const details = bracketMatch[2].trim();
    // 提取细节里非 0 的项
    const active = [];
    if (/IWDG=1/.test(details)) active.push("看门狗复位 (IWDG)");
    if (/SFT=1/.test(details)) active.push("软件复位 (SFT)");
    if (/BOR=1/.test(details)) active.push("欠压掉电 (BOR)");
    if (/PIN=1/.test(details)) active.push("引脚复位 (PIN)");
    return {
      rawHex,
      activeNames: active.length ? active : ["正常上电/引脚复位"],
      desc: active.length ? active.join(" / ") : details,
    };
  }
  const hexMatch = text.match(/rst_flags=(0x[0-9A-Fa-f]+)/);
  if (hexMatch) {
    return {
      rawHex: hexMatch[1],
      activeNames: ["未知复位源"],
      desc: hexMatch[1],
    };
  }
  return { rawHex: "—", activeNames: [], desc: "—" };
}

/**
 * 解析 version 与 status 输出文本为结构化板卡与诊断字典
 * @param {string} text
 */
export function parseBoardAndStatus(text) {
  const pick = (re, def = "—") => {
    const m = text.match(re);
    return m ? m[1] : def;
  };

  const board = pick(/board=(\S+)/);
  const firmware = pick(/firmware=(\S+)/);
  const version = pick(/version=(\S+)/);
  const cli = pick(/cli=(\S+)/);
  const build = pick(/build=([^\r\n]+)/).trim();
  const pp = pick(/pole_pairs=([0-9.]+)/);
  const cpr = pick(/encoder_cpr=([0-9]+)/);
  const maxRpm = pick(/max_rpm=([0-9.]+)/);
  const vbus = pick(/udc=([0-9.]+)/, pick(/vbus=([0-9.]+)/));

  // 校准信息：calib=1* 或 calib=0
  const calibMatch = text.match(/calib=([0-9]+)(\*?)/);
  const calibValid = calibMatch ? calibMatch[1] === "1" : false;
  const calibFromStore = calibMatch ? calibMatch[2] === "*" : false;
  const calibOffset = pick(/offset=([0-9.-]+(?:rad)?)/);
  const calibDir = pick(/calib_dir=([0-9-]+)/);

  // 故障码
  const faultRaw = pick(/fault=([0-9]+)/);
  const faultCode = faultRaw !== "—" ? parseInt(faultRaw, 10) : 0;
  const faultName = FAULT_NAMES[faultCode] || `FAULT_${faultCode}`;

  // 状态机与模式
  const state = pick(/M0 ([A-Z]+)/);
  const mode = pick(/mode=(\S+)/);
  const cpu = pick(/cpu=([0-9.]+)%/);
  const cpuMax = pick(/\(max ([0-9.]+)%\)/);

  // 电流采样链路
  const csReady = pick(/cs_ready=([0-9]+)/);
  const csFault = pick(/cs_fault=([0-9]+)/);
  const rejected = pick(/rejected=([0-9]+)/);
  const consecutive = pick(/consecutive=([0-9]+)/);

  // 复位与通信
  const rst = parseResetFlags(text);
  const cliRxOverflow = pick(/cli_rx_overflow=([0-9]+)/);
  const tripI = pick(/trip_i=([^\r\n]+)/);

  return {
    board,
    firmware,
    version,
    cli,
    build,
    pole_pairs: pp,
    encoder_cpr: cpr,
    max_rpm: maxRpm,
    vbus,
    calibValid,
    calibFromStore,
    calibOffset,
    calibDir,
    faultCode,
    faultName,
    state,
    mode,
    cpu,
    cpuMax,
    csReady: csReady !== "—" ? parseInt(csReady, 10) : null,
    csFault: csFault !== "—" ? parseInt(csFault, 10) : null,
    rejected: rejected !== "—" ? parseInt(rejected, 10) : null,
    consecutive: consecutive !== "—" ? parseInt(consecutive, 10) : null,
    rstHex: rst.rawHex,
    rstDesc: rst.desc,
    rstActive: rst.activeNames,
    cliRxOverflow: cliRxOverflow !== "—" ? parseInt(cliRxOverflow, 10) : null,
    tripI,
    rawText: text,
  };
}

/**
 * 依据解析后的指标执行多维系统体检评分与诊断判定
 * @param {ReturnType<typeof parseBoardAndStatus>} info
 */
export function diagnoseSystemHealth(info) {
  const checks = [];
  let score = 100;

  // 1. 系统故障码检查 (权重 30)
  if (info.faultCode === 0) {
    checks.push({
      id: "fault",
      name: "系统故障码",
      status: "ok",
      msg: "系统正常无报错 (fault=0)",
      value: "OK",
    });
  } else if (info.faultCode === 6) {
    // NOT_CALIBRATED 属于待校准，提示但不算致命硬件损坏
    score -= 10;
    checks.push({
      id: "fault",
      name: "系统故障码",
      status: "warn",
      msg: "电机尚未校准 (NOT_CALIBRATED)，闭环前需完成校准",
      value: info.faultName,
    });
  } else {
    score -= 30;
    checks.push({
      id: "fault",
      name: "系统故障码",
      status: "bad",
      msg: `系统存在跳闸故障: ${info.faultName}`,
      value: info.faultName,
    });
  }

  // 2. 电流采样链路健康度 (权重 25)
  if (info.csReady !== null) {
    if (info.csReady === 1 && info.csFault === 0 && (info.rejected ?? 0) === 0) {
      checks.push({
        id: "current_sense",
        name: "电流采样链路",
        status: "ok",
        msg: "三相差分采样与OPAMP链路就绪，丢拍为 0",
        value: "就绪 (cs_ready=1)",
      });
    } else if (info.csReady === 1 && (info.rejected ?? 0) > 0) {
      score -= 10;
      checks.push({
        id: "current_sense",
        name: "电流采样链路",
        status: "warn",
        msg: `电流链路就绪但存在 ${info.rejected} 次采样丢拍 (rejected)`,
        value: `丢拍 ${info.rejected}`,
      });
    } else {
      score -= 25;
      checks.push({
        id: "current_sense",
        name: "电流采样链路",
        status: "bad",
        msg: `电流采样未就绪或存在故障 (ready=${info.csReady}, fault=${info.csFault})`,
        value: `异常 fault=${info.csFault}`,
      });
    }
  }

  // 3. 供电母线电压 (权重 15)
  const vbusNum = parseFloat(info.vbus);
  if (!isNaN(vbusNum)) {
    if (vbusNum >= 10.0 && vbusNum <= 28.0) {
      checks.push({
        id: "vbus",
        name: "供电母线电压",
        status: "ok",
        msg: `母线电压 ${vbusNum.toFixed(2)}V 在标准安全工作区间 (10~28V)`,
        value: `${vbusNum.toFixed(2)}V`,
      });
    } else if (vbusNum < 10.0) {
      score -= 15;
      checks.push({
        id: "vbus",
        name: "供电母线电压",
        status: "warn",
        msg: `母线电压 ${vbusNum.toFixed(2)}V 偏低，可能触发欠压保护`,
        value: `${vbusNum.toFixed(2)}V (偏低)`,
      });
    } else {
      score -= 15;
      checks.push({
        id: "vbus",
        name: "供电母线电压",
        status: "warn",
        msg: `母线电压 ${vbusNum.toFixed(2)}V 偏高，注意过压风险`,
        value: `${vbusNum.toFixed(2)}V (偏高)`,
      });
    }
  }

  // 4. 电角度校准与持久化 (权重 15)
  if (info.calibValid) {
    const src = info.calibFromStore ? "Flash 已固化" : "仅 RAM (掉电丢失)";
    checks.push({
      id: "calib",
      name: "电角度偏置",
      status: info.calibFromStore ? "ok" : "warn",
      msg: `电角度已校准: offset=${info.calibOffset || "0"}, 存储源: ${src}`,
      value: `已校准 (${src})`,
    });
    if (!info.calibFromStore) score -= 5;
  } else {
    score -= 15;
    checks.push({
      id: "calib",
      name: "电角度偏置",
      status: "warn",
      msg: "电角度零点未完成校准，不可进入闭环",
      value: "未校准",
    });
  }

  // 5. 硬件复位源排查 (权重 10)
  if (info.rstActive && info.rstActive.length > 0) {
    const hasIwdg = info.rstDesc.includes("IWDG");
    const hasBor = info.rstDesc.includes("BOR");
    if (hasIwdg) {
      score -= 10;
      checks.push({
        id: "reset",
        name: "硬件复位源",
        status: "bad",
        msg: "检测到独立看门狗复位 (IWDG)，系统曾出现卡死或过载看门狗超时",
        value: info.rstDesc,
      });
    } else if (hasBor) {
      score -= 5;
      checks.push({
        id: "reset",
        name: "硬件复位源",
        status: "warn",
        msg: "检测到欠压复位 (BOR)，电源母线可能发生过瞬态跌落",
        value: info.rstDesc,
      });
    } else {
      checks.push({
        id: "reset",
        name: "硬件复位源",
        status: "ok",
        msg: `正常复位唤醒: ${info.rstDesc}`,
        value: info.rstDesc,
      });
    }
  }

  // 6. CPU 负荷与 CLI 串口实时性 (权重 5)
  const cpuNum = parseFloat(info.cpu);
  const overflow = info.cliRxOverflow ?? 0;
  if (!isNaN(cpuNum)) {
    if (cpuNum < 75.0 && overflow === 0) {
      checks.push({
        id: "cpu",
        name: "算力与通信",
        status: "ok",
        msg: `CPU 占用 ${cpuNum.toFixed(1)}% (峰值 ${info.cpuMax || "—"}%)，CLI 接收 0 溢出`,
        value: `${cpuNum.toFixed(1)}% / 0丢包`,
      });
    } else if (overflow > 0) {
      score -= 5;
      checks.push({
        id: "cpu",
        name: "算力与通信",
        status: "warn",
        msg: `检测到 CLI 接收缓冲区溢出 ${overflow} 字节，可能存在通信堵塞`,
        value: `溢出 ${overflow}B`,
      });
    } else {
      score -= 5;
      checks.push({
        id: "cpu",
        name: "算力与通信",
        status: "warn",
        msg: `CPU 占用偏高 (${cpuNum.toFixed(1)}%)，请留意实时性`,
        value: `${cpuNum.toFixed(1)}%`,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));

  let overall = "ok";
  if (score < 60 || checks.some((c) => c.status === "bad")) {
    overall = "bad";
  } else if (score < 90 || checks.some((c) => c.status === "warn")) {
    overall = "warn";
  }

  const generateMarkdownReport = () => {
    const lines = [];
    lines.push(`# FOC 系统健康诊断报告`);
    lines.push(`- **诊断时间**: ${new Date().toLocaleString()}`);
    lines.push(`- **综合健康得分**: **${score} / 100** (${overall.toUpperCase()})`);
    lines.push(`- **硬件板卡**: ${info.board}`);
    lines.push(`- **固件版本**: ${info.firmware} v${info.version} (CLI: ${info.cli})`);
    lines.push(`- **构建时间**: ${info.build}`);
    lines.push(`- **电机参数**: 极对数=${info.pole_pairs}, CPR=${info.encoder_cpr}, 最大转速=${info.max_rpm} RPM`);
    lines.push(`\n## 诊断分项清单`);
    for (const c of checks) {
      const ico = c.status === "ok" ? "✔ [PASS]" : c.status === "warn" ? "▲ [WARN]" : "✖ [FAIL]";
      lines.push(`- ${ico} **${c.name}**: ${c.msg} (读数: \`${c.value || "—"}\`)`);
    }
    lines.push(`\n## 硬件与底层链路快照`);
    lines.push(`\`\`\``);
    lines.push(info.rawText.trim());
    lines.push(`\`\`\``);
    return lines.join("\n");
  };

  return {
    score,
    overall,
    checks,
    generateMarkdownReport,
  };
}

export class WorkflowWizard {
  /**
   * @param {HTMLElement} root
   * @param {{send:(cmd:string)=>Promise<void>|void, isConnected?:()=>boolean}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.send = opts.send;
    /** @type {(cmd:string,ms?:number)=>Promise<string>|undefined} */
    this.sendCapture = opts.sendCapture;
    this.isConnected = opts.isConnected || (() => true);
    this.step = "device";
    /** @type {Record<string, string>} 调参基准值，用于脏状态感知 */
    this.pidBaseline = {};
    this.render();
  }

  setStep(id) {
    this.step = STEPS.some((s) => s.id === id) ? id : "device";
    this.render();
  }

  next() {
    const i = STEPS.findIndex((s) => s.id === this.step);
    if (i >= 0 && i < STEPS.length - 1) {
      const id = STEPS[i + 1].id;
      this.setStep(id);
      document.querySelectorAll('.nav-btn[data-panel="wf"]').forEach((b) => {
        b.classList.toggle("active", b.dataset.step === id);
      });
    }
  }

  prev() {
    const i = STEPS.findIndex((s) => s.id === this.step);
    if (i > 0) {
      const id = STEPS[i - 1].id;
      this.setStep(id);
      document.querySelectorAll('.nav-btn[data-panel="wf"]').forEach((b) => {
        b.classList.toggle("active", b.dataset.step === id);
      });
    }
  }

  async _cli(cmd) {
    try {
      await this.send(cmd);
    } catch (e) {
      /* terminal shows errors */
    }
  }

  /** 读取 version+status 并解析板卡信息 */
  async _readBoardInfo() {
    const box = this.root.querySelector("#wf-board-info");
    if (box) box.classList.add("loading");
    if (!this.sendCapture) {
      await this._cli("version");
      await this._cli("status");
      if (box) box.classList.remove("loading");
      return;
    }
    let text = "";
    try {
      text += await this.sendCapture("version", 350);
      text += "\n" + (await this.sendCapture("status", 400));
    } catch {
      /* ignore */
    }
    this._latestBoardText = text;
    this._renderBoardInfo(text);
    if (box) box.classList.remove("loading");
  }

  /** 触发一键系统体检 */
  async _runHealthCheck() {
    const box = this.root.querySelector("#wf-health-card");
    if (box) box.classList.add("loading");
    if (!this._latestBoardText) {
      await this._readBoardInfo();
    }
    const text = this._latestBoardText || "";
    const info = parseBoardAndStatus(text);
    const diag = diagnoseSystemHealth(info);
    this._latestDiag = diag;
    this._renderHealthCheck(diag);
    if (box) box.classList.remove("loading");
  }

  /** 复制格式化 Markdown 诊断报告到剪贴板 */
  async _copyHealthReport() {
    if (!this._latestDiag) {
      await this._runHealthCheck();
    }
    if (!this._latestDiag) return;
    const report = this._latestDiag.generateMarkdownReport();
    try {
      await navigator.clipboard.writeText(report);
      const btn = this.root.querySelector("#wf-copy-report");
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "✔ 已复制到剪贴板";
        setTimeout(() => (btn.textContent = orig), 2000);
      }
    } catch {
      alert("复制失败，请在终端面板中查看。");
    }
  }

  _renderBoardInfo(text) {
    const box = this.root.querySelector("#wf-board-info");
    if (!box) return;
    const info = parseBoardAndStatus(text);
    const calibSrc = info.calibFromStore ? "Flash" : "RAM";
    const calibVal = info.calibValid
      ? `已校准 (${calibSrc} | ${info.calibOffset || "0rad"})`
      : "未校准";

    const rows = [
      [t("wf.device.mcu"), info.board],
      [t("wf.device.fw"), `${info.firmware} v${info.version}`],
      ["CLI", info.cli],
      ["Build", info.build],
      [t("wf.motor.pp"), `${info.pole_pairs} (CPR: ${info.encoder_cpr})`],
      [t("wf.motor.maxrpm"), `${info.max_rpm} RPM`],
      [t("board.udc"), `${info.vbus} V`],
      [t("board.calib"), calibVal],
      [t("board.fault"), `${info.faultCode} (${info.faultName})`],
      ["CPU 负载", `${info.cpu || "—"}% (峰值 ${info.cpuMax || "—"}%)`],
      [t("board.state"), `${info.state || "IDLE"} / ${info.mode || "—"}`],
      ["复位来源", info.rstDesc],
      ["电流采样", info.csReady !== null ? `cs_ready=${info.csReady}, cs_fault=${info.csFault}, 丢拍=${info.rejected ?? 0}` : "—"],
      ["通信溢出", info.cliRxOverflow !== null ? `${info.cliRxOverflow} 字节` : "0 字节"],
    ];

    box.innerHTML = rows
      .map(([k, v]) => `<div class="wf-kv"><span>${k}</span><strong>${v}</strong></div>`)
      .join("");
  }

  _renderHealthCheck(diag) {
    const card = this.root.querySelector("#wf-health-card");
    if (!card) return;
    card.style.display = "flex";
    const pillClass =
      diag.overall === "ok"
        ? "health-score-ok"
        : diag.overall === "warn"
        ? "health-score-warn"
        : "health-score-bad";

    const itemsHtml = diag.checks
      .map((c) => {
        const itemClass =
          c.status === "ok"
            ? "item-ok"
            : c.status === "warn"
            ? "item-warn"
            : "item-bad";
        const icon = c.status === "ok" ? "✔" : c.status === "warn" ? "▲" : "✖";
        return `
          <div class="health-item ${itemClass}">
            <span class="ico">${icon}</span>
            <strong style="min-width:90px">${c.name}:</strong>
            <span>${c.msg}</span>
          </div>`;
      })
      .join("");

    card.innerHTML = `
      <div class="health-summary">
        <span style="font-size:12px;font-weight:600;color:var(--text-muted)">系统体检综合诊断：</span>
        <span class="health-score-pill ${pillClass}">得分: ${diag.score} / 100 (${diag.overall.toUpperCase()})</span>
      </div>
      <div class="health-items">
        ${itemsHtml}
      </div>`;
  }

  render() {
    this.root.innerHTML = "";
    // 步骤在左侧栏切换；页内不显示步骤条或上一步/下一步
    const body = document.createElement("div");
    body.className = "wf-body";
    body.innerHTML = this._pageHtml(this.step);
    this.root.appendChild(body);
    this._wire();
    if (this.onAfterRender) this.onAfterRender(this.step);
  }

  _pageHtml(id) {
    switch (id) {
      case "device":
        return this._htmlDevice();
      case "motor":
        return this._htmlMotor();
      case "encoder":
        return this._htmlEncoder();
      case "pid":
        return this._htmlPid();
      case "run":
        return this._htmlRun();
      default:
        return "";
    }
  }

  _htmlDevice() {
    return `
      <h3 class="wf-h">${t("wf.device.h")}</h3>
      <p class="wf-p">${t("wf.device.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.device.info")}</h4>
        <div class="wf-row">
          <button class="ok" id="wf-read-info">${t("wf.device.read")}</button>
          <button class="ok" id="wf-health-check" style="background:#0284c7;border-color:#0369a1">${t("wf.device.self_check")}</button>
          <button id="wf-copy-report">${t("wf.device.copy_report")}</button>
          <button data-cmd="log 0">${t("log.off")}</button>
          <button data-cmd="log 1">${t("log.on")}</button>
        </div>
        <div id="wf-board-info" class="wf-board">
          ${this._emptyBoardHtml()}
        </div>
        <div id="wf-health-card" class="health-check-card" style="display:none"></div>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.safety.h")}</h4>
        <div class="wf-row">
          <label>${t("wf.safety.limit")} (A)</label>
          <input type="number" id="wf-limit" step="0.1" min="0.1" max="40" value="5.2" style="width:90px" />
          <button class="ok" id="wf-limit-set">${t("wf.apply")}</button>
          <button data-cmd="fault">${t("wf.safety.fault")}</button>
          <button data-cmd="fault clear">${t("wf.safety.clear")}</button>
        </div>
        <div class="wf-row">
          <label>${t("wf.safety.trip")} (A)</label>
          <input type="number" id="wf-trip" step="0.1" min="0.1" max="50" value="6.6" style="width:90px" />
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <div class="wf-row">
          <label>${t("wf.safety.uv")} (V)</label>
          <input type="number" id="wf-uv" step="0.1" min="0" max="50" value="10" style="width:70px" />
          <label>${t("wf.safety.ov")} (V)</label>
          <input type="number" id="wf-ov" step="0.1" min="0" max="60" value="30" style="width:70px" />
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <p class="wf-note">${t("wf.safety.note")}</p>
      </section>`;
  }

  _emptyBoardHtml() {
    const keys = [
      t("wf.device.mcu"),
      t("wf.device.fw"),
      t("board.version"),
      t("wf.motor.pp"),
      t("board.udc"),
      t("board.calib"),
      t("board.fault"),
      t("board.state"),
    ];
    return keys
      .map((k) => `<div class="wf-kv"><span>${k}</span><strong>—</strong></div>`)
      .join("");
  }

  _htmlMotor() {
    const field = (id, label, unit, step, val) => `
      <div class="wf-param">
        <label for="${id}">${label}${unit ? ` <span class="tune-unit">${unit}</span>` : ""}</label>
        <input type="number" id="${id}" step="${step}" value="${val}" />
      </div>`;
    return `
      <h3 class="wf-h">${t("wf.motor.h")}</h3>
      <p class="wf-p">${t("wf.motor.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.motor.params")}</h4>
        <div class="wf-params">
          ${field("wf-pp", t("wf.motor.pp"), "", "1", "7")}
          ${field("wf-rs", t("wf.motor.rs"), "Ω", "0.0001", "0.1")}
          ${field("wf-ls", t("wf.motor.ls"), "µH", "0.01", "20")}
          ${field("wf-ld", t("wf.motor.ld"), "µH", "0.01", "")}
          ${field("wf-lq", t("wf.motor.lq"), "µH", "0.01", "")}
          ${field("wf-flux", t("wf.motor.flux"), "Wb", "0.0001", "")}
          ${field("wf-maxrpm", t("wf.motor.maxrpm"), "rpm", "1", "12000")}
          ${field("wf-limit2", t("wf.motor.limit"), "A", "0.1", "5.2")}
        </div>
        <div class="wf-row">
          <button class="ok" id="wf-read-params">${t("wf.motor.read_params")}</button>
          <button class="ok" data-cmd="ident apply">${t("wf.apply")}</button>
          <button class="danger" data-cmd="conf write" data-confirm="conf write">${t("wf.motor.conf_write")}</button>
          <span class="wf-badge" id="wf-param-src">${t("wf.motor.manual")}</span>
        </div>
        <p class="wf-note">${t("wf.motor.params_note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.motor.auto")}</h4>
        <div class="wf-row">
          <button data-cmd="ident rs">${t("ident.rs")}</button>
          <button class="danger" data-cmd="ident full" data-confirm="ident full">${t("ident.full")}</button>
          <button data-cmd="ident show">${t("ident.show")}</button>
          <button class="danger" data-cmd="calib full" data-confirm="calib full">${t("wf.calib.full")}</button>
          <button data-cmd="disable">${t("dash.ctrl.disable")}</button>
        </div>
        <p class="wf-note">${t("wf.calib.note")}</p>
      </section>`;
  }

  /** 读取 conf read + ident show，填入参数表 */
  async _readMotorParams() {
    const badge = this.root.querySelector("#wf-param-src");
    if (!this.sendCapture) {
      await this._cli("conf read");
      await this._cli("ident show");
      return;
    }
    let text = "";
    try {
      text += await this.sendCapture("conf read", 450);
      text += "\n" + (await this.sendCapture("ident show", 350));
    } catch {
      /* ignore */
    }
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v, scale = 1) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null) el.value = (Number(v) * scale).toFixed(scale === 1 ? 0 : 4);
    };
    set("wf-pp", pick(/pp=([0-9.]+)/));
    // conf: Rs ohm, Ls uH
    const rsConf = pick(/Rs=([0-9.]+)/);
    const lsConf = pick(/Ls=([0-9.]+)/);
    set("wf-rs", rsConf);
    set("wf-ls", lsConf);
    set("wf-maxrpm", pick(/max_rpm=([0-9.]+)/));
    set("wf-limit2", pick(/limit=([0-9.]+)/));
    // ident show 优先覆盖 Rs/Ls
    const rsId = pick(/Rs=([0-9.]+)\s*ohm/i) || pick(/Rs=([0-9.]+)/);
    const lsId = pick(/Ls=([0-9.]+)\s*uH/i) || pick(/Ls=([0-9.]+)/i);
    const ld = pick(/Ld=([0-9.]+)/i);
    const lq = pick(/Lq=([0-9.]+)/i);
    const flux = pick(/flux[^\n=]*=([0-9.]+)/i) || pick(/Ke=([0-9.]+)/i);
    if (rsId) set("wf-rs", rsId);
    if (lsId) set("wf-ls", lsId);
    if (ld) set("wf-ld", ld);
    if (lq) set("wf-lq", lq);
    if (flux) set("wf-flux", flux);
    if (badge) badge.textContent = t("wf.motor.from_device");
  }

  _htmlEncoder() {
    return `
      <h3 class="wf-h">${t("wf.encoder.h")}</h3>
      <p class="wf-p">${t("wf.encoder.p")}</p>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.encoder.type")}</h4>
        <div class="wf-row">
          <label>${t("wf.encoder.kind")}</label>
          <select id="wf-enc-kind">
            <option value="abz">${t("wf.encoder.abz")}</option>
            <option value="sensorless">${t("wf.encoder.sensorless")}</option>
          </select>
          <span class="wf-badge">${t("wf.encoder.kind_note")}</span>
        </div>
        <div class="wf-row">
          <label>CPR</label>
          <input type="number" id="wf-enc-cpr" step="1" min="16" max="65536" value="2048" style="width:90px" />
          <button id="wf-enc-cpr-set">${t("wf.apply")}</button>
          <span class="wf-badge">${t("wf.needs_fw")}</span>
        </div>
        <p class="wf-note">${t("wf.encoder.note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("wf.encoder.source")}</h4>
        <div class="wf-row">
          <button class="ok" data-cmd="angle enc">${t("obs.enc")}</button>
          <button data-cmd="angle ol">${t("obs.ol")}</button>
          <button data-cmd="angle">${t("wf.encoder.query")}</button>
        </div>
        <p class="wf-note">${t("wf.encoder.source_note")}</p>
      </section>

      <section class="wf-card">
        <h4 class="wf-section">${t("obs.title")}</h4>
        <div class="wf-row">
          <button data-cmd="feedback">${t("fb.status")}</button>
          <button data-cmd="feedback sensored">${t("fb.sensored")}</button>
          <button data-cmd="feedback sensorless">${t("fb.sensorless")}</button>
          <button data-cmd="feedback auto">${t("fb.auto")}</button>
        </div>
        <div class="wf-row">
          <button data-cmd="obs">${t("obs.query")}</button>
          <button data-cmd="obs 0">${t("obs.off")}</button>
          <button data-cmd="obs 1">${t("obs.on")}</button>
          <button class="danger" data-cmd="obs 2" data-confirm="obs 2">${t("obs.switch")}</button>
        </div>
        <p class="wf-note">${t("obs.note")}</p>
      </section>`;
  }

  _htmlPid() {
    return `
      <h3 class="wf-h">${t("wf.pid.h")}</h3>
      <p class="wf-p">${t("wf.pid.p")}</p>
      <div class="wf-card">
        <div class="wf-row">
          <label>${t("wf.pid.current_bw")}</label>
          <input type="number" id="wf-bw" min="100" max="5000" step="50" value="2000" style="width:90px" />
        </div>
        <div class="wf-row">
          <label>${t("wf.pid.vel_kp")}</label>
          <input type="number" id="wf-vkp" step="0.01" value="0.02" style="width:80px" />
          <label>${t("wf.pid.vel_ki")}</label>
          <input type="number" id="wf-vki" step="0.01" value="0.02" style="width:80px" />
        </div>
        <div class="wf-row">
          <label>${t("wf.pid.pos_kp")}</label>
          <input type="number" id="wf-pkp" step="0.5" value="10" style="width:80px" />
        </div>
        <div class="wf-row" style="align-items: center; gap: 8px;">
          <button class="ok" id="wf-pid-apply">${t("wf.apply")}</button>
          <button id="wf-pid-read">${t("wf.pid.read")}</button>
          <button class="danger" id="wf-pid-save" data-confirm="conf write">${t("wf.pid.save_flash")}</button>
          <span id="wf-pid-dirty-badge" class="dirty-notice" style="display:none;">${t("wf.pid.dirty")}</span>
          <span class="wf-badge" style="margin-left: auto;">${t("wf.pid.watch_scope")}</span>
        </div>
        <p class="wf-note">${t("wf.pid.note")}</p>
      </div>`;
  }

  _htmlRun() {
    const modes = MODES.map((m) => `<option value="${m.id}">${t(m.key)}</option>`).join("");
    const obs = OBS_COMMANDS.map((c) => {
      const cls = c.danger ? "danger" : "";
      return `<button class="${cls}" data-cmd="${c.cmd}" title="${c.cmd}">${t(c.key)}</button>`;
    }).join(" ");
    return `
      <h3 class="wf-h">${t("wf.run.h")}</h3>
      <p class="wf-p">${t("wf.run.p")}</p>
      <div class="wf-card">
        <div class="wf-row">
          <label>${t("dash.ctrl.mode")}</label>
          <select id="wf-run-mode">${modes}</select>
          <button id="wf-run-mode-set">${t("dash.ctrl.set")}</button>
        </div>
        <div class="wf-row" id="wf-run-target-row">
          <label>${t("dash.ctrl.target")} <span class="dash-unit-tag" id="wf-run-unit">RPM</span></label>
          <input type="range" id="wf-run-range" min="-8000" max="8000" step="10" value="0" style="flex:1;min-width:120px" />
          <input type="number" id="wf-run-num" step="10" value="0" style="width:90px" />
          <button class="ok" id="wf-run-send">${t("dash.ctrl.send")}</button>
        </div>
        <div class="wf-row" id="wf-run-vf-row" hidden>
          <label>Vq (V)</label>
          <input type="number" id="wf-run-vq" step="0.1" value="0.5" style="width:80px" />
          <button class="ok" id="wf-run-vq-send">${t("dash.ctrl.send")}</button>
        </div>
        <div class="wf-row">
          <button class="ok" data-cmd="enable">${t("dash.ctrl.enable")}</button>
          <button data-cmd="disable">${t("dash.ctrl.disable")}</button>
          <button data-cmd="fault">${t("wf.safety.fault")}</button>
        </div>
        <div id="wf-dashboard-host" class="wf-dash-host"></div>
        <div class="wf-sep"></div>
        <div class="wf-h" style="font-size:13px">${t("obs.title")}</div>
        <div class="wf-row">${obs}</div>
        <p class="wf-note">${t("obs.note")}</p>
        <p class="wf-note">${t("wf.run.note")}</p>
      </div>`;
  }

  _wire() {
    this.root.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        const conf = btn.getAttribute("data-confirm");
        if (conf && !confirm(conf)) return;
        this._cli(cmd);
      });
    });
    this.root.querySelector("#wf-read-info")?.addEventListener("click", () => this._readBoardInfo());
    this.root.querySelector("#wf-health-check")?.addEventListener("click", () => this._runHealthCheck());
    this.root.querySelector("#wf-copy-report")?.addEventListener("click", () => this._copyHealthReport());
    this.root.querySelector("#wf-read-params")?.addEventListener("click", () => this._readMotorParams());

    this.root.querySelector("#wf-limit-set")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-limit")?.value);
      if (Number.isFinite(v)) this._cli(`limit ${v}`);
    });
    // 调参：一次应用全部
    this.root.querySelector("#wf-pid-apply")?.addEventListener("click", async () => {
      const bw = Number(this.root.querySelector("#wf-bw")?.value);
      const kp = Number(this.root.querySelector("#wf-vkp")?.value);
      const ki = Number(this.root.querySelector("#wf-vki")?.value);
      const pkp = Number(this.root.querySelector("#wf-pkp")?.value);
      if (Number.isFinite(bw)) await this._cli(`current bw ${bw}`);
      if (Number.isFinite(kp)) await this._cli(`vel kp ${kp}`);
      if (Number.isFinite(ki)) await this._cli(`vel ki ${ki}`);
      if (Number.isFinite(pkp)) await this._cli(`pos kp ${pkp}`);
    });
    this.root.querySelector("#wf-pid-read")?.addEventListener("click", () => this._readPid());
    this.root.querySelector("#wf-pid-save")?.addEventListener("click", async () => {
      const conf = this.root.querySelector("#wf-pid-save")?.getAttribute("data-confirm");
      if (conf && !confirm(conf)) return;
      await this._cli("conf write");
      // 固化后更新基准并触发同步动画
      this._markPidClean();
    });

    // 监听调参输入脏状态
    ["wf-bw", "wf-vkp", "wf-vki", "wf-pkp"].forEach((id) => {
      const input = this.root.querySelector(`#${id}`);
      if (input) {
        // 若基准尚未建立，初始化当前值为基准
        if (this.pidBaseline[id] === undefined) {
          this.pidBaseline[id] = input.value;
        }
        input.addEventListener("input", () => this._checkPidDirty());
      }
    });

    this.root.querySelector("#wf-run-mode-set")?.addEventListener("click", () => {
      const m = this.root.querySelector("#wf-run-mode")?.value;
      if (m) {
        this._cli(`mode ${m}`);
        this._applyRunMeta(m);
      }
    });
    const applyRunMeta = () => {
      const m = this.root.querySelector("#wf-run-mode")?.value || "vel";
      this._applyRunMeta(m);
    };
    this.root.querySelector("#wf-run-mode")?.addEventListener("change", applyRunMeta);
    applyRunMeta();
    const range = this.root.querySelector("#wf-run-range");
    const num = this.root.querySelector("#wf-run-num");
    if (range && num) {
      range.addEventListener("input", () => {
        num.value = range.value;
      });
      num.addEventListener("change", () => {
        range.value = num.value;
      });
    }
    this.root.querySelector("#wf-run-send")?.addEventListener("click", () => {
      const v = Number(num?.value);
      if (!Number.isFinite(v)) return;
      const m = this.root.querySelector("#wf-run-mode")?.value || "vel";
      this._cli(m === "vf" ? `rpm ${v}` : `target ${v}`);
    });
    this.root.querySelector("#wf-run-vq-send")?.addEventListener("click", () => {
      const v = Number(this.root.querySelector("#wf-run-vq")?.value);
      if (Number.isFinite(v)) this._cli(`vq ${v}`);
    });
  }

  /** 从 conf read 解析环路参数填入表单 */
  async _readPid() {
    if (!this.sendCapture) {
      await this._cli("conf read");
      return;
    }
    let text = "";
    try {
      text = await this.sendCapture("conf read", 450);
    } catch {
      /* ignore */
    }
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null) el.value = v;
    };
    set("wf-bw", pick(/bw=([0-9.]+)/));
    // conf 里 vp/vi 对应电流环；速度 kp/ki 可能不在 conf 行 — 仅填存在的
    set("wf-vkp", pick(/vp=([0-9.]+)/));
    set("wf-vki", pick(/vi=([0-9.]+)/));

    // 读取成功后，建立新的基准并清除 dirty 标记
    this._markPidClean();
  }

  _checkPidDirty() {
    let dirtyCount = 0;
    ["wf-bw", "wf-vkp", "wf-vki", "wf-pkp"].forEach((id) => {
      const input = this.root.querySelector(`#${id}`);
      if (!input) return;
      const base = this.pidBaseline[id];
      const isDirty = base !== undefined && input.value.trim() !== String(base).trim();
      input.classList.toggle("is-dirty", isDirty);
      if (isDirty) dirtyCount++;
    });

    const badge = this.root.querySelector("#wf-pid-dirty-badge");
    if (badge) {
      badge.style.display = dirtyCount > 0 ? "inline-flex" : "none";
    }
  }

  _markPidClean() {
    ["wf-bw", "wf-vkp", "wf-vki", "wf-pkp"].forEach((id) => {
      const input = this.root.querySelector(`#${id}`);
      if (!input) return;
      this.pidBaseline[id] = input.value;
      input.classList.remove("is-dirty");
      input.classList.add("is-synced");
      setTimeout(() => input.classList.remove("is-synced"), 1200);
    });
    const badge = this.root.querySelector("#wf-pid-dirty-badge");
    if (badge) {
      badge.style.display = "none";
    }
  }

  _applyRunMeta(mode) {
    const mc = MODE_CONTROLS[mode] || MODE_CONTROLS.vel;
    const useVf = mode === "vf";
    const meta = useVf ? { unit: "RPM", min: -8000, max: 8000, step: 10 } : mc.target || { unit: "RPM", min: -8000, max: 8000, step: 10 };
    const unit = this.root.querySelector("#wf-run-unit");
    if (unit) unit.textContent = meta.unit;
    const range = this.root.querySelector("#wf-run-range");
    const num = this.root.querySelector("#wf-run-num");
    if (range) {
      range.min = String(meta.min);
      range.max = String(meta.max);
      range.step = String(meta.step);
    }
    if (num) {
      num.min = String(meta.min);
      num.max = String(meta.max);
      num.step = String(meta.step);
    }
    const vfRow = this.root.querySelector("#wf-run-vf-row");
    if (vfRow) vfRow.hidden = !useVf;
  }
}

export { STEPS as WORKFLOW_STEPS };
