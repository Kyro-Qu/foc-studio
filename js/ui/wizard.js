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
   * @param {{send:(cmd:string)=>Promise<void>|void, isConnected?:()=>boolean, getStatus?:()=>object|null}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.send = opts.send;
    /** @type {(cmd:string,ms?:number)=>Promise<string>|undefined} */
    this.sendCapture = opts.sendCapture;
    this.isConnected = opts.isConnected || (() => true);
    this.getStatus = opts.getStatus || (() => null);
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
      text += "\n" + (await this.sendCapture("limit", 300));
      text += "\n" + (await this.sendCapture("vbus", 300));
    } catch {
      /* ignore */
    }
    this._latestBoardText = text;
    this._renderBoardInfo(text);
    this._fillSafetyInputs(text);
    if (box) box.classList.remove("loading");
  }

  /** 从板卡回显文本中提取并回填安全与保护输入框 */
  _fillSafetyInputs(text) {
    if (!text) return;
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v, decimals = null) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null && v !== "") {
        const num = Number(v);
        if (Number.isFinite(num)) {
          el.value = decimals != null ? num.toFixed(decimals) : String(num);
        }
      }
    };

    const limitVal = pick(/limit=([0-9.]+)/i);
    const tripVal = pick(/trip=([0-9.]+)/i);
    const uvVal = pick(/uv=([0-9.]+)/i);
    const ovVal = pick(/ov=([0-9.]+)/i);

    if (limitVal) set("wf-limit", limitVal, 1);
    if (tripVal) {
      set("wf-trip", tripVal, 2);
    } else if (limitVal) {
      const lim = Number(limitVal);
      const trip = Math.min(Math.max(lim * 1.25 + 0.1, lim), 40.0);
      set("wf-trip", trip, 2);
    }
    if (uvVal) set("wf-uv", uvVal, 1);
    if (ovVal) set("wf-ov", ovVal, 1);
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

    // 联动刷新顶栏 CPU 负荷率（兜底与校准）
    const topCpu = document.getElementById("tb-cpu");
    if (topCpu && info.cpu !== "—" && Number.isFinite(Number(info.cpu))) {
      topCpu.textContent = `${Math.round(Number(info.cpu))}%`;
    }

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
        val: info.pole_pairs !== "—" ? `${info.pole_pairs} (CPR: ${info.encoder_cpr})` : "—",
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
        label: t("board.cpu"),
        val: info.cpu !== "—" ? `${info.cpu}% (peak ${info.cpuMax || "—" }%)` : "—",
        tag: "PERF",
        highlight: info.cpu !== "—",
        valClass: Number(info.cpu) < 80 ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h12M4 10l2.5-4 3 5 2.5-3"/></svg>`,
      },
      {
        id: "reset",
        label: t("board.reset"),
        val: info.rstDesc,
        tag: "BOOT",
        highlight: info.rstDesc !== "—",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 1 1 1.8 4.2M2 12V8h4"/></svg>`,
      },
      {
        id: "cs",
        label: t("board.cs"),
        val: info.csReady !== null ? `ready ${info.csReady} | fault ${info.csFault} | drop ${info.rejected ?? 0}` : "—",
        tag: "SENSE",
        highlight: info.csReady !== null,
        valClass: (info.csFault === 0 && (info.rejected ?? 0) === 0) ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>`,
      },
      {
        id: "cli",
        label: t("board.comm"),
        val: info.cliRxOverflow !== null ? `ovf ${info.cliRxOverflow} B | ${info.build}` : "—",
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

    const itemsHtml = diag.checks
      .map((c) => {
        const itemClass = c.status === "ok" ? "item-ok" : c.status === "warn" ? "item-warn" : "item-bad";
        // ok → 绿对勾；warn/bad → 红点
        const icon =
          c.status === "ok"
            ? `<span class="diag-dot diag-ok">✔</span>`
            : `<span class="diag-dot diag-bad"></span>`;
        return `
          <div class="health-item ${itemClass}">
            ${icon}
            <strong style="min-width:90px">${c.name}</strong>
            <span>${c.msg}</span>
          </div>`;
      })
      .join("");

    card.innerHTML = `<div class="health-items">${itemsHtml}</div>`;
  }

  render() {
    // 保护：Dashboard 会被挂到 #wf-dashboard-host，清空前先挪回隐藏容器，
    // 否则 innerHTML="" 会销毁节点，再进控制台就空白。
    const dash = this.root.querySelector("#dashboard");
    if (dash) {
      document.getElementById("panel-dashboard-hidden")?.appendChild(dash);
    }
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
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.device.info")}</h4>
          <div class="wf-card-actions">
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

      <!-- 安全与保护 -->
      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.safety.h")}</h4>
          <div class="wf-card-actions">
            <button class="ok" id="wf-limit-set">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.apply")}</span>
            </button>
            <button class="danger" data-cmd="conf write" data-confirm="conf write" title="${t("wf.motor.conf_write_tip")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.conf_write")}</span>
            </button>
          </div>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            <div class="form-row">
              <label for="wf-limit">${t("wf.safety.limit")}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-limit" step="0.1" min="0.1" max="40" value="5.2" />
                  <span class="num-unit">A</span>
                </div>
              </div>
            </div>
            <div class="form-row">
              <label for="wf-trip">${t("wf.safety.trip")}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-trip" step="0.1" min="0.1" max="50" value="6.6" readonly style="opacity:0.85;cursor:not-allowed;background:var(--bg-card-subtle, rgba(255,255,255,0.03));" title="根据电流软限自动推算：clamp(limit * 1.25 + 0.1, limit, hard_limit)" />
                  <span class="num-unit">A</span>
                </div>
              </div>
            </div>
          </div>
          <div class="form-list">
            <div class="form-row">
              <label for="wf-uv">${t("wf.safety.uv")}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-uv" step="0.1" min="0" max="50" value="10" />
                  <span class="num-unit">V</span>
                </div>
              </div>
            </div>
            <div class="form-row">
              <label for="wf-ov">${t("wf.safety.ov")}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-ov" step="0.1" min="0" max="60" value="30" />
                  <span class="num-unit">V</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 系统诊断 -->
      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.device.health_title")}</h4>
          <div class="wf-card-actions">
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
            <span>${t("wf.diag.empty")}</span>
          </div>
        </div>
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
        label: t("board.cpu"),
        val: "—",
        tag: "PERF",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h12M4 10l2.5-4 3 5 2.5-3"/></svg>`,
      },
      {
        id: "reset",
        label: t("board.reset"),
        val: "—",
        tag: "BOOT",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 1 1 1.8 4.2M2 12V8h4"/></svg>`,
      },
      {
        id: "cs",
        label: t("board.cs"),
        val: "—",
        tag: "SENSE",
        highlight: false,
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>`,
      },
      {
        id: "cli",
        label: t("board.comm"),
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
    const row = (id, label, unit, step, val) => `
      <div class="form-row">
        <label for="${id}">${label}</label>
        <div class="form-row-trail">
          <div class="num-field">
            <input type="number" id="${id}" step="${step}" value="${val}" />
            <span class="num-unit">${unit || ""}</span>
          </div>
        </div>
      </div>`;
    return `
      <h3 class="wf-h">${t("wf.motor.h")}</h3>
      <p class="wf-p">${t("wf.motor.p")}</p>

      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.motor.params")}</h4>
          <div class="wf-card-actions">
            <button class="ok" id="wf-read-params">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.read_params")}</span>
            </button>
            <button id="wf-motor-export" title="${t("wf.motor.export") || "导出参数"}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2v9M4 7l4 4 4-4M2 13h12" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.export") || "导出参数"}</span>
            </button>
            <button id="wf-motor-import" title="${t("wf.motor.import") || "导入参数"}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 11V2M4 6l4-4 4 4M2 13h12" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.import") || "导入参数"}</span>
            </button>
            <input type="file" id="wf-motor-import-file" accept=".json" style="display:none;" />
            <button class="danger" id="btn-action-ident" title="${t("ident.full")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 1.5l-5 7h4l-1 6 6-8h-4l1.5-5" stroke-linejoin="round"/></svg>
              <span>${t("ident.full")}</span>
            </button>
            <button class="ok" data-cmd="ident apply" data-toast="wf.motor.apply_done">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.apply")}</span>
            </button>
            <button class="danger" data-cmd="conf write" data-confirm="conf write" title="${t("wf.motor.conf_write_tip")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.conf_write")}</span>
            </button>
            <span class="wf-badge" id="wf-param-src">${t("wf.motor.manual")}</span>
          </div>
        </div>
        <div id="wf-ident-status" class="task-progress" data-task="ident" hidden>
          <div class="task-progress-bar"><i></i></div>
          <span class="task-progress-text"></span>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            <div class="form-row">
              <label for="wf-motor-name">${t("wf.motor.name") || "电机型号"}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="text" id="wf-motor-name" placeholder="${t("wf.motor.name_ph") || "如 DJI_2312S、F40"}" value="DJI_2312S" style="text-align:center;padding:0 8px;" />
                </div>
              </div>
            </div>
            ${row("wf-pp", t("wf.motor.pp") || "极对数", "", "1", "7")}
            ${row("wf-rs", t("wf.motor.rs") || "相电阻", "Ω", "0.0001", "0.1")}
            ${row("wf-ls", t("wf.motor.ls") || "相电感", "µH", "0.01", "20")}
            ${row("wf-maxrpm", t("wf.motor.maxrpm") || "最大转速", "rpm", "1", "12000")}
          </div>
          <div class="form-list">
            ${row("wf-ld", t("wf.motor.ld") || "d 轴电感", "µH", "0.01", "")}
            ${row("wf-lq", t("wf.motor.lq") || "q 轴电感", "µH", "0.01", "")}
            <div class="form-row">
              <label for="wf-saliency">${t("wf.motor.saliency") || "凸极比 (Lq/Ld)"}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-saliency" step="0.001" readonly placeholder="1.000" style="background:var(--bg-subtle, rgba(255,255,255,0.03));cursor:default;" />
                  <span class="num-unit" id="wf-saliency-unit">比值</span>
                </div>
              </div>
            </div>
            ${row("wf-flux", t("wf.motor.flux") || "磁链", "Wb", "0.0001", "")}
            ${row("wf-limit2", t("wf.motor.limit") || "电流限幅", "A", "0.1", "5.2")}
          </div>
        </div>
        <p class="wf-note">${t("wf.motor.params_note")}</p>
      </section>`;
  }

  /** 任务进度：倒计时 + 进度条 + 完成 Toast */
  _startTaskProgress(label, durationMs, boxSelector = "#wf-ident-status") {
    const box = this.root.querySelector(boxSelector);
    const fill = box?.querySelector(".task-progress-bar i");
    const text = box?.querySelector(".task-progress-text");
    if (!box || !fill || !text) {
      return { tick: () => {}, done: () => {}, fail: () => {} };
    }
    box.hidden = false;
    box.classList.remove("is-ok", "is-err");
    box.classList.add("is-run");
    const bar0 = box.querySelector(".task-progress-bar");
    if (bar0) bar0.hidden = false;
    fill.style.width = "0%";
    const t0 = Date.now();
    const total = Math.max(1, durationMs);
    text.textContent = `${label} 0%`;
    const bar = box?.querySelector(".task-progress-bar");
    const timer = setInterval(() => {
      const el = Math.min(1, (Date.now() - t0) / total);
      const pct = Math.floor(el * 100);
      fill.style.width = `${pct}%`;
      const left = Math.max(0, Math.ceil((total - (Date.now() - t0)) / 1000));
      text.textContent = `${label} ${pct}% · ${t("wf.task.left", { n: left })}`;
    }, 200);
    const stop = () => clearInterval(timer);
    return {
      done: (msg) => {
        stop();
        box.classList.remove("is-run");
        box.classList.add("is-ok");
        // 完成后收起进度条，只保留文案
        if (bar) bar.hidden = true;
        text.textContent = msg || `✔ ${t("wf.task.done")}`;
        this._toast(msg || t("wf.task.done"), "ok");
      },
      fail: (msg) => {
        stop();
        box.classList.remove("is-run");
        box.classList.add("is-err");
        if (bar) bar.hidden = true;
        text.textContent = msg || `✖ ${t("wf.task.fail")}`;
        this._toast(msg || t("wf.task.fail"), "err");
      },
      tick: stop,
    };
  }

  _toast(msg, kind = "ok") {
    let host = document.getElementById("wf-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "wf-toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `wf-toast wf-toast-${kind}`;
    el.innerHTML = `<span class="wf-toast-ico">${kind === "ok" ? "✔" : "✖"}</span><span>${msg}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 280);
    }, 4200);
  }

  /** 读取 conf read + ident show，填入参数表 */
  async _readMotorParams(opts = {}) {
    const silent = !!opts.silent;
    const badge = this.root.querySelector("#wf-param-src");
    if (!this.sendCapture) {
      await this._cli("conf read");
      await this._cli("ident show");
      return;
    }
    let text = "";
    try {
      text += await this.sendCapture("conf read", 500);
      text += "\n" + (await this.sendCapture("ident show", 500));
    } catch {
      /* ignore */
    }
    const pick = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const set = (id, v, decimals = null) => {
      const el = this.root.querySelector(`#${id}`);
      if (el && v != null && v !== "") {
        const num = Number(v);
        if (Number.isFinite(num)) {
          el.value = decimals != null ? num.toFixed(decimals) : String(num);
        }
      }
    };
    // 基础参数解析
    set("wf-pp", pick(/pp=([0-9.]+)/i) || pick(/Pole Pairs=([0-9.]+)/i), 0);
    set("wf-maxrpm", pick(/max_rpm=([0-9.]+)/i), 0);
    set("wf-limit2", pick(/limit=([0-9.]+)/i), 2);

    // conf read: Rs ohm, Ls uH
    const rsConf = pick(/Rs=([0-9.]+)/i);
    const lsConf = pick(/Ls=([0-9.]+)/i);
    if (rsConf) set("wf-rs", rsConf, 4);
    if (lsConf) set("wf-ls", lsConf, 2);

    // ident show:
    // "Rs=0.4018 ohm, Ls=320.55 uH"
    // "Ld=320.55 uH, Lq=320.55 uH"
    // "Flux=0.00095 Wb, Ke=0.90 V/krpm"
    const rsId = pick(/Rs=([0-9.]+)\s*ohm/i);
    const lsId = pick(/Ls=([0-9.]+)\s*uH/i);
    const ld = pick(/Ld=([0-9.]+)\s*uH/i) || pick(/Ld=([0-9.]+)/i);
    const lq = pick(/Lq=([0-9.]+)\s*uH/i) || pick(/Lq=([0-9.]+)/i);
    const flux = pick(/Flux=([0-9.]+)\s*Wb/i) || pick(/Flux=([0-9.]+)/i) || pick(/flux[^\n=]*=([0-9.]+)/i);

    if (rsId) set("wf-rs", rsId, 4);
    if (lsId) set("wf-ls", lsId, 2);
    if (ld) set("wf-ld", ld, 2);
    if (lq) set("wf-lq", lq, 2);
    if (flux) set("wf-flux", flux, 5);

    // 兜底补齐：若测得综合相电感 Ls，但未测双轴凸极电感时，自动用 Ls 填入 Ld/Lq
    const curLs = this.root.querySelector("#wf-ls")?.value;
    const curLd = this.root.querySelector("#wf-ld")?.value;
    const curLq = this.root.querySelector("#wf-lq")?.value;
    if (curLs && (!curLd || curLd === "")) set("wf-ld", curLs, 2);
    if (curLs && (!curLq || curLq === "")) set("wf-lq", curLs, 2);

    // 计算并更新凸极比 (Lq/Ld)
    this._updateSaliencyRatio();

    if (badge) badge.textContent = t("wf.motor.from_device");
    if (!silent) this._toast(t("wf.motor.read_done"), "ok");
  }

  /**
   * 触发一键电机参数辨识：
   * 1. 自动下发 ident full
   * 2. 按钮进入 loading 进度状态
   * 3. 实时/轮询捕获完成回显并自动回填 Rs/Ls/Flux 表单
   */
  async _runMotorIdent() {
    const btn = this.root.querySelector("#btn-action-ident");
    if (!btn) return;

    if (!confirm(t("wf.confirm.ident"))) {
      return;
    }

    btn.disabled = true;
    btn.classList.add("loading");
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;"></span><span>${t("ident.busy")}</span>`;
    const prog = this._startTaskProgress(t("wf.task.ident"), 8500);

    try {
      if (this.sendCapture) {
        // 下发 ident full，单片机测量 Rs/Ls 约 2s，拖动测磁链约 4~5s，整过程约 7~8 秒
        await this.sendCapture("ident full", 8500);
        // 辨识完成后立刻查询 ident show 提取最新精准结果
        await this._readMotorParams({ silent: true });
        prog.done(t("wf.ident.done"));
      } else {
        await this._cli("ident full");
        setTimeout(async () => {
          await this._readMotorParams({ silent: true });
          prog.done(t("wf.ident.done2"));
        }, 8000);
      }
    } catch (e) {
      prog.fail(t("wf.ident.fail"));
    } finally {
      if (this.sendCapture) {
        btn.disabled = false;
        btn.classList.remove("loading");
        btn.innerHTML = origHtml;
      } else {
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("loading");
          btn.innerHTML = origHtml;
        }, 8200);
      }
    }
  }

  /**
   * 触发一键电机零点校准：
   * 1. 自动下发 calib full 寻相并测定编码器零位与转向
   * 2. 按钮进入 loading 进度状态
   * 3. 校准完成自动刷新板卡信息并提示
   */
  async _runMotorCalib() {
    const btn = this.root.querySelector("#btn-action-calib");
    if (!btn) return;

    if (!confirm(t("wf.confirm.calib"))) {
      return;
    }

    btn.disabled = true;
    btn.classList.add("loading");
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;"></span><span>${t("wf.calib.busy")}</span>`;
    const prog = this._startTaskProgress(t("wf.task.calib"), 6500, "#wf-calib-status");

    try {
      if (this.sendCapture) {
        // calib full 正反各一圈寻相，耗时约 5~6 秒
        await this.sendCapture("calib full", 6500);
        await this._readBoardInfo();
        prog.done(t("wf.calib.done"));
      } else {
        await this._cli("calib full");
        setTimeout(async () => {
          await this._readBoardInfo();
          prog.done(t("wf.calib.done2"));
        }, 6500);
      }
    } catch (e) {
      prog.fail(t("wf.calib.fail"));
    } finally {
      if (this.sendCapture) {
        btn.disabled = false;
        btn.classList.remove("loading");
        btn.innerHTML = origHtml;
      } else {
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("loading");
          btn.innerHTML = origHtml;
        }, 6700);
      }
    }
  }

  _htmlEncoder() {
    return `
      <h3 class="wf-h">${t("wf.encoder.h")}</h3>
      <p class="wf-p">${t("wf.encoder.p")}</p>

      <!-- 1. 实时传感器与角度源状态看板 -->
      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("enc.status")}</h4>
          <div class="wf-card-actions">
            <button id="enc-refresh-status" class="small ok">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("enc.refresh")}</span>
            </button>
          </div>
        </div>
        <div class="metric-tiles">
          <div class="metric-tile">
            <span class="metric-lbl">${t("enc.mode")}</span>
            <strong id="enc-st-mode" class="metric-val">—</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-lbl">${t("enc.calib")}</span>
            <strong id="enc-st-calib" class="metric-val">—</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-lbl">${t("enc.offset")}</span>
            <strong id="enc-st-offset" class="metric-val">—</strong>
          </div>
          <div class="metric-tile">
            <span class="metric-lbl">${t("enc.rpm")}</span>
            <strong id="enc-st-rpm" class="metric-val">—</strong>
          </div>
        </div>
        <p class="wf-note" id="enc-status-note">${t("enc.status_hint")}</p>
      </section>

      <!-- 2. 通用传感器分类架构卡片 -->
      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("enc.arch.title") || "反馈传感器架构分类"}</h4>
        </div>
        <div class="enc-mode-grid" id="enc-cat-grid">
          <button type="button" class="enc-mode-card active" data-cat="inc">
            <span class="enc-mode-title">${t("enc.cat.inc") || "有感增量式 (ABZ / UVW)"}</span>
            <span class="enc-mode-desc">${t("enc.cat.inc_desc") || "正交编码盘/霍尔，通电需执行零点寻相校准"}</span>
          </button>
          <button type="button" class="enc-mode-card" data-cat="abs">
            <span class="enc-mode-title">${t("enc.cat.abs") || "有感绝对值 (SPI / 磁编)"}</span>
            <span class="enc-mode-desc">${t("enc.cat.abs_desc") || "单圈/多圈绝对角 (MT6701/AS5600)，断电记忆"}</span>
          </button>
          <button type="button" class="enc-mode-card" data-cat="sl">
            <span class="enc-mode-title">${t("enc.cat.sl") || "纯无感 (VESC + I/F)"}</span>
            <span class="enc-mode-desc">${t("enc.cat.sl_desc") || "无需任何物理传感器，反电动势观测与平滑接管"}</span>
          </button>
        </div>
      </section>

      <!-- 3. 自适应功能面板：根据所选分类动态呈现 -->
      <!-- 分类 A: 有感增量式面板 (CPR设置 + 零点寻相校准) -->
      <div id="enc-panel-inc" class="enc-cat-panel">
        <section class="wf-card">
          <div class="wf-card-head">
            <h4 class="wf-section">${t("wf.encoder.type")} · ${t("wf.encoder.abz")}</h4>
            <div class="wf-card-actions">
              <button class="ok" id="wf-enc-cpr-set">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>${t("wf.apply")}</span>
              </button>
            </div>
          </div>
          <div class="form-list">
            <div class="form-row">
              <label for="wf-enc-cpr">CPR 分辨率 (Counts Per Rev)</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-enc-cpr" step="1" min="16" max="65536" value="2048" />
                  <span class="num-unit">cnt</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="wf-card">
          <div class="wf-card-head">
            <h4 class="wf-section">${t("wf.calib.full")}</h4>
          </div>
          <div class="action-grid" style="grid-template-columns: 1fr;">
            <button id="btn-action-calib" class="danger">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/></svg>
              <span>${t("wf.calib.full")} (正反转测偏置)</span>
            </button>
          </div>
          <div id="wf-calib-status" class="task-progress" data-task="calib" hidden>
            <div class="task-progress-bar"><i></i></div>
            <span class="task-progress-text"></span>
          </div>
          <p class="wf-note">${t("wf.calib.note")}</p>
        </section>
      </div>

      <!-- 分类 B: 有感绝对值面板 (偏置校正与零位存储) -->
      <div id="enc-panel-abs" class="enc-cat-panel" hidden>
        <section class="wf-card">
          <div class="wf-card-head">
            <h4 class="wf-section">${t("enc.abs.config") || "绝对值磁编码器配置"}</h4>
          </div>
          <div class="form-list">
            <div class="form-row">
              <label>${t("enc.abs.protocol") || "通信总线接口"}</label>
              <div class="form-row-trail">
                <select id="wf-abs-proto">
                  <option value="spi">SPI (14-bit MT6701/AS5048A)</option>
                  <option value="i2c">I2C (12-bit AS5600)</option>
                  <option value="ssi">SSI / BiSS-C</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <label>${t("enc.abs.zero") || "机械零位偏置校正"}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-abs-zero-val" step="0.001" value="0.000" />
                  <span class="num-unit">rad</span>
                </div>
              </div>
            </div>
          </div>
          <div class="action-grid" style="grid-template-columns: 1fr 1fr; margin-top:10px;">
            <button id="btn-abs-read-zero" class="small">${t("enc.abs.read_current") || "将当前位置设为零位"}</button>
            <button id="btn-abs-save" class="ok small" data-cmd="conf write">${t("wf.motor.conf_write")}</button>
          </div>
          <p class="wf-note">${t("enc.abs.note") || "绝对值编码器出厂上电即知机械角，无需每次转动校准，写入 Flash 即可长期记忆。"}</p>
        </section>
      </div>

      <!-- 分类 C: 纯无感面板 (观测器平滑过渡与自适应接管) -->
      <div id="enc-panel-sl" class="enc-cat-panel" hidden>
        <section class="wf-card">
          <div class="wf-card-head">
            <h4 class="wf-section">${t("enc.sensorless")}</h4>
          </div>
          <div class="metric-tiles">
            <div class="metric-tile">
              <span class="metric-lbl">${t("enc.guard.mode")}</span>
              <strong id="enc-g-mode" class="metric-val">—</strong>
            </div>
            <div class="metric-tile">
              <span class="metric-lbl">${t("enc.guard.rpm")}</span>
              <strong id="enc-g-rpm" class="metric-val">—</strong>
            </div>
          </div>
          <div class="action-grid" style="grid-template-columns: 1fr 1fr; margin-top:10px;">
            <button data-cmd="obs 1">${t("enc.step1")}</button>
            <button class="danger" id="enc-obs-switch" data-cmd="obs 2" data-confirm="obs 2">${t("enc.step2")}</button>
          </div>
          <div class="action-grid" style="grid-template-columns: 1fr 1fr 1fr; margin-top:8px;">
            <button data-cmd="obs">${t("obs.query")}</button>
            <button data-cmd="obs 0">${t("obs.off")}</button>
            <button data-cmd="feedback">${t("fb.status")}</button>
          </div>
          <p class="wf-note">${t("enc.sensorless_note")}</p>
        </section>
      </div>

      <!-- 4. 全局角度源快速切换 -->
      <section class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.encoder.source")}</h4>
        </div>
        <div class="enc-mode-grid" id="enc-angle-grid">
          <button type="button" class="enc-mode-card" data-angle="enc">
            <span class="enc-mode-title">${t("obs.enc")}</span>
            <span class="enc-mode-desc">${t("enc.angle.enc")}</span>
          </button>
          <button type="button" class="enc-mode-card" data-angle="ol">
            <span class="enc-mode-title">${t("obs.ol")}</span>
            <span class="enc-mode-desc">${t("enc.angle.ol")}</span>
          </button>
        </div>
        <p class="wf-note">${t("wf.encoder.source_note")}</p>
      </section>`;
  }

  _htmlPid() {
    const tuneField = (id, label, unit, min, max, step, val) => `
      <div class="form-row">
        <label for="${id}">${label}</label>
        <div class="form-row-trail">
          <div class="num-field">
            <input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />
            <span class="num-unit">${unit}</span>
          </div>
        </div>
      </div>`;
    return `
      <div class="wf-page-head">
        <div>
          <h3 class="wf-h">${t("wf.pid.h")}</h3>
          <p class="wf-p">${t("wf.pid.p")}</p>
        </div>
        <div class="wf-card-actions">
          <button class="ok" id="wf-pid-apply">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.apply")}</span>
          </button>
          <button id="wf-pid-read">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>${t("wf.pid.read")}</span>
          </button>
          <button class="danger" id="wf-pid-save" data-confirm="conf write" title="${t("wf.pid.save_flash_tip")}">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
            <span>${t("wf.pid.save_flash")}</span>
          </button>
          <span id="wf-pid-dirty-badge" class="dirty-notice" style="display:none;">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="8" r="7" opacity="0.2"/><circle cx="8" cy="8" r="4"/></svg>
            <span>${t("wf.pid.dirty")}</span>
          </span>
          <span class="wf-badge">${t("wf.pid.watch_scope")}</span>
        </div>
      </div>

      <!-- 1. 电流环整定与保护限幅 -->
      <div class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.pid.title_current")}</h4>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-bw", t("wf.pid.current_bw"), "rad/s", 100, 3000, 50, 2000)}
          </div>
          <div class="form-list">
            ${tuneField("wf-limit-val", t("wf.pid.limit"), "A", 0.1, 15.0, 0.1, 2.0)}
          </div>
        </div>
      </div>

      <!-- 2. 速度环与运动加减速规划 -->
      <div class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.pid.title_vel")}</h4>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-vkp", t("wf.pid.vel_kp"), "A/RPM", 0, 2.0, 0.005, 0.02)}
            ${tuneField("wf-vki", t("wf.pid.vel_ki"), "A/(RPM·s)", 0, 5.0, 0.005, 0.02)}
            ${tuneField("wf-vramp", t("wf.pid.vel_ramp"), "RPM/s", 0, 100000, 500, 10000)}
          </div>
          <div class="form-list">
            ${tuneField("wf-vfilt", t("wf.pid.vel_filter"), "Hz", 5, 200, 5, 50)}
            ${tuneField("wf-vff", t("wf.pid.vel_ff"), "A", 0, 2.0, 0.01, 0.0)}
            ${tuneField("wf-vtrack", t("wf.pid.vel_track"), "A/rad", 0, 100, 0.1, 0.0)}
          </div>
        </div>
      </div>

      <!-- 3. 位置环与轨迹规划 -->
      <div class="wf-card">
        <div class="wf-card-head">
          <h4 class="wf-section">${t("wf.pid.title_pos")}</h4>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-pkp", t("wf.pid.pos_kp"), "A/rad", 0, 500, 0.5, 10)}
            ${tuneField("wf-pki", t("wf.pid.pos_ki"), "A/(rad·s)", 0, 50, 0.05, 0)}
            ${tuneField("wf-pvkp", t("wf.pid.pos_vkp"), "A/RPM", 0, 0.5, 0.002, 0.02)}
          </div>
          <div class="form-list">
            ${tuneField("wf-paccel", t("wf.pid.pos_accel"), "RPM/s", 100, 100000, 500, 5000)}
            ${tuneField("wf-pvmax", t("wf.pid.pos_vmax"), "RPM", 100, 10000, 100, 3000)}
            <div class="form-row form-row-spacer" aria-hidden="true"></div>
          </div>
        </div>
      </div>
      <p class="wf-note">${t("wf.pid.note")}</p>`;
  }

  _htmlRun() {
    return `
      <h3 class="wf-h">${t("wf.run.h")}</h3>
      <p class="wf-p">${t("wf.run.p")}</p>
      <div class="wf-card" style="gap:16px">
        <div id="wf-dashboard-host" class="wf-dash-host" style="margin:0"></div>
        <p class="wf-note">${t("wf.run.note")}</p>
      </div>`;
  }

  _wireEncoder() {
    const refresh = this.root.querySelector("#enc-refresh-status");
    refresh?.addEventListener("click", () => this._refreshEncoderStatus());

    // 通用分类卡片切换 (有感增量 / 有感绝对值 / 纯无感)
    this.root.querySelectorAll("#enc-cat-grid .enc-mode-card").forEach((card) => {
      card.addEventListener("click", () => {
        const cat = card.getAttribute("data-cat");
        if (!cat) return;
        this.root.querySelectorAll("#enc-cat-grid .enc-mode-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");

        const panels = {
          inc: this.root.querySelector("#enc-panel-inc"),
          abs: this.root.querySelector("#enc-panel-abs"),
          sl: this.root.querySelector("#enc-panel-sl"),
        };
        Object.keys(panels).forEach((k) => {
          if (panels[k]) panels[k].hidden = k !== cat;
        });

        // 联动自动适配下位机默认反馈与角度配置
        if (cat === "sl") {
          if (this.send) Promise.resolve(this.send("feedback sensorless")).then(() => this._refreshEncoderStatus());
        } else if (cat === "inc" || cat === "abs") {
          if (this.send) Promise.resolve(this.send("feedback sensored")).then(() => this._refreshEncoderStatus());
        }
      });
    });

    // 绝对值零位读取
    this.root.querySelector("#btn-abs-read-zero")?.addEventListener("click", async () => {
      if (this.sendCapture) {
        try {
          const txt = await this.sendCapture("pos", 350);
          const m = txt.match(/pos=([0-9.+-]+)/);
          if (m && m[1]) {
            const zInput = this.root.querySelector("#wf-abs-zero-val");
            if (zInput) zInput.value = Number(m[1]).toFixed(3);
            this._toast("当前轴绝对角度已读取为机械零点", "ok");
          }
        } catch {
          this._toast("读取当前绝对角度失败", "err");
        }
      }
    });

    // CPR 分辨率下发
    this.root.querySelector("#wf-enc-cpr-set")?.addEventListener("click", async () => {
      const cpr = Number(this.root.querySelector("#wf-enc-cpr")?.value);
      if (Number.isFinite(cpr) && cpr > 0) {
        await this._cli(`cpr ${cpr}`);
        this._toast(`编码器 CPR=${cpr} 已应用至 RAM`, "ok");
      }
    });

    this.root.querySelectorAll("#enc-angle-grid .enc-mode-card").forEach((card) => {
      card.addEventListener("click", () => {
        const a = card.getAttribute("data-angle");
        if (!a || !this.send) return;
        this.root.querySelectorAll("#enc-angle-grid .enc-mode-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        Promise.resolve(this.send(`angle ${a}`)).then(() => this._refreshEncoderStatus());
      });
    });

    this._refreshEncoderStatus();
    this._encGuardTimer = setInterval(() => this._refreshEncoderGuard(), 1000);
  }

  async _refreshEncoderStatus() {
    const s = this.getStatus?.();
    const MODE_NAMES = [t("mode.vf"), t("mode.iq"), t("mode.vel"), t("mode.pos")];
    const modeEl = this.root.querySelector("#enc-st-mode");
    const calibEl = this.root.querySelector("#enc-st-calib");
    const offsetEl = this.root.querySelector("#enc-st-offset");
    const rpmEl = this.root.querySelector("#enc-st-rpm");

    if (s && Number.isFinite(s.mode) && modeEl) {
      modeEl.textContent = MODE_NAMES[s.mode] || `mode ${s.mode}`;
    }
    if (s && Number.isFinite(s.rpmEst) && rpmEl) {
      rpmEl.textContent = `${s.rpmEst.toFixed(0)}`;
    }

    if (this.sendCapture) {
      try {
        const text = await this.sendCapture("status", 350);
        const calib = text.match(/calib=([0-9]+)(\*?)/);
        const offset = text.match(/offset=([0-9.+-]+)/);
        if (calibEl && calib) {
          const ok = calib[1] === "1";
          calibEl.textContent = ok ? t("enc.calib.ok") : t("enc.calib.no");
          calibEl.className = `metric-val ${ok ? "text-ok" : "text-warn"}`;
        }
        if (offsetEl && offset) offsetEl.textContent = offset[1];
      } catch {
        /* ignore */
      }
    }
    this._refreshEncoderGuard();
  }

  _refreshEncoderGuard() {
    const s = this.getStatus?.();
    const MODE_NAMES = [t("mode.vf"), t("mode.iq"), t("mode.vel"), t("mode.pos")];
    const gMode = this.root.querySelector("#enc-g-mode");
    const gRpm = this.root.querySelector("#enc-g-rpm");
    const switchBtn = this.root.querySelector("#enc-obs-switch");
    const modeOk = !!(s && Number.isFinite(s.mode) && s.mode === 2);
    const rpm = s && Number.isFinite(s.rpmEst) ? Math.abs(s.rpmEst) : NaN;
    const rpmOk = Number.isFinite(rpm) && rpm > 800;

    if (gMode && s && Number.isFinite(s.mode)) {
      gMode.textContent = MODE_NAMES[s.mode] || `mode ${s.mode}`;
      gMode.className = `metric-val ${modeOk ? "text-ok" : "text-warn"}`;
    }
    if (gRpm) {
      gRpm.textContent = Number.isFinite(rpm) ? `${rpm.toFixed(0)}` : "—";
      gRpm.className = `metric-val ${rpmOk ? "text-ok" : "text-warn"}`;
    }
    if (switchBtn) {
      const ready = modeOk && rpmOk;
      switchBtn.disabled = !ready;
      switchBtn.title = ready ? "" : t("enc.sensorless_note");
    }
  }

  _wire() {
    this.root.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        const conf = btn.getAttribute("data-confirm");
        const toastKey = btn.getAttribute("data-toast");
        if (conf && !confirm(conf)) return;
        Promise.resolve(this._cli(cmd)).then(() => {
          if (toastKey) this._toast(t(toastKey), "ok");
        }).catch(() => {
          if (toastKey) this._toast(t("wf.task.fail"), "err");
        });
      });
    });
    this.root.querySelector("#wf-read-info")?.addEventListener("click", () => this._readBoardInfo());
    this.root.querySelector("#wf-health-check")?.addEventListener("click", () => this._runHealthCheck());
    this.root.querySelector("#wf-copy-report")?.addEventListener("click", () => this._copyHealthReport());
    this.root.querySelector("#wf-read-params")?.addEventListener("click", () => this._readMotorParams());
    this.root.querySelector("#wf-motor-export")?.addEventListener("click", () => this._exportMotorParams());
    this.root.querySelector("#wf-motor-import")?.addEventListener("click", () => {
      this.root.querySelector("#wf-motor-import-file")?.click();
    });
    this.root.querySelector("#wf-motor-import-file")?.addEventListener("change", (e) => this._importMotorParams(e));
    this.root.querySelector("#btn-action-ident")?.addEventListener("click", () => this._runMotorIdent());
    this.root.querySelector("#btn-action-calib")?.addEventListener("click", () => this._runMotorCalib());
    this._wireEncoder();

    /* 编码器页：状态 / 模式卡片 / 无感联锁 */
    this._wireEncoder();

    // 监听 Ld / Lq 输入变化动态更新凸极比
    ["wf-ld", "wf-lq", "wf-ls"].forEach((id) => {
      this.root.querySelector(`#${id}`)?.addEventListener("input", () => this._updateSaliencyRatio());
    });

    // 监听电流软限输入变化，实时联动计算过流跳闸 trip = clamp(limit * 1.25 + 0.1, limit, hard_limit)
    const limitInput = this.root.querySelector("#wf-limit");
    const tripInput = this.root.querySelector("#wf-trip");
    if (limitInput && tripInput) {
      limitInput.addEventListener("input", () => {
        const lim = Number(limitInput.value);
        if (Number.isFinite(lim) && lim > 0) {
          const trip = Math.min(Math.max(lim * 1.25 + 0.1, lim), 40.0);
          tripInput.value = trip.toFixed(2);
        }
      });
    }

    this.root.querySelector("#wf-limit-set")?.addEventListener("click", async () => {
      const vLimit = Number(this.root.querySelector("#wf-limit")?.value);
      const vUv = Number(this.root.querySelector("#wf-uv")?.value);
      const vOv = Number(this.root.querySelector("#wf-ov")?.value);

      if (Number.isFinite(vLimit) && vLimit > 0) {
        await this._cli(`limit ${vLimit}`);
      }
      if (Number.isFinite(vUv) && Number.isFinite(vOv)) {
        if (vUv >= vOv) {
          alert("欠压保护门槛必须小于过压保护门槛！");
          return;
        }
        await this._cli(`vbus uv ${vUv}`);
        await this._cli(`vbus ov ${vOv}`);
      } else if (Number.isFinite(vUv)) {
        await this._cli(`vbus uv ${vUv}`);
      } else if (Number.isFinite(vOv)) {
        await this._cli(`vbus ov ${vOv}`);
      }
      this._toast("安全保护参数已应用至 RAM", "ok");
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

  /** 计算并更新凸极比 (Lq / Ld) */
  _updateSaliencyRatio() {
    const ldEl = this.root.querySelector("#wf-ld");
    const lqEl = this.root.querySelector("#wf-lq");
    const salEl = this.root.querySelector("#wf-saliency");
    const unitEl = this.root.querySelector("#wf-saliency-unit");
    if (!salEl) return;

    const ld = Number(ldEl?.value);
    const lq = Number(lqEl?.value);

    if (Number.isFinite(ld) && ld > 0 && Number.isFinite(lq) && lq > 0) {
      const ratio = lq / ld;
      salEl.value = ratio.toFixed(3);
      if (unitEl) {
        if (Math.abs(ratio - 1.0) < 0.08) {
          unitEl.textContent = "SPMSM (≈1.0)";
          unitEl.style.color = "var(--ok, #7fd962)";
        } else {
          unitEl.textContent = "IPMSM (凸极)";
          unitEl.style.color = "var(--primary, #58a6ff)";
        }
      }
    } else {
      salEl.value = "";
      if (unitEl) {
        unitEl.textContent = "比值";
        unitEl.style.color = "";
      }
    }
  }

  /** 导出当前电机参数为 JSON 文件 */
  _exportMotorParams() {
    const getVal = (id) => this.root.querySelector(`#${id}`)?.value || "";
    const name = getVal("wf-motor-name") || "motor";
    const data = {
      motor_name: name,
      exported_at: new Date().toISOString(),
      pole_pairs: Number(getVal("wf-pp")) || 7,
      rs_ohm: Number(getVal("wf-rs")) || 0,
      ls_uh: Number(getVal("wf-ls")) || 0,
      ld_uh: Number(getVal("wf-ld")) || 0,
      lq_uh: Number(getVal("wf-lq")) || 0,
      saliency_ratio: Number(getVal("wf-saliency")) || 1.0,
      flux_linkage_wb: Number(getVal("wf-flux")) || 0,
      max_rpm: Number(getVal("wf-maxrpm")) || 12000,
      current_limit_a: Number(getVal("wf-limit2")) || 5.2,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `motor_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._toast(`✔ 已导出 ${a.download}`, "ok");
  }

  /** 从 JSON 文件导入电机参数 */
  _importMotorParams(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target?.result);
        const setVal = (id, val) => {
          const el = this.root.querySelector(`#${id}`);
          if (el && val !== undefined && val !== null) el.value = String(val);
        };
        if (d.motor_name) setVal("wf-motor-name", d.motor_name);
        if (d.pole_pairs !== undefined) setVal("wf-pp", d.pole_pairs);
        if (d.rs_ohm !== undefined) setVal("wf-rs", Number(d.rs_ohm).toFixed(4));
        if (d.ls_uh !== undefined) setVal("wf-ls", Number(d.ls_uh).toFixed(2));
        if (d.ld_uh !== undefined) setVal("wf-ld", Number(d.ld_uh).toFixed(2));
        if (d.lq_uh !== undefined) setVal("wf-lq", Number(d.lq_uh).toFixed(2));
        if (d.flux_linkage_wb !== undefined) setVal("wf-flux", Number(d.flux_linkage_wb).toFixed(5));
        if (d.max_rpm !== undefined) setVal("wf-maxrpm", d.max_rpm);
        if (d.current_limit_a !== undefined) setVal("wf-limit2", Number(d.current_limit_a).toFixed(2));

        this._updateSaliencyRatio();
        this._toast(`✔ 成功导入电机参数 [${d.motor_name || file.name}]`, "ok");
      } catch (err) {
        this._toast("✖ 导入失败：JSON 格式不正确", "err");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }
}

export { STEPS as WORKFLOW_STEPS };
