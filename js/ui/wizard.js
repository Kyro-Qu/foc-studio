/**
 * 六步调试工作流 UI — 超前于固件的能力也先做在上位机里。
 * 每步发既有 CLI；无固件命令时给出说明并禁用或标为「待固件」。
 */

import { t } from "../i18n.js";
import { OBS_COMMANDS } from "./console.js";

const STEPS = [
  { id: "device", key: "wf.device" },
  { id: "motor", key: "wf.motor" },
  { id: "encoder", key: "wf.encoder" },
  { id: "pid", key: "wf.pid" },
  { id: "run", key: "wf.run" },
];

export const PID_INPUT_IDS = [
  "wf-bw",
  "wf-limit-val",
  "wf-vkp",
  "wf-vki",
  "wf-vramp",
  "wf-vfilt",
  "wf-vff",
  "wf-vtrack",
  "wf-pkp",
  "wf-pki",
  "wf-pvkp",
  "wf-paccel",
  "wf-pvmax",
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

    const items = [
      {
        id: "mcu",
        label: t("wf.device.mcu"),
        val: info.board,
        tag: "BOARD",
        highlight: info.board !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/><path d="M1 5.5h1.5M1 8h1.5M1 10.5h1.5M13.5 5.5h1.5M13.5 8h1.5M13.5 10.5h1.5M5.5 1v1.5M8 1v1.5M10.5 1v1.5M5.5 13.5v1.5M8 13.5v1.5M10.5 13.5v1.5"/></svg>`,
      },
      {
        id: "fw",
        label: t("wf.device.fw"),
        val: info.version !== "—" ? `${info.firmware} v${info.version}` : "—",
        tag: "VERSION",
        highlight: info.version !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/><path d="M5 7l2 2-2 2M9 11h3"/></svg>`,
      },
      {
        id: "vbus",
        label: t("board.udc"),
        val: info.vbus !== "—" ? `${info.vbus} V` : "—",
        tag: "POWER",
        highlight: info.vbus !== "—",
        valClass: Number(info.vbus) > 10 ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="8.5,1.5 3.5,9 7.5,9 6.5,14.5 12.5,7 8.5,7" fill="rgba(56,189,248,0.2)"/></svg>`,
      },
      {
        id: "state",
        label: t("board.state"),
        val: info.state !== "—" ? `${info.state} (${info.mode || "—"})` : "—",
        tag: "CONTROL",
        highlight: info.state !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><polygon points="6.5,5 11,8 6.5,11" fill="currentColor"/></svg>`,
      },
      {
        id: "calib",
        label: t("board.calib"),
        val: calibVal,
        tag: "ANGLE",
        highlight: info.calibValid,
        valClass: info.calibValid ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>`,
      },
      {
        id: "fault",
        label: t("board.fault"),
        val: `${info.faultCode} (${info.faultName})`,
        tag: "HEALTH",
        highlight: true,
        valClass: info.faultCode === 0 ? "text-ok" : "text-err",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>`,
      },
      {
        id: "motor",
        label: t("wf.motor.pp"),
        val: info.pole_pairs !== "—" ? `${info.pole_pairs} 极对 (CPR: ${info.encoder_cpr})` : "—",
        tag: "ROTOR",
        highlight: info.pole_pairs !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/></svg>`,
      },
      {
        id: "rpm",
        label: t("wf.motor.maxrpm"),
        val: info.max_rpm !== "—" ? `${info.max_rpm} RPM` : "—",
        tag: "LIMIT",
        highlight: info.max_rpm !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a7 7 0 1 1 10 0"/><path d="M8 8l3-3"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>`,
      },
      {
        id: "cpu",
        label: "CPU 负荷",
        val: info.cpu !== "—" ? `${info.cpu}% (峰值 ${info.cpuMax || "—"}%)` : "—",
        tag: "PERF",
        highlight: info.cpu !== "—",
        valClass: Number(info.cpu) < 80 ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h12M4 10l2.5-4 3 5 2.5-3"/></svg>`,
      },
      {
        id: "reset",
        label: "复位来源",
        val: info.rstDesc,
        tag: "BOOT",
        highlight: info.rstDesc !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 1 1 1.8 4.2M2 12V8h4"/></svg>`,
      },
      {
        id: "cs",
        label: "电流采样",
        val: info.csReady !== null ? `就绪: ${info.csReady} | 故障: ${info.csFault} | 丢拍: ${info.rejected ?? 0}` : "—",
        tag: "SENSE",
        highlight: info.csReady !== null,
        valClass: (info.csFault === 0 && (info.rejected ?? 0) === 0) ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>`,
      },
      {
        id: "cli",
        label: "通信吞吐",
        val: info.cliRxOverflow !== null ? `溢出: ${info.cliRxOverflow} B | 构建: ${info.build}` : "—",
        tag: "COMM",
        highlight: info.cliRxOverflow !== null,
        valClass: info.cliRxOverflow === 0 ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 8h6M5 10h4"/></svg>`,
      },
    ];

    box.innerHTML = items
      .map(
        (it) => `
        <div class="wf-tile ${it.highlight ? "has-val" : ""}">
          <div class="tile-header">
            <div class="tile-icon-box">${it.icon}</div>
            <div class="tile-meta">
              <span class="tile-label">${it.label}</span>
              <span class="tile-tag">${it.tag}</span>
            </div>
          </div>
          <div class="tile-val-box">
            <strong class="tile-val ${it.valClass || ""}">${it.val}</strong>
          </div>
        </div>`
      )
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

      <!-- 独立卡片 1：板卡硬件与运行指标 (12项圆角磁贴卡片) -->
      <section class="wf-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <h4 class="wf-section" style="margin:0">${t("wf.device.info")}</h4>
          <div class="wf-row" style="gap:8px">
            <button class="ok" id="wf-read-info">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.device.read")}</span>
            </button>
            <button id="wf-diag-fault-btn" data-cmd="fault">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>
              <span>${t("wf.safety.fault")}</span>
            </button>
            <button class="danger" id="wf-diag-clear-btn" data-cmd="fault clear">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>
              <span>${t("wf.safety.clear")}</span>
            </button>
          </div>
        </div>
        <div id="wf-board-info" class="wf-board">
          ${this._emptyBoardHtml()}
        </div>
      </section>

      <!-- 独立卡片 2：系统健康体检与智能诊断 -->
      <section class="wf-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <h4 class="wf-section" style="margin:0">${t("wf.device.health_title")}</h4>
          <div class="wf-row" style="gap:8px">
            <button class="btn-primary" id="wf-health-check">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8.5l3.5 3.5L14 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.device.self_check")}</span>
            </button>
            <button id="wf-copy-report">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="8" height="10" rx="1.5"/><path d="M4 2.5h6.5a1.5 1.5 0 0 1 1.5 1.5v6" stroke-linecap="round"/></svg>
              <span>${t("wf.device.copy_report")}</span>
            </button>
          </div>
        </div>
        <div id="wf-health-card" class="health-check-card">
          <div class="health-empty-state">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.45;color:var(--accent)">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            <span>点击上方「开始体检诊断」，将对硬件电压、校准源、复位状态、电流采样及 CPU 负载进行 6 维健康排查与智能打分</span>
          </div>
        </div>
      </section>

      <section class="wf-card">
        <div class="safety-head">
          <h4 class="wf-section">${t("wf.safety.h")}</h4>
          <button class="ok" id="wf-limit-set">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.apply")}</span>
          </button>
        </div>
        <div class="safety-grid">
          <div class="safety-item">
            <label for="wf-limit">${t("wf.safety.limit")}</label>
            <div class="safety-input">
              <input type="number" id="wf-limit" step="0.1" min="0.1" max="40" value="5.2" />
              <span class="unit">A</span>
            </div>
          </div>
          <div class="safety-item">
            <label for="wf-trip">${t("wf.safety.trip")}</label>
            <div class="safety-input">
              <input type="number" id="wf-trip" step="0.1" min="0.1" max="50" value="6.6" />
              <span class="unit">A</span>
            </div>
            <span class="wf-badge">${t("wf.needs_fw")}</span>
          </div>
          <div class="safety-item">
            <label for="wf-uv">${t("wf.safety.uv")}</label>
            <div class="safety-input">
              <input type="number" id="wf-uv" step="0.1" min="0" max="50" value="10" />
              <span class="unit">V</span>
            </div>
          </div>
          <div class="safety-item">
            <label for="wf-ov">${t("wf.safety.ov")}</label>
            <div class="safety-input">
              <input type="number" id="wf-ov" step="0.1" min="0" max="60" value="30" />
              <span class="unit">V</span>
            </div>
            <span class="wf-badge">${t("wf.needs_fw")}</span>
          </div>
        </div>
        <p class="wf-note">${t("wf.safety.note")}</p>
      </section>`;
  }

  _emptyBoardHtml() {
    const defaultItems = [
      {
        id: "mcu",
        label: t("wf.device.mcu"),
        val: "—",
        tag: "BOARD",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/><path d="M1 5.5h1.5M1 8h1.5M1 10.5h1.5M13.5 5.5h1.5M13.5 8h1.5M13.5 10.5h1.5M5.5 1v1.5M8 1v1.5M10.5 1v1.5M5.5 13.5v1.5M8 13.5v1.5M10.5 13.5v1.5"/></svg>`,
      },
      {
        id: "fw",
        label: t("wf.device.fw"),
        val: "—",
        tag: "VERSION",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/><path d="M5 7l2 2-2 2M9 11h3"/></svg>`,
      },
      {
        id: "vbus",
        label: t("board.udc"),
        val: "—",
        tag: "POWER",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="8.5,1.5 3.5,9 7.5,9 6.5,14.5 12.5,7 8.5,7" fill="rgba(56,189,248,0.2)"/></svg>`,
      },
      {
        id: "state",
        label: t("board.state"),
        val: "—",
        tag: "CONTROL",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><polygon points="6.5,5 11,8 6.5,11" fill="currentColor"/></svg>`,
      },
      {
        id: "calib",
        label: t("board.calib"),
        val: "—",
        tag: "ANGLE",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>`,
      },
      {
        id: "fault",
        label: t("board.fault"),
        val: "—",
        tag: "HEALTH",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>`,
      },
      {
        id: "motor",
        label: t("wf.motor.pp"),
        val: "—",
        tag: "ROTOR",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/></svg>`,
      },
      {
        id: "rpm",
        label: t("wf.motor.maxrpm"),
        val: "—",
        tag: "LIMIT",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a7 7 0 1 1 10 0"/><path d="M8 8l3-3"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>`,
      },
      {
        id: "cpu",
        label: "CPU 负荷",
        val: "—",
        tag: "PERF",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h12M4 10l2.5-4 3 5 2.5-3"/></svg>`,
      },
      {
        id: "reset",
        label: "复位来源",
        val: "—",
        tag: "BOOT",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 1 1 1.8 4.2M2 12V8h4"/></svg>`,
      },
      {
        id: "cs",
        label: "电流采样",
        val: "—",
        tag: "SENSE",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>`,
      },
      {
        id: "cli",
        label: "通信吞吐",
        val: "—",
        tag: "COMM",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 8h6M5 10h4"/></svg>`,
      },
    ];

    return defaultItems
      .map(
        (it) => `
        <div class="wf-tile ${it.highlight ? "has-val" : "is-empty"}">
          <div class="tile-header">
            <div class="tile-icon-box">${it.icon}</div>
            <div class="tile-meta">
              <span class="tile-label">${it.label}</span>
              <span class="tile-tag">${it.tag}</span>
            </div>
          </div>
          <div class="tile-val-box">
            <strong class="tile-val ${it.valClass || ""}">${it.val}</strong>
          </div>
        </div>`
      )
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
          <button class="ok" id="wf-read-params">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.motor.read_params")}</span>
          </button>
          <button class="ok" data-cmd="ident apply">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.apply")}</span>
          </button>
          <button class="danger" data-cmd="conf write" data-confirm="conf write">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
            <span>${t("wf.motor.conf_write")}</span>
          </button>
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

      <!-- 1. 电流环整定与保护限幅 -->
      <div class="wf-card">
        <h4 class="wf-section">${t("wf.pid.title_current")}</h4>
        <div class="wf-tuning-grid">
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.current_bw")}</span>
              <span class="wf-field-unit">rad/s</span>
            </div>
            <input type="number" id="wf-bw" min="100" max="3000" step="50" value="2000" />
            <span class="wf-field-hint">自动整定 d/q 轴 Kp/Ki (100~3000)</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.limit")}</span>
              <span class="wf-field-unit">A</span>
            </div>
            <input type="number" id="wf-limit-val" min="0.1" max="15.0" step="0.1" value="2.0" />
            <span class="wf-field-hint">电机运行相电流软保护限幅 (limit)</span>
          </div>
        </div>
      </div>

      <!-- 2. 速度环与运动加减速规划 -->
      <div class="wf-card">
        <h4 class="wf-section">${t("wf.pid.title_vel")}</h4>
        <div class="wf-tuning-grid">
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_kp")}</span>
              <span class="wf-field-unit">A/RPM</span>
            </div>
            <input type="number" id="wf-vkp" min="0" max="2.0" step="0.005" value="0.02" />
            <span class="wf-field-hint">比例增益，响应刚度</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_ki")}</span>
              <span class="wf-field-unit">A/(RPM·s)</span>
            </div>
            <input type="number" id="wf-vki" min="0" max="5.0" step="0.005" value="0.02" />
            <span class="wf-field-hint">积分增益，消除稳态转速静差</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_ramp")}</span>
              <span class="wf-field-unit">RPM/s</span>
            </div>
            <input type="number" id="wf-vramp" min="0" max="100000" step="500" value="10000" />
            <span class="wf-field-hint">速度斜坡率，0=直通无斜坡</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_filter")}</span>
              <span class="wf-field-unit">Hz</span>
            </div>
            <input type="number" id="wf-vfilt" min="5" max="200" step="5" value="50" />
            <span class="wf-field-hint">测速反馈一阶低通截止频率</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_ff")}</span>
              <span class="wf-field-unit">A</span>
            </div>
            <input type="number" id="wf-vff" min="0" max="2.0" step="0.01" value="0.0" />
            <span class="wf-field-hint">静摩擦阻力矩前馈补偿</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.vel_track")}</span>
              <span class="wf-field-unit">A/rad</span>
            </div>
            <input type="number" id="wf-vtrack" min="0" max="100" step="0.1" value="0.0" />
            <span class="wf-field-hint">抗扰动角度跟踪刚度</span>
          </div>
        </div>
      </div>

      <!-- 3. 位置环与轨迹参数整定 -->
      <div class="wf-card">
        <h4 class="wf-section">${t("wf.pid.title_pos")}</h4>
        <div class="wf-tuning-grid">
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.pos_kp")}</span>
              <span class="wf-field-unit">A/rad</span>
            </div>
            <input type="number" id="wf-pkp" min="0" max="500" step="0.5" value="10" />
            <span class="wf-field-hint">位置环比例刚度</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.pos_ki")}</span>
              <span class="wf-field-unit">A/(rad·s)</span>
            </div>
            <input type="number" id="wf-pki" min="0" max="50" step="0.05" value="0" />
            <span class="wf-field-hint">位置积分，消除稳态位置误差</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.pos_vkp")}</span>
              <span class="wf-field-unit">A/RPM</span>
            </div>
            <input type="number" id="wf-pvkp" min="0" max="0.5" step="0.002" value="0.02" />
            <span class="wf-field-hint">速度微分阻尼，抑制位置强摆晃动</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.pos_accel")}</span>
              <span class="wf-field-unit">RPM/s</span>
            </div>
            <input type="number" id="wf-paccel" min="100" max="100000" step="500" value="5000" />
            <span class="wf-field-hint">梯形加减速轨迹规划加速度</span>
          </div>
          <div class="wf-field">
            <div class="wf-field-label">
              <span>${t("wf.pid.pos_vmax")}</span>
              <span class="wf-field-unit">RPM</span>
            </div>
            <input type="number" id="wf-pvmax" min="100" max="10000" step="100" value="3000" />
            <span class="wf-field-hint">位置运动过程中的最高巡航转速</span>
          </div>
        </div>
      </div>

      <!-- 操作工具栏与持久化按钮 -->
      <div class="wf-card" style="padding:14px 18px">
        <div class="wf-row" style="align-items: center; gap: 10px;">
          <button class="ok" id="wf-pid-apply">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.apply")}</span>
          </button>
          <button id="wf-pid-read">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.pid.read")}</span>
          </button>
          <button class="danger" id="wf-pid-save" data-confirm="conf write">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
            <span>${t("wf.pid.save_flash")}</span>
          </button>
          <span id="wf-pid-dirty-badge" class="dirty-notice" style="display:none;">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="8" r="7" opacity="0.2"/><circle cx="8" cy="8" r="4"/></svg>
            <span>${t("wf.pid.dirty")}</span>
          </span>
          <span class="wf-badge" style="margin-left: auto;">${t("wf.pid.watch_scope")}</span>
        </div>
        <p class="wf-note" style="margin-top:10px">${t("wf.pid.note")}</p>
      </div>`;
  }

  _htmlRun() {
    const obs = OBS_COMMANDS.map((c) => {
      const cls = c.danger ? "danger" : "";
      return `<button class="${cls}" data-cmd="${c.cmd}" title="${c.cmd}">${t(c.key)}</button>`;
    }).join(" ");
    return `
      <h3 class="wf-h">${t("wf.run.h")}</h3>
      <p class="wf-p">${t("wf.run.p")}</p>
      <div class="wf-card" style="gap:16px">
        <div id="wf-dashboard-host" class="wf-dash-host" style="margin:0"></div>
        <div class="wf-sep"></div>
        <div>
          <h4 class="wf-section" style="margin:0 0 10px">${t("obs.title")}</h4>
          <div class="wf-row">${obs}</div>
          <p class="wf-note" style="margin-top:8px">${t("obs.note")}</p>
          <p class="wf-note">${t("wf.run.note")}</p>
        </div>
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
      const limitVal = Number(this.root.querySelector("#wf-limit-val")?.value);
      const vkp = Number(this.root.querySelector("#wf-vkp")?.value);
      const vki = Number(this.root.querySelector("#wf-vki")?.value);
      const vramp = Number(this.root.querySelector("#wf-vramp")?.value);
      const vfilt = Number(this.root.querySelector("#wf-vfilt")?.value);
      const vff = Number(this.root.querySelector("#wf-vff")?.value);
      const vtrack = Number(this.root.querySelector("#wf-vtrack")?.value);
      const pkp = Number(this.root.querySelector("#wf-pkp")?.value);
      const pki = Number(this.root.querySelector("#wf-pki")?.value);
      const pvkp = Number(this.root.querySelector("#wf-pvkp")?.value);
      const paccel = Number(this.root.querySelector("#wf-paccel")?.value);
      const pvmax = Number(this.root.querySelector("#wf-pvmax")?.value);

      if (Number.isFinite(bw)) await this._cli(`current bw ${bw}`);
      if (Number.isFinite(limitVal)) await this._cli(`limit ${limitVal}`);
      if (Number.isFinite(vkp)) await this._cli(`vel kp ${vkp}`);
      if (Number.isFinite(vki)) await this._cli(`vel ki ${vki}`);
      if (Number.isFinite(vramp)) await this._cli(`vel ramp ${vramp}`);
      if (Number.isFinite(vfilt)) await this._cli(`vel filter ${vfilt}`);
      if (Number.isFinite(vff)) await this._cli(`vel ff ${vff}`);
      if (Number.isFinite(vtrack)) await this._cli(`vel track ${vtrack}`);
      if (Number.isFinite(pkp)) await this._cli(`pos kp ${pkp}`);
      if (Number.isFinite(pki)) await this._cli(`pos ki ${pki}`);
      if (Number.isFinite(pvkp)) await this._cli(`pos vkp ${pvkp}`);
      if (Number.isFinite(paccel)) await this._cli(`pos accel ${paccel}`);
      if (Number.isFinite(pvmax)) await this._cli(`pos vmax ${pvmax}`);
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
    PID_INPUT_IDS.forEach((id) => {
      const input = this.root.querySelector(`#${id}`);
      if (input) {
        // 若基准尚未建立，初始化当前值为基准
        if (this.pidBaseline[id] === undefined) {
          this.pidBaseline[id] = input.value;
        }
        input.addEventListener("input", () => this._checkPidDirty());
      }
    });
  }

  /** 从 conf read / vel / pos 等解析环路参数填入表单 */
  async _readPid() {
    if (!this.sendCapture) {
      await this._cli("conf read");
      return;
    }
    const pick = (text, re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null) el.value = v;
    };

    // 1. 读取 conf read (提取 bw, limit, vp/vi 等)
    try {
      const confText = await this.sendCapture("conf read", 450);
      set("wf-bw", pick(confText, /bw=([0-9.]+)/));
      set("wf-limit-val", pick(confText, /limit=([0-9.]+)/));
      set("wf-vkp", pick(confText, /vp=([0-9.]+)/));
      set("wf-vki", pick(confText, /vi=([0-9.]+)/));
      set("wf-pkp", pick(confText, /pos_kp=([0-9.]+)/));
    } catch {
      /* ignore */
    }

    // 2. 读取 vel 详细参数 (kp, ki, filter, ramp, ff, track)
    try {
      const velText = await this.sendCapture("vel", 350);
      set("wf-vkp", pick(velText, /kp=([0-9.]+)/));
      set("wf-vki", pick(velText, /ki=([0-9.]+)/));
      set("wf-vfilt", pick(velText, /filter_high=([0-9.]+)Hz/));
      set("wf-vramp", pick(velText, /ramp=([0-9.]+)RPM\/s/));
      set("wf-vff", pick(velText, /ff=([0-9.]+)A/));
      set("wf-vtrack", pick(velText, /track=([0-9.]+)A\/rad/));
    } catch {
      /* ignore */
    }

    // 3. 读取 pos 详细参数 (kp, ki, vkp, accel, vmax)
    try {
      const posText = await this.sendCapture("pos", 350);
      set("wf-pkp", pick(posText, /kp=([0-9.]+)A\/rad/));
      set("wf-pki", pick(posText, /ki=([0-9.]+)A\/\(rad\*s\)/));
      set("wf-pvkp", pick(posText, /vkp=([0-9.]+)A\/RPM/));
      set("wf-paccel", pick(posText, /accel=([0-9.]+)RPM\/s/));
      set("wf-pvmax", pick(posText, /vmax=([0-9.]+)RPM/));
    } catch {
      /* ignore */
    }

    // 读取成功后，建立新的基准并清除 dirty 标记
    this._markPidClean();
  }

  _checkPidDirty() {
    let dirtyCount = 0;
    PID_INPUT_IDS.forEach((id) => {
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
    PID_INPUT_IDS.forEach((id) => {
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
}

export { STEPS as WORKFLOW_STEPS };
