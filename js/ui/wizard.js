/**
 * 六步调试工作流 UI — 超前于固件的能力也先做在上位机里。
 * 每步发既有 CLI；无固件命令时给出说明并禁用或标为「待固件」。
 */

import { t, getLang } from "../i18n.js";
import { OBS_COMMANDS } from "./console.js";
import { MotorParamManager } from "../data/motor-param-manager.js";
import { MOTOR_SCHEMA } from "../data/motor-schema.js";

/** 工作流页面通用线性图标（16x16 viewBox） */
const ICO_PATHS = {
  chip: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/><path d="M1 5.5h1.5M1 8h1.5M1 10.5h1.5M13.5 5.5h1.5M13.5 8h1.5M13.5 10.5h1.5M5.5 1v1.5M8 1v1.5M10.5 1v1.5M5.5 13.5v1.5M8 13.5v1.5M10.5 13.5v1.5"/>',
  shield: '<path d="M8 1.5l5.5 2.2v4.1c0 3.2-2.2 5.5-5.5 6.7-3.3-1.2-5.5-3.5-5.5-6.7V3.7L8 1.5z"/><path d="M5.5 8.1l1.8 1.8 3.2-3.3"/>',
  pulse: '<path d="M1.5 8.5h3l2-5 3 10 2-5h3"/>',
  motor: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2"/>',
  tag: '<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8V2.5z"/><circle cx="5.2" cy="5.2" r="1"/>',
  poles: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11M2.5 8h11"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
  resistor: '<path d="M1 8h2.4l1.2-2.6 2 5.2 2-5.2L9.8 8H15"/>',
  inductor: '<path d="M1 11.2c1.2 0 1.8-5 3-5s1.8 5 3 5 1.8-5 3-5 1.8 5 3 5H15"/>',
  gauge: '<path d="M2.8 12.2a5.6 5.6 0 1 1 10.4 0"/><path d="M8 12.2l3.2-4.2"/><circle cx="8" cy="12.2" r="1"/>',
  volt: '<polygon points="8.6,1.5 3.4,9 7.4,9 6.4,14.5 12.6,7 8.6,7"/>',
  alert: '<path d="M8 2.2L1.9 13.2h12.2L8 2.2z"/><path d="M8 6.2v3.1M8 11.3h.01"/>',
  battLow: '<rect x="1.5" y="4" width="11" height="8" rx="1.5"/><path d="M12.8 6.5h1.4v3h-1.4"/><rect x="3.4" y="6" width="2.2" height="4" rx="0.4" fill="currentColor" stroke="none" opacity="0.75"/>',
  battHigh: '<rect x="1.5" y="4" width="11" height="8" rx="1.5"/><path d="M12.8 6.5h1.4v3h-1.4"/><rect x="3.4" y="6" width="6.6" height="4" rx="0.4" fill="currentColor" stroke="none" opacity="0.75"/>',
  flux: '<path d="M2 10.2c2-4.2 4-4.2 6 0s4 4.2 6 0"/><path d="M2 6.2c2-4.2 4-4.2 6 0s4 4.2 6 0"/>',
  speed: '<circle cx="8" cy="8" r="5.5"/><path d="M8 8l3.4-3.4M8 2.6v1.4M13.4 8h-1.4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
  wave: '<path d="M1.5 8c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4 0"/>',
  dial: '<circle cx="8" cy="8" r="5.5"/><path d="M8 8l2.8-3.2"/><path d="M4 12.5h8"/>',
  ramp: '<path d="M2 13h3l6-9h3"/><path d="M11.5 2.5L14 4l-1 2.8"/>',
  filter: '<path d="M2 4.5h12M4 8h8M6 11.5h4"/>',
  friction: '<path d="M3 12c2-1 3-4 5-4s3 2 5 3"/><path d="M2 13.5h12"/>',
  target: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none"/>',
  accel: '<path d="M8 13V4"/><path d="M4.5 7.5L8 4l3.5 3.5"/>',
  pos: '<circle cx="8" cy="8" r="5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/>',
  radar: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.2"/><path d="M8 8l4-4"/>',
  box: '<path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3v-5z"/><path d="M8 8.5v5M2.5 5.5L8 8.5l5.5-3"/>',
  cogwave: '<path d="M2 10c1.5-3 3-3 4.5 0s3 3 4.5 0 2-2 3-1"/><circle cx="12.5" cy="4.5" r="2"/>',
  compass: '<circle cx="8" cy="8" r="5.5"/><path d="M10.5 5.5l-1.2 4-4 1.2 1.2-4 4-1.2z"/>',
};

function wfIco(name, size = 14) {
  const p = ICO_PATHS[name] || ICO_PATHS.chip;
  return `<svg class="wf-ico" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

function sectionHead(icon, title) {
  return `<h4 class="wf-section">${wfIco(icon, 15)}<span>${title}</span></h4>`;
}

function formLbl(forId, icon, text, badge = null, diff = null, paramKey = null, badgeClass = "", isFixed = false) {
  let diffHtml = "";
  if (diff && diff.status === "warning") {
    diffHtml = `<span class="diff-badge diff-warn" data-param-key="${paramKey || ""}" title="${diff.message}">⚠ DIFF</span>`;
  } else if (diff && diff.status === "critical") {
    diffHtml = `<span class="diff-badge diff-critical" data-param-key="${paramKey || ""}" title="${diff.message}">⛔ 冲突</span>`;
  }
  const staticClass = isFixed ? " is-static" : "";
  const cls = (badgeClass ? `ident-badge ${badgeClass}` : "ident-badge") + staticClass;
  const titleAttr = isFixed ? 'title="固定手填参数 (无需弹窗)"' : 'title="查看参数来源与推导"';
  const dataStaticAttr = isFixed ? ' data-static="1"' : "";
  const badgeHtml = badge ? `<span class="${cls}" data-param-key="${paramKey || ""}"${dataStaticAttr} ${titleAttr}>${badge}</span>` : "";
  const metaHtml = (badgeHtml || diffHtml) ? `<span class="lbl-meta">${badgeHtml}${diffHtml}</span>` : "";
  return `<label class="form-lbl"${forId ? ` for="${forId}"` : ""}>` +
    `<span class="lbl-name">${wfIco(icon, 13)}<span class="lbl-text">${text}</span></span>` +
    metaHtml +
  `</label>`;
}

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

/** 固件故障码 — 界面短名（中文，不带码） */
export const FAULT_NAMES_ZH = {
  0: "正常",
  1: "电流采样失效",
  2: "校准过流",
  3: "运行过流",
  4: "校准超时",
  5: "校准状态异常",
  6: "未校准",
  7: "控制量异常",
  8: "电机堵转",
  9: "观测器失锁",
  10: "参数非法",
  11: "母线欠压",
  12: "母线过压",
  13: "过温",
};

/** 固件故障码 — 详细（码+英文+中文），诊断报告用 */
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
  13: "OVERTEMP (过温)",
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
  const faultName = FAULT_NAMES[faultCode] || `FAULT_${faultCode} (故障 ${faultCode})`;
  const faultDetail = FAULT_NAMES[faultCode] || `FAULT_${faultCode} (故障 ${faultCode})`;

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
    faultDetail,
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
      msg: `系统存在跳闸故障: ${info.faultDetail || info.faultName}`,
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
    this.onIqLimit = opts.onIqLimit || null;
    this.onMaxRpm = opts.onMaxRpm || null;
    this.getStatus = opts.getStatus || (() => null);
    /** @type {() => Float32Array|null} 最新一帧 500Hz 波形（32 通道），用于实时转速 */
    this.getLatest = opts.getLatest || (() => null);
    /** 编码器页缓存：来自 status 文本回显的模式与转速 */
    this._encMode = null;
    this._encRpm = NaN;
    this._encGuardTimer = null;
    this.step = "device";
    /** @type {number|null} 最近同步的电流软限（跨页回填） */
    this._lastLimitAmps = null;
    this._lastTripAmps = null;
    this._lastMaxRpm = null;
    /** @type {Record<string, string>} 调参基准值，用于脏状态感知 */
    this.pidBaseline = {};
    /** 电机参数工业级管理内核实例 */
    this.paramMgr = new MotorParamManager();
    this.render();
  }

  setStep(id) {
    this.step = STEPS.some((s) => s.id === id) ? id : "device";
    this.render();
    if (this._lastLimitAmps) this._syncCurrentLimit(this._lastLimitAmps, this._lastTripAmps);
    if (this._lastMaxRpm) this._syncMaxRpm(this._lastMaxRpm);
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
    if (!this.isConnected()) {
      this._toast(t("sys.need_connect"), "err");
      return;
    }
    try {
      await this.send(cmd);
    } catch (e) {
      /* terminal shows errors */
    }
  }

  /** 应用电机参数表单：向固件下发 max_rpm, pp, rs, ls, flux 等，并同步状态 */
  async _applyMotorParamsFromForm() {
    if (!this.isConnected()) {
      this._toast(t("sys.need_connect"), "err");
      return;
    }

    // 检查闭环安全门禁
    const readiness = this.paramMgr.getReadinessReport();
    if (!readiness.canCloseLoop) {
      if (this.paramMgr.ppConflict) {
        this._showPpConflictModal();
        return;
      }
      alert(`无法应用到单片机：存在未解决的安全阻断项：\n- ${readiness.blockers.join("\n- ")}`);
      return;
    }

    const mgr = this.paramMgr;
    const rpmForm = mgr.getEffectiveValue("max_rpm");
    if (rpmForm && rpmForm >= 100 && rpmForm <= 50000) {
      await this._cli(`motor max_rpm ${Math.round(rpmForm)}`);
      this._syncMaxRpm(rpmForm);
    }

    const ppForm = mgr.getEffectiveValue("pp");
    if (ppForm && ppForm >= 1 && ppForm <= 50) {
      await this._cli(`motor pp ${Math.round(ppForm)}`);
    }

    const rsForm = mgr.getEffectiveValue("rs");
    if (rsForm && rsForm > 0.0001 && rsForm <= 100) {
      await this._cli(`motor rs ${rsForm.toFixed(4)}`);
    }

    const lsForm = mgr.getEffectiveValue("ls");
    if (lsForm && lsForm > 0.01 && lsForm <= 100000) {
      await this._cli(`motor ls ${lsForm.toFixed(2)}`);
    }

    const fluxForm = mgr.getEffectiveValue("flux");
    if (fluxForm && fluxForm > 0.00001 && fluxForm <= 1.0) {
      await this._cli(`motor flux ${fluxForm.toFixed(5)}`);
    }

    // 依然触发 ident apply 兼容旧版辨识缓存更新
    await this._cli("ident apply");

    // 更新 manager 内核中的 RAM 状态与 Dirty 标志
    mgr.markAppliedToMcu();
    this.render();
    this._toast(t("wf.motor.apply_honest"), "ok");
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
    // 刚打开串口时 VLink CDC 偶尔吞掉第一条回显；version 无回显则重试一次
    const grab = async (cmd, ms, key) => {
      let txt = "";
      for (let i = 0; i < 2; i++) {
        try {
          txt = await this.sendCapture(cmd, ms);
        } catch {
          txt = "";
        }
        if (!key || txt.includes(key)) break;
      }
      return txt;
    };
    let text = "";
    text += await grab("version", 350, "firmware=");
    text += "\n" + (await grab("status", 400, "M0 "));
    text += "\n" + (await grab("limit", 300, "limit="));
    text += "\n" + (await grab("vbus", 300, "vbus="));
    this._latestBoardText = text;
    this._renderBoardInfo(text);
    this._fillSafetyInputs(text);
    if (box) box.classList.remove("loading");
  }

  /** 最大转速同步：设备/电机页 + 控制台速度环滑条 */
  _syncMaxRpm(rpm) {
    const r = Number(rpm);
    if (!Number.isFinite(r) || r <= 0) return;
    this._lastMaxRpm = r;
    const set = (id, v) => {
      const el = this.root.querySelector(`#${id}`);
      if (el) el.value = String(Math.round(v));
    };
    set("wf-maxrpm", r);
    if (typeof this.onMaxRpm === "function") this.onMaxRpm(r);
  }

  /** 电流软限全局同步：设备页 / 电机页 / 调参页 + 过流跳闸 + 控制台 Iq 滑条 */
  _syncCurrentLimit(amps, tripAmps = null) {
    const lim = Number(amps);
    if (!Number.isFinite(lim) || lim <= 0) return;
    this._lastLimitAmps = lim;
    if (tripAmps != null && Number.isFinite(Number(tripAmps))) this._lastTripAmps = Number(tripAmps);
    const fmt = (v) => Number(v).toFixed(2);
    const set = (id, v) => {
      const el = this.root.querySelector(`#${id}`);
      if (el) el.value = v;
    };
    ["wf-limit", "wf-limit2", "wf-limit-val"].forEach((id) => set(id, id === "wf-limit" ? Number(lim).toFixed(1) : fmt(lim)));
    let trip = Number(this._lastTripAmps);
    if (!Number.isFinite(trip) || trip <= 0) {
      trip = Math.min(Math.max(lim * 1.25 + 0.1, lim), 40.0);
    }
    set("wf-trip", fmt(trip));
    if (typeof this.onIqLimit === "function") this.onIqLimit(lim);
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

    if (limitVal) this._syncCurrentLimit(limitVal, tripVal);
    const rpmB = pick(/max_rpm=([0-9.]+)/i) || pick(/maxrpm=([0-9.]+)/i);
    if (rpmB) this._syncMaxRpm(rpmB);
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
        sub: info.build && info.build !== "—" ? info.build : "",
        title: info.build && info.build !== "—" ? `${t("wf.device.build")}: ${info.build}` : "",
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
        val: `${info.faultName}`,
        title: info.faultDetail || "",
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
        val: info.cpu !== "—" ? `${info.cpu}% (${t("board.peak")} ${info.cpuMax || "—" }%)` : "—",
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
        val: info.csReady !== null
          ? `${t("board.cs.ready")} ${info.csReady} · ${t("board.cs.fault")} ${info.csFault ?? 0} · ${t("board.cs.drop")} ${info.rejected ?? 0}`
          : "—",
        tag: "SENSE",
        highlight: info.csReady !== null,
        valClass: (info.csFault === 0 && (info.rejected ?? 0) === 0) ? "text-ok" : "text-warn",
        icon: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>`,
      },
      {
        id: "cli",
        label: t("board.comm"),
        val: info.cliRxOverflow !== null ? `ovf ${info.cliRxOverflow} B` : "—",
        sub: info.cli !== "—" ? `CLI ${info.cli}` : "",
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
            <strong class="tile-val ${it.valClass || ""}"${it.title ? ` title="${it.title}"` : ""}>${it.val}</strong>
            ${it.sub ? `<span class="tile-sub">${it.sub}</span>` : ""}
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
      <!-- 独立卡片 1：板卡硬件与运行指标 (12项圆角磁贴卡片) -->
      <section class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("chip", t("wf.device.info"))}
          <div class="wf-card-actions">
            <button class="ok" id="wf-read-info">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.device.read")}</span>
            </button>
            <button id="wf-diag-fault-btn" data-cmd="fault">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11.5h.01"/></svg>
              <span>${t("wf.safety.fault")}</span>
            </button>
            <button class="danger" id="wf-diag-clear-btn" data-cmd="fault clear" data-confirm="confirm.fault_clear">
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
          ${sectionHead("shield", t("wf.safety.h"))}
          <div class="wf-card-actions">
            <button class="ok" id="wf-limit-set">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.apply")}</span>
            </button>
            <button class="danger" data-cmd="conf write" data-confirm="confirm.conf_write" title="${t("wf.safety.note")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
              <span>${t("wf.motor.conf_write")}</span>
            </button>
          </div>
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            <div class="form-row">
              ${formLbl("wf-limit", "gauge", t("wf.safety.limit"))}
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-limit" step="0.1" min="0.1" max="40" value="5.2" />
                  <span class="num-unit">A</span>
                </div>
              </div>
            </div>
            <div class="form-row">
              ${formLbl("wf-trip", "alert", t("wf.safety.trip"))}
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-trip" step="0.1" min="0.1" max="50" value="6.6" readonly style="opacity:0.85;cursor:not-allowed;background:var(--bg-card-subtle, rgba(255,255,255,0.03));" title="根据电流软限自动推算：clamp(limit * 1.25 + 0.1, limit, hard_limit)" />
                  <span class="num-unit">A</span>
                </div>
              </div>
            </div>
            <div class="form-row">
              ${formLbl("wf-hard-limit", "shield", t("wf.safety.hard_limit") || "硬件瞬时硬限")}
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-hard-limit" step="0.1" value="12.0" readonly style="opacity:0.85;cursor:not-allowed;background:var(--bg-card-subtle, rgba(255,255,255,0.03));" title="驱动板硬件物理断电极限（单点不可逾越）" />
                  <span class="num-unit">A</span>
                </div>
              </div>
            </div>
          </div>
          <div class="form-list">
            <div class="form-row">
              ${formLbl("wf-uv", "battLow", t("wf.safety.uv"))}
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-uv" step="0.1" min="0" max="50" value="10" />
                  <span class="num-unit">V</span>
                </div>
              </div>
            </div>
            <div class="form-row">
              ${formLbl("wf-ov", "battHigh", t("wf.safety.ov"))}
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-ov" step="0.1" min="0" max="60" value="30" />
                  <span class="num-unit">V</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="wf-note">${t("wf.safety.defaults_hint")}</p>
      </section>

      <!-- 系统诊断 -->
      <section class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("pulse", t("wf.device.health_title"))}
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
    const isZh = (typeof getLang === "function" ? getLang() : "zh") !== "en";
    const badgeManual = t("wf.motor.badge_manual") || "✎ 手填";
    const badgeIdent = t("wf.motor.badge_ident") || "⚡ 辨识";
    const badgeActive = t("wf.motor.badge_active") || "⟳ 读取";
    const mgr = this.paramMgr;

    // 顶部就绪报告
    const readiness = mgr.getReadinessReport();
    const readyRatio = `${readiness.readyCount}/${readiness.totalCount}`;
    const closeLoopCap = readiness.canCloseLoop
      ? `<span class="status-capsule cap-ok">✔ 闭环安全已就绪 (${readyRatio})</span>`
      : `<span class="status-capsule cap-err" title="${readiness.blockers.join('；')}">⛔ 闭环未就绪 (${readyRatio})</span>`;
    const flashCap = readiness.flashDirty
      ? `<span class="status-capsule cap-dirty" title="RAM 参数已修改，尚未写入 Flash 持久化">▲ Flash 未固化</span>`
      : `<span class="status-capsule cap-clean">● Flash 已同步</span>`;

    // 辅助行渲染函数：外露展示【读取】并提供【三角形 =>】引用到手填，最后为生效应用值
    const row = (key, step, icon, extraClass = "") => {
      const p = mgr.get(key);
      const schema = p.schema;
      const id = schema.id;
      const label = schema.name;
      const unit = schema.unit;
      const val = p.candidate.value !== null ? (schema.decimals !== null ? Number(p.candidate.value).toFixed(schema.decimals) : p.candidate.value) : "";
      const diff = p.diff;
      const isZh = (typeof getLang === "function" ? getLang() : "zh") !== "en";

      // 1. 读取值与格式化 (从 MCU 硬件读取层获取)
      const readVal = p.active?.value !== null && p.active?.value !== undefined ? p.active.value : null;
      const readDisplay = readVal !== null
        ? (schema.decimals !== null ? Number(readVal).toFixed(schema.decimals) : String(readVal))
        : "—";
      const hasRead = readVal !== null;
      const isFixed = !!p.schema.isFixedManual;
      const canTransfer = hasRead && !isFixed;
      const readTooltip = hasRead
        ? (isZh ? `单片机硬件当前运行值: ${readDisplay} ${unit || ""}\n点击亦可一键引用至手填` : `MCU readback: ${readDisplay} ${unit || ""}\nClick to apply to manual`)
        : (isZh ? `尚未读取硬件数据，点击上方【读取参数】获取` : `No readback yet, click Read Params`);
      const transferTooltip = canTransfer
        ? (isZh ? `将单片机读取值 (${readDisplay} ${unit || ""}) 引用至手填应用` : `Apply readback (${readDisplay}) to manual`)
        : (isZh ? `暂无可引用的硬件读取值` : `No readback available`);

      // 2. 动态判定当前生效应用徽章 (手填 / 辨识 / 读取)
      let badgeText = null;
      let badgeClass = "";
      if (p.candidate.value !== null) {
        if (p.candidate.source === "identified" || p.candidate.source === "calculated" || p.candidate.source === "measured") {
          badgeText = badgeIdent;
          badgeClass = "badge-identified";
        } else if (p.candidate.source === "active") {
          badgeText = badgeActive;
          badgeClass = "badge-active";
        } else if (p.candidate.source === "manual") {
          badgeText = badgeManual;
          badgeClass = "badge-manual";
        }
      }

      // 3. 差异/冲突徽章
      let diffHtml = "";
      if (diff && diff.status === "warning") {
        diffHtml = `<span class="diff-badge diff-warn" data-param-key="${key}" title="${diff.message}">⚠ DIFF</span>`;
      } else if (diff && diff.status === "critical") {
        diffHtml = `<span class="diff-badge diff-critical" data-param-key="${key}" title="${diff.message}">⛔ 冲突</span>`;
      }

      const staticClass = isFixed ? " is-static" : "";
      const cls = (badgeClass ? `ident-badge ${badgeClass}` : "ident-badge") + staticClass;
      const titleAttr = isFixed ? 'title="固定手填参数 (无需弹窗)"' : 'title="查看参数来源与对比"';
      const dataStaticAttr = isFixed ? ' data-static="1"' : "";
      const badgeHtml = badgeText ? `<span class="${cls}" data-param-key="${key}"${dataStaticAttr} ${titleAttr}>${badgeText}</span>` : "";

      const isIdent = p.candidate.source === "identified" || p.candidate.source === "calculated" || p.candidate.source === "measured";
      const isActive = p.candidate.source === "active";
      const isLocked = (isIdent || isActive) && !isFixed;
      const lockTitle = isLocked
        ? (isIdent
            ? "⚡ 系统辨识实测真值已锁定保护。点击左侧【⚡ 辨识】徽章，采纳【手填】后即可解锁修改。"
            : "📥 单片机读取运行值已锁定保护。点击左侧【📥 读取】徽章，采纳【手填】后即可解锁修改。")
        : "";

      return `
        <div class="form-row ${isIdent ? "is-ident-row" : (isActive ? "is-active-row" : "")} ${extraClass}">
          <label class="form-lbl" for="${id}">
            <span class="lbl-name">${wfIco(icon || "gear", 13)}<span class="lbl-text">${label}</span></span>
          </label>
          <div class="param-row-flow">
            <!-- 1. 读取块 (带图标、读回值与物理单位) -->
            <div class="param-read-pill ${hasRead ? "has-data" : "no-data"}" ${hasRead ? `data-import-read-key="${key}"` : ""} title="${readTooltip}">
              <svg class="read-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span class="read-tag">${isZh ? "读取" : "Read"}</span>
              <span class="read-val">${readDisplay}</span>
              ${hasRead && unit ? `<span class="read-unit">${unit}</span>` : ""}
            </div>

            <!-- 2. 中间三角形引用按钮 (读取 => 手填) -->
            <button type="button" class="btn-import-read ${canTransfer ? "" : "is-disabled"}" data-import-read-key="${key}" ${canTransfer ? "" : "disabled"} title="${transferTooltip}">
              <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor"><polygon points="5,3 12,8 5,13"/></svg>
            </button>

            <!-- 3. 应用来源状态徽章 (手填 / 辨识 / DIFF) -->
            <div class="param-src-meta">
              ${badgeHtml}
              ${diffHtml}
            </div>

            <!-- 4. 最终生效的应用数据输入框 -->
            <div class="num-field ${isIdent ? "ident-field" : (isActive ? "active-field" : "")} ${isLocked ? "is-locked" : ""}" ${isLocked ? `title="${lockTitle}"` : ""}>
              <input type="number" id="${id}" data-param-key="${key}" step="${step}" value="${val}" placeholder="${val === "" ? "—" : ""}" ${isLocked ? 'readonly tabindex="-1"' : ""} ${isLocked ? `title="${lockTitle}"` : ""} />
              <span class="num-unit">${unit || ""}</span>
            </div>
          </div>
        </div>`;
    };

    return `
      <section class="wf-card">
        <!-- 辨识完成批量采纳横条 (默认 hidden，辨识完成且有结果时显示) -->
        <div id="batch-adopt-bar" class="batch-adopt-bar" hidden>
          <div class="adopt-info">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" style="color:#10b981"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span id="batch-adopt-msg">辨识已完成，测得 3 项参数</span>
          </div>
          <div class="adopt-actions">
            <button class="ok" id="btn-batch-apply-safe" style="padding:4px 12px;font-size:11px;">采纳安全项</button>
            <button id="btn-batch-discard" style="padding:4px 8px;font-size:11px;background:transparent;border:none;color:var(--text-faint);cursor:pointer;">忽略</button>
          </div>
        </div>

        <div class="wf-card-head">
          ${sectionHead("motor", t("wf.motor.params"))}
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
            <div class="split-btn-group" id="ident-split-group">
              <button class="danger" id="btn-action-ident" title="执行全套自动参数辨识 (Rs, Ls, Ld, Lq, 极对数, 磁链)">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 1.5l-5 7h4l-1 6 6-8h-4l1.5-5" stroke-linejoin="round"/></svg>
                <span>${t("ident.full")}</span>
              </button>
              <button class="danger split-toggle" id="btn-ident-menu-toggle" title="展开更多辨识模式 (静态阻抗/凸极/极对数/磁链)">
                <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M4 6l4 4 4-4H4z"/></svg>
              </button>
              <div class="split-dropdown-menu" id="ident-dropdown-menu" hidden>
                <div class="menu-item" data-ident-mode="full">
                  <div class="item-title">⚡ 全套自动辨识</div>
                  <div class="item-desc">静止到旋转 · 测定全部电气阻抗、极对数与磁链</div>
                </div>
                <div class="menu-item" data-ident-mode="rs">
                  <div class="item-title">🔒 静态阻抗测量</div>
                  <div class="item-desc">转子完全锁死不动 · 测定相电阻与相电感 (带载安全)</div>
                </div>
                <div class="menu-item" data-ident-mode="ldq">
                  <div class="item-title">📐 凸极特性测量</div>
                  <div class="item-desc">转子静止高频注入 · 测定 Ld、Lq 及凸极比</div>
                </div>
                <div class="menu-item" data-ident-mode="pp">
                  <div class="item-title">🔄 极对数测定</div>
                  <div class="item-desc">开环微转 4 电周期 · 测定转子磁极对数</div>
                </div>
                <div class="menu-item" data-ident-mode="flux">
                  <div class="item-title">🌊 磁链常数测定</div>
                  <div class="item-desc">开环旋转 300 RPM · 采样反电势测定磁链与 Ke</div>
                </div>
              </div>
            </div>
            <button class="ok" id="btn-action-apply-params" title="${t("wf.motor.apply_honest")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.apply")}</span>
            </button>
            <button class="danger" data-cmd="conf write" data-confirm="confirm.conf_write" title="${t("wf.motor.conf_write_tip")}">
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
        <!-- 左右对偶完全对称布局 (各 6 项) -->
        <div class="form-list-2col">
          <!-- 左栏：每一行的对偶左项 -->
          <div class="form-list">
            <div class="form-row">
              <label class="form-lbl" for="wf-motor-name">
                <span class="lbl-name">${wfIco("tag", 13)}<span class="lbl-text">${t("wf.motor.name") || "电机型号"}</span></span>
              </label>
              <div class="param-row-flow">
                <div class="param-read-pill no-data is-static-pill" title="本地项目型号标签，无下位机寄存器">
                  <svg class="read-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:0.35;"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span class="read-tag">${isZh ? "读取" : "Read"}</span>
                  <span class="read-val" style="color:var(--text-faint);">—</span>
                </div>
                <button type="button" class="btn-import-read is-disabled" disabled style="opacity:0.18;cursor:default;">
                  <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor"><polygon points="5,3 12,8 5,13"/></svg>
                </button>
                <div class="param-src-meta">
                  <span class="ident-badge badge-manual is-static" data-param-key="motor_name" data-static="1" title="固定手填参数">${badgeManual}</span>
                </div>
                <div class="num-field">
                  <input type="text" id="wf-motor-name" data-param-key="motor_name" placeholder="${t("wf.motor.name_ph") || "如 DJI_2312S、F40"}" value="${mgr.get("motor_name").candidate.value || "DJI_2312S"}" style="text-align:center;padding:0 8px;" />
                </div>
              </div>
            </div>
            ${row("v_rated", "0.1", "battHigh")}
            ${row("pp", "1", "poles")}
            ${row("rs", "0.0001", "resistor")}
            ${row("ld", "0.01", "inductor")}
            ${row("flux", "0.00001", "flux")}
          </div>

          <!-- 右栏：每一行的对偶右项 -->
          <div class="form-list">
            ${row("max_rpm", "1", "gauge")}
            ${row("i_rated", "0.1", "alert")}
            ${row("kv", "1", "gauge")}
            ${row("ls", "0.01", "inductor")}
            ${row("lq", "0.01", "inductor")}
            ${row("saliency", "0.001", "poles")}
          </div>
        </div>

        <!-- 底部全局状态胶囊指示器 -->
        <div class="param-top-status param-bottom-status">
          <div class="param-status-capsules">
            ${closeLoopCap}
            ${flashCap}
          </div>
          <div class="param-status-tip" style="color:var(--text-faint);font-size:11px;">
            提示：点击【⚡ 辨识】或【⚠ DIFF】可查看多源溯源卡与重测
          </div>
        </div>
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
    // 基础参数解析
    const ppM = pick(/pp=([0-9.]+)/i) || pick(/Pole Pairs=([0-9.]+)/i);
    const rpmM = pick(/max_rpm=([0-9.]+)/i) || pick(/maxrpm=([0-9.]+)/i);
    const limM = pick(/limit=([0-9.]+)/i);
    const vbusM = pick(/vbus=([0-9.]+)/i);

    // conf read: Rs ohm, Ls uH
    const rsConf = pick(/Rs=([0-9.]+)/i);
    const lsConf = pick(/Ls=([0-9.]+)/i);

    // ident show:
    const rsId = pick(/Rs=([0-9.]+)\s*ohm/i);
    const lsId = pick(/Ls=([0-9.]+)\s*uH/i);
    const ld = pick(/Ld=([0-9.]+)\s*uH/i) || pick(/Ld=([0-9.]+)/i);
    const lq = pick(/Lq=([0-9.]+)\s*uH/i) || pick(/Lq=([0-9.]+)/i);
    const flux = pick(/Flux=([0-9.]+)\s*Wb/i) || pick(/Flux=([0-9.]+)/i) || pick(/flux[^\n=]*=([0-9.]+)/i);

    // 同步到内核中 (覆盖全部物理参数的 active 读取池)
    this.paramMgr.syncFromMcuRam({
      pp: ppM ? Number(ppM) : null,
      max_rpm: rpmM ? Number(rpmM) : null,
      i_rated: limM ? Number(limM) : null,
      v_rated: vbusM ? Number(vbusM) : null,
      rs: rsId ? Number(rsId) : (rsConf ? Number(rsConf) : null),
      ls: lsId ? Number(lsId) : (lsConf ? Number(lsConf) : null),
      ld: ld ? Number(ld) : null,
      lq: lq ? Number(lq) : null,
      flux: flux ? Number(flux) : null,
    });

    if (rpmM) this._syncMaxRpm(rpmM);
    if (limM) this._syncCurrentLimit(limM);

    // 重新渲染电机表单与状态胶囊
    this.render();

    // 触发读取量专用高亮动画 (只点亮左侧读到有效数据的读取胶囊，绝不误闪右侧辨识/手填徽章与输入框)
    this.root.querySelectorAll(".param-read-pill.has-data").forEach((pill) => {
      pill.classList.remove("read-bloom");
      void pill.offsetWidth;
      pill.classList.add("read-bloom");
      setTimeout(() => pill.classList.remove("read-bloom"), 1400);
    });

    if (badge) badge.textContent = t("wf.motor.from_device");
    if (!silent) this._toast(t("wf.motor.read_done"), "ok");
  }

  /**
   * 触发电机参数辨识任务：
   * @param {"full"|"rs"|"ldq"|"pp"|"flux"} mode 辨识模式
   */
  async _runMotorIdent(mode = "full") {
    const btn = this.root.querySelector("#btn-action-ident");
    if (!btn) return;

    const modeConfigs = {
      full: { cmd: "ident full", name: "全套参数辨识", tip: "电机将从静止到平稳旋转，自动测定阻抗、极对数与磁链。\n【请确保电机未卡死且空载自由旋转】", time: 8500, timeout: 14000 },
      rs:   { cmd: "ident rs",   name: "静态阻抗测量", tip: "电机转子将保持静止锁死不动，安全测定相电阻与相电感。\n【带载/机械受限场景安全推荐】", time: 3000, timeout: 6000 },
      ldq:  { cmd: "ident ldq",  name: "凸极特性测量", tip: "电机转子将保持静止，高频注入测定 Ld、Lq 与凸极比。\n【转子保持静止】", time: 4000, timeout: 7000 },
      pp:   { cmd: "ident pp",   name: "极对数测定", tip: "电机转子将开环低速旋转 4 个电周期测定极对数。\n【请确保电机可以微转】", time: 3000, timeout: 6000 },
      flux: { cmd: "ident flux", name: "磁链常数测定", tip: "电机转子将平稳加速至 300 RPM 测定反电动势与磁链。\n【请确保电机空载自由旋转】", time: 4000, timeout: 7000 },
    };

    const cfg = modeConfigs[mode] || modeConfigs.full;

    if (!confirm(`确定执行【${cfg.name}】吗？\n\n${cfg.tip}`)) {
      return;
    }

    btn.disabled = true;
    btn.classList.add("loading");
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;"></span><span>${cfg.name}...</span>`;
    const prog = this._startTaskProgress(cfg.name, cfg.time);

    // 触发具备自辨识属性字段的微光扫描波浪动效
    const identEls = this.root.querySelectorAll(".ident-field, .is-ident-row");
    identEls.forEach((el) => el.classList.add("is-identifying"));

    try {
      this.paramMgr.startIdentSession(mode);
      if (this.sendCapture) {
        const res = await this.sendCapture(cfg.cmd, cfg.timeout);
        if (res.includes("ident FAIL") || res.includes("err:")) {
          prog.fail(t("wf.ident.fail") || "辨识未通过，请检查接线或母线供电");
          this.paramMgr.discardIdentSession();
        } else {
          // 查询 ident show 解析最新实测值注入 Session
          const showTxt = await this.sendCapture("ident show", 500);
          const pickVal = (re) => {
            const m = showTxt.match(re);
            return m ? Number(m[1]) : null;
          };
          const rs = pickVal(/Rs=([0-9.]+)\s*ohm/i);
          const ls = pickVal(/Ls=([0-9.]+)\s*uH/i);
          const ld = pickVal(/Ld=([0-9.]+)\s*uH/i);
          const lq = pickVal(/Lq=([0-9.]+)\s*uH/i);
          const pp = pickVal(/Pole\s*Pairs=([0-9.]+)/i);
          const flux = pickVal(/Flux=([0-9.]+)\s*Wb/i);

          this.paramMgr.feedIdentResult({ rs, ls, ld, lq, pp, flux });
          prog.done(`${cfg.name}已完成`);
          this._showBatchAdoptBar();
          this.render();

          // 辨识完成后，触发对应辨识项的青绿光晕动画 (明确辨识产出)
          ["wf-rs", "wf-ls", "wf-ld", "wf-lq", "wf-pp", "wf-flux", "wf-kv", "wf-saliency"].forEach((id) => {
            const row = this.root.querySelector(`#${id}`)?.closest(".form-row");
            const badge = row?.querySelector(".ident-badge");
            const field = row?.querySelector(".num-field");
            if (badge) {
              badge.classList.remove("ident-bloom");
              void badge.offsetWidth;
              badge.classList.add("ident-bloom");
              setTimeout(() => badge.classList.remove("ident-bloom"), 1500);
            }
            if (field) {
              field.classList.remove("ident-bloom");
              void field.offsetWidth;
              field.classList.add("ident-bloom");
              setTimeout(() => field.classList.remove("ident-bloom"), 1500);
            }
          });
        }
      } else {
        await this._cli(cfg.cmd);
        setTimeout(async () => {
          await this._readMotorParams({ silent: true });
          prog.done(`${cfg.name}已完成`);
        }, cfg.time);
      }
    } catch (e) {
      this.paramMgr.discardIdentSession();
      prog.fail(t("wf.ident.fail") || "辨识超时或通信中断");
    } finally {
      identEls.forEach((el) => el.classList.remove("is-identifying"));
      if (this.sendCapture) {
        btn.disabled = false;
        btn.classList.remove("loading");
        btn.innerHTML = origHtml;
      } else {
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("loading");
          btn.innerHTML = origHtml;
        }, cfg.time);
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
        // calib full 寻相吸附并慢速找 Z，耗时约 3~6 秒
        const res = await this.sendCapture("calib full", 12000);
        if (res.includes("calib FAIL") || res.includes("err:")) {
          prog.fail(t("wf.calib.fail") || "校准失败，请检查编码器接线或转向");
        } else {
          await this._readBoardInfo();
          prog.done(t("wf.calib.done"));
        }
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
      <!-- 1. 实时传感器与角度源状态看板 -->
      <section class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("search", t("enc.status"))}
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
          ${sectionHead("gear", t("enc.arch.title") || "反馈传感器架构分类")}
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
      <!-- 分类 A: 有感增量式面板 (CPR设置 + 零点寻相校准，操作按钮与电机页参数卡同构) -->
      <div id="enc-panel-inc" class="enc-cat-panel">
        <section class="wf-card">
          <div class="wf-card-head">
          ${sectionHead("poles", `${t("wf.encoder.type")} · ${t("wf.encoder.abz")}`)}
            <div class="wf-card-actions">
              <button class="danger" id="btn-action-calib" title="${t("wf.calib.note")}">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/></svg>
                <span>${t("wf.calib.full")}</span>
              </button>
              <button class="ok" id="wf-enc-cpr-set">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>${t("wf.apply")}</span>
              </button>
            </div>
          </div>
          <div class="form-list">
            <div class="form-row">
              <label for="wf-enc-cpr">${t("enc.cpr.label")}</label>
              <div class="form-row-trail">
                <div class="num-field">
                  <input type="number" id="wf-enc-cpr" step="1" min="16" max="65536" value="2048" />
                  <span class="num-unit">cnt</span>
                </div>
              </div>
            </div>
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
          ${sectionHead("gear", t("enc.abs.config") || "绝对值磁编码器配置")}
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
            <button id="btn-abs-save" class="ok small" data-cmd="conf write" data-confirm="confirm.conf_write">${t("wf.motor.conf_write")}</button>
          </div>
          <p class="wf-note">${t("enc.abs.note") || "绝对值编码器出厂上电即知机械角，无需每次转动校准，写入 Flash 即可长期记忆。"}</p>
        </section>
      </div>

      <!-- 分类 C: 纯无感面板 (观测器平滑过渡与自适应接管) -->
      <div id="enc-panel-sl" class="enc-cat-panel" hidden>
        <section class="wf-card">
          <div class="wf-card-head">
          ${sectionHead("radar", t("enc.sensorless"))}
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
            <button class="danger" id="enc-obs-switch" data-cmd="obs 2" data-confirm="confirm.feedback">${t("enc.step2")}</button>
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
          ${sectionHead("compass", t("wf.encoder.source"))}
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
    const tuneField = (id, label, unit, min, max, step, val, icon) => `
      <div class="form-row">
        ${formLbl(id, icon || "dial", label)}
        <div class="form-row-trail">
          <div class="num-field">
            <input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />
            <span class="num-unit">${unit}</span>
          </div>
        </div>
      </div>`;
    return `
      <section class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("wave", t("wf.pid.h"))}
          <div class="wf-card-actions">
            <button class="ok" id="wf-pid-apply">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.5 3.5L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.apply")}</span>
            </button>
            <button id="wf-pid-read">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8a6 6 0 1 0 1.5-3.9M2 2.5v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>${t("wf.pid.read")}</span>
            </button>
            <button class="danger" id="wf-pid-save" data-confirm="confirm.conf_write" title="${t("wf.pid.save_flash_tip")}">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h8l2 2v8H3V3zM5 3v4h6V3M5 13v-4h6v4" stroke-linejoin="round"/></svg>
              <span>${t("wf.pid.save_flash")}</span>
            </button>
            <span id="wf-pid-dirty-badge" class="dirty-notice" style="display:none;">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="8" r="7" opacity="0.2"/><circle cx="8" cy="8" r="4"/></svg>
              <span>${t("wf.pid.dirty")}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- 1. 电流环整定与保护限幅 -->
      <div class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("wave", t("wf.pid.title_current"))}
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-bw", t("wf.pid.current_bw"), "rad/s", 100, 3000, 50, 2000, "wave")}
          </div>
          <div class="form-list">
            ${tuneField("wf-limit-val", t("wf.pid.limit"), "A", 0.1, 15.0, 0.1, 5.2, "gauge")}
          </div>
        </div>
      </div>

      <!-- 2. 速度环与运动加减速规划 -->
      <div class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("speed", t("wf.pid.title_vel"))}
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-vkp", t("wf.pid.vel_kp"), "A/RPM", 0, 2.0, 0.005, 0.02, "dial")}
            ${tuneField("wf-vki", t("wf.pid.vel_ki"), "A/(RPM·s)", 0, 5.0, 0.005, 0.02, "dial")}
            ${tuneField("wf-vramp", t("wf.pid.vel_ramp"), "RPM/s", 0, 100000, 500, 10000, "ramp")}
          </div>
          <div class="form-list">
            ${tuneField("wf-vfilt", t("wf.pid.vel_filter"), "Hz", 5, 200, 5, 50, "filter")}
            ${tuneField("wf-vff", t("wf.pid.vel_ff"), "A", 0, 2.0, 0.01, 0.0, "friction")}
            ${tuneField("wf-vtrack", t("wf.pid.vel_track"), "A/rad", 0, 100, 0.1, 0.0, "target")}
          </div>
        </div>
      </div>

      <!-- 3. 位置环与轨迹规划 -->
      <div class="wf-card">
        <div class="wf-card-head">
          ${sectionHead("pos", t("wf.pid.title_pos"))}
        </div>
        <div class="form-list-2col">
          <div class="form-list">
            ${tuneField("wf-pkp", t("wf.pid.pos_kp"), "A/rad", 0, 500, 0.5, 10, "dial")}
            ${tuneField("wf-pki", t("wf.pid.pos_ki"), "A/(rad·s)", 0, 50, 0.05, 0, "dial")}
            ${tuneField("wf-pvkp", t("wf.pid.pos_vkp"), "A/RPM", 0, 0.5, 0.002, 0.02, "target")}
          </div>
          <div class="form-list">
            ${tuneField("wf-paccel", t("wf.pid.pos_accel"), "RPM/s", 100, 100000, 500, 5000, "accel")}
            ${tuneField("wf-pvmax", t("wf.pid.pos_vmax"), "RPM", 100, 10000, 100, 3000, "gauge")}
            <div class="form-row form-row-spacer" aria-hidden="true"></div>
          </div>
        </div>
      </div>`;
  }

  _htmlRun() {
    return `
      <div class="wf-card" style="gap:16px">
        <div class="wf-card-head">
          ${sectionHead("play", t("wf.run.h"))}
          <div id="dash-chips-host" class="dash-chips-host"></div>
        </div>
        <div id="wf-dashboard-host" class="wf-dash-host" style="margin:0"></div>
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
        const already = card.classList.contains("active");
        const connected = this.isConnected();
        // 已连接时切换主反馈需确认；取消则 UI 不变
        if (!already && connected && (cat === "sl" || cat === "inc" || cat === "abs")) {
          if (!confirm(t("confirm.feedback"))) return;
        }
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

        // 未连接：仅浏览配置面板，不下发 feedback
        if (already || !connected) return;
        if (cat === "sl") {
          if (this.send) Promise.resolve(this.send("feedback sensorless")).then(() => this._refreshEncoderStatus());
        } else if (cat === "inc" || cat === "abs") {
          if (this.send) Promise.resolve(this.send("feedback sensored")).then(() => this._refreshEncoderStatus());
        }
      });
    });

    // 绝对值零位：读取当前角，确认后执行 pos zero（固件可写命令）
    this.root.querySelector("#btn-abs-read-zero")?.addEventListener("click", async () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      if (this.sendCapture) {
        try {
          const txt = await this.sendCapture("pos", 350);
          const m = txt.match(/abs=([0-9.+-]+)rad/) || txt.match(/pos=([0-9.+-]+)/);
          if (m && m[1]) {
            const zInput = this.root.querySelector("#wf-abs-zero-val");
            if (zInput) zInput.value = Number(m[1]).toFixed(3);
            this._toast(t("enc.abs.read_done"), "ok");
            if (confirm(t("confirm.pos_zero"))) {
              await this._cli("pos zero");
              this._toast(t("enc.abs.set_zero_done"), "ok");
            }
          }
        } catch {
          this._toast(t("enc.abs.read_fail"), "err");
        }
      }
    });

    // CPR：固件为编译期常量，仅提示
    this.root.querySelector("#wf-enc-cpr-set")?.addEventListener("click", async () => {
      const cpr = Number(this.root.querySelector("#wf-enc-cpr")?.value);
      if (!Number.isFinite(cpr) || cpr <= 0) return;
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      await this._cli(`cpr ${cpr}`);
      this._toast(t("enc.cpr.applied"), "ok");
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
    const modeEl = this.root.querySelector("#enc-st-mode");
    const calibEl = this.root.querySelector("#enc-st-calib");
    const offsetEl = this.root.querySelector("#enc-st-offset");

    // 精简版 10 字节 STATUS 心跳已不含 mode/rpm，改从 status 文本回显解析
    if (this.sendCapture) {
      try {
        const text = await this.sendCapture("status", 350);
        const mode = text.match(/mode=(vf|iq|vel|pos)/);
        if (mode) this._encMode = mode[1];
        const vel = text.match(/\bvel=([0-9.+-]+)rpm/);
        if (vel) this._encRpm = Number(vel[1]);
        if (modeEl && this._encMode) modeEl.textContent = t(`mode.${this._encMode}`);

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
    // 转速优先取 500Hz 波形 ch2（vel_ctrl）；无波形时回退到最近一次 status 文本
    const latest = this.getLatest?.();
    const live = latest && Number.isFinite(latest[2]) ? latest[2] : this._encRpm;
    const rpm = Number.isFinite(live) ? Math.abs(live) : NaN;
    const modeOk = this._encMode === "vel";
    const rpmOk = Number.isFinite(rpm) && rpm > 800;

    const gMode = this.root.querySelector("#enc-g-mode");
    const gRpm = this.root.querySelector("#enc-g-rpm");
    const rpmEl = this.root.querySelector("#enc-st-rpm");
    const switchBtn = this.root.querySelector("#enc-obs-switch");

    if (gMode && this._encMode) {
      gMode.textContent = t(`mode.${this._encMode}`);
      gMode.className = `metric-val ${modeOk ? "text-ok" : "text-warn"}`;
    }
    const rpmTxt = Number.isFinite(rpm) ? `${rpm.toFixed(0)}` : "—";
    if (gRpm) {
      gRpm.textContent = rpmTxt;
      gRpm.className = `metric-val ${rpmOk ? "text-ok" : "text-warn"}`;
    }
    if (rpmEl) rpmEl.textContent = rpmTxt;
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
        if (!this.isConnected()) {
          this._toast(t("sys.need_connect"), "err");
          return;
        }
        if (conf) {
          const msg = conf.includes(".") ? t(conf) : conf;
          if (!confirm(msg)) return;
        }
        Promise.resolve(this._cli(cmd)).then(() => {
          if (cmd === "conf write") {
            this.paramMgr.markPersistedToFlash();
            this.render();
          }
          if (toastKey) this._toast(t(toastKey), "ok");
        }).catch(() => {
          if (toastKey) this._toast(t("wf.task.fail"), "err");
        });
      });
    });
    this.root.querySelector("#btn-action-apply-params")?.addEventListener("click", () => this._applyMotorParamsFromForm());
    this.root.querySelector("#wf-read-info")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._readBoardInfo();
    });
    this.root.querySelector("#wf-health-check")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._runHealthCheck();
    });
    this.root.querySelector("#wf-copy-report")?.addEventListener("click", () => this._copyHealthReport());
    this.root.querySelector("#wf-read-params")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._readMotorParams();
    });
    this.root.querySelector("#wf-motor-export")?.addEventListener("click", () => this._exportMotorParams());
    this.root.querySelector("#wf-motor-import")?.addEventListener("click", () => {
      this.root.querySelector("#wf-motor-import-file")?.click();
    });
    this.root.querySelector("#wf-motor-import-file")?.addEventListener("change", (e) => this._importMotorParams(e));
    this.root.querySelector("#btn-action-ident")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._runMotorIdent("full");
    });

    // 辨识下拉菜单切换与各项触发
    const identMenuToggle = this.root.querySelector("#btn-ident-menu-toggle");
    const identMenu = this.root.querySelector("#ident-dropdown-menu");
    if (identMenuToggle && identMenu) {
      identMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        identMenu.hidden = !identMenu.hidden;
      });
      identMenu.querySelectorAll(".menu-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const mode = item.getAttribute("data-ident-mode");
          identMenu.hidden = true;
          if (!this.isConnected()) {
            this._toast(t("sys.need_connect"), "err");
            return;
          }
          this._runMotorIdent(mode);
        });
      });
      const closeIdentMenu = (e) => {
        if (!identMenu.contains(e.target) && e.target !== identMenuToggle) {
          identMenu.hidden = true;
        }
      };
      document.addEventListener("click", closeIdentMenu);
    }
    this.root.querySelector("#btn-action-calib")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._runMotorCalib();
    });

    /* 编码器页：状态 / 模式卡片 / 无感联锁。
     * 只在编码器页接线：其它页面不应并发发 status，且每次渲染必须先清掉旧定时器 */
    if (this._encGuardTimer) {
      clearInterval(this._encGuardTimer);
      this._encGuardTimer = null;
    }
    if (this.step === "encoder") {
      this._wireEncoder();
    }

    // 监听电机表单所有参数输入变化，驱动内核与单向推导
    const motorInputs = this.root.querySelectorAll("[data-param-key]");
    motorInputs.forEach((input) => {
      const key = input.getAttribute("data-param-key");
      input.addEventListener("input", (e) => {
        const val = e.target.value;
        this.paramMgr.setUserInput(key, val);

        // 如果用户编辑的是极对数或 KV，刷新推导出的磁链或 KV
        const derivedFlux = this.paramMgr.get("flux").candidate.value;
        const derivedKv = this.paramMgr.get("kv").candidate.value;
        const fluxInput = this.root.querySelector("#wf-flux");
        const kvInput = this.root.querySelector("#wf-kv");
        const salInput = this.root.querySelector("#wf-saliency");

        if (fluxInput && document.activeElement !== fluxInput && derivedFlux !== null) {
          fluxInput.value = Number(derivedFlux).toFixed(5);
        }
        if (kvInput && document.activeElement !== kvInput && derivedKv !== null) {
          kvInput.value = String(Math.round(derivedKv));
        }
        if (salInput) {
          const salVal = this.paramMgr.get("saliency").candidate.value;
          salInput.value = salVal !== null ? Number(salVal).toFixed(3) : "";
        }

        // 同步最大转速与电流软限
        if (key === "max_rpm" && val) this._syncMaxRpm(Number(val));
      });
    });

    // 监听单行“读取数据引用到手填”三角形按钮与读取胶囊
    this.root.querySelectorAll("[data-import-read-key]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (el.tagName === "BUTTON" && el.disabled) return;
        e.stopPropagation();
        const key = el.getAttribute("data-import-read-key");
        const p = this.paramMgr.get(key);
        if (p && p.active?.value !== null && p.active?.value !== undefined) {
          const readVal = p.active.value;
          this.paramMgr.setUserInput(key, readVal);
          this.paramMgr.selectSourceForCandidate(key, "manual");
          this.render();
          const input = this.root.querySelector(`input[data-param-key="${key}"]`);
          if (input) {
            input.focus();
            input.select();
            input.classList.add("input-flash-success");
            setTimeout(() => input.classList.remove("input-flash-success"), 1000);
          }
          const isZh = (typeof getLang === "function" ? getLang() : "zh") !== "en";
          const schemaName = p.schema?.name || key;
          this._toast(
            isZh ? `已将【${schemaName}】读取值 (${readVal}) 引用至手填` : `Applied readback ${readVal} to manual`,
            "ok"
          );
        }
      });
    });

    // 监听点击参数标签徽章或分歧徽章，弹出溯源 Popover 卡片 (固定手填项静默不弹窗)
    this.root.querySelectorAll(".ident-badge, .diff-badge").forEach((badge) => {
      if (badge.hasAttribute("data-static")) return; // 固定手填项不注册点击事件
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        const paramKey = badge.getAttribute("data-param-key");
        if (paramKey) {
          this._showProvenancePopover(badge, paramKey);
        }
      });
    });

    // 监听点击被锁定的辨识数值框：引导用户在溯源卡中采纳手填
    this.root.querySelectorAll(".num-field.is-locked").forEach((lockedField) => {
      lockedField.addEventListener("click", (e) => {
        const input = lockedField.querySelector("input[data-param-key]");
        const paramKey = input?.getAttribute("data-param-key");
        const badge = this.root.querySelector(`.ident-badge[data-param-key="${paramKey}"]`);
        if (badge && paramKey) {
          e.stopPropagation();
          this._showProvenancePopover(badge, paramKey);
          this._toast(`⚡ 系统辨识实测值已锁定保护，点击卡片中的【采纳】手填后即可解锁修改`, "info");
        }
      });
    });

    // 监听批量采纳横条按钮
    this.root.querySelector("#btn-batch-apply-safe")?.addEventListener("click", () => {
      const res = this.paramMgr.applyIdentSession(true);
      this.render();
      if (res.skippedKeys.length > 0) {
        this._toast(`已采纳 ${res.appliedCount} 项安全参数，已跳过冲突项: ${res.skippedKeys.join(", ")}`, "warn");
      } else {
        this._toast(`已成功批量采纳 ${res.appliedCount} 项辨识参数！`, "ok");
      }
    });

    this.root.querySelector("#btn-batch-discard")?.addEventListener("click", () => {
      this.paramMgr.discardIdentSession();
      const bar = this.root.querySelector("#batch-adopt-bar");
      if (bar) bar.hidden = true;
    });

    if (this.paramMgr?.activeSession && Object.keys(this.paramMgr.activeSession.results || {}).length > 0) {
      this._showBatchAdoptBar();
    }

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
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      const vLimit = Number(this.root.querySelector("#wf-limit")?.value);
      const vUv = Number(this.root.querySelector("#wf-uv")?.value);
      const vOv = Number(this.root.querySelector("#wf-ov")?.value);

      if (Number.isFinite(vLimit) && vLimit > 0) {
        await this._cli(`limit ${vLimit}`);
        this._syncCurrentLimit(vLimit);
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
      this._toast(t("wf.safety.applied"), "ok");
    });
    // 输入时三处联动（未下发也保持界面一致）
    const limitDev = this.root.querySelector("#wf-limit");
    limitDev?.addEventListener("input", () => {
      const lim = Number(limitDev.value);
      if (Number.isFinite(lim) && lim > 0) this._syncCurrentLimit(lim);
    });
    ["wf-limit2", "wf-limit-val"].forEach((id) => {
      this.root.querySelector(`#${id}`)?.addEventListener("input", (e) => {
        const lim = Number(e.target.value);
        if (Number.isFinite(lim) && lim > 0) this._syncCurrentLimit(lim);
      });
    });
    this.root.querySelector("#wf-maxrpm")?.addEventListener("input", (e) => {
      const r = Number(e.target.value);
      if (Number.isFinite(r) && r > 0) this._syncMaxRpm(r);
    });
    // 调参：一次应用全部
    this.root.querySelector("#wf-pid-apply")?.addEventListener("click", async () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
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
      if (Number.isFinite(limitVal) && limitVal > 0) {
        await this._cli(`limit ${limitVal}`);
        this._syncCurrentLimit(limitVal);
      }
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
      this._toast(t("wf.pid.apply_done"), "ok");
      this._markPidClean();
    });
    this.root.querySelector("#wf-pid-read")?.addEventListener("click", () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      this._readPid();
    });
    this.root.querySelector("#wf-pid-save")?.addEventListener("click", async () => {
      if (!this.isConnected()) {
        this._toast(t("sys.need_connect"), "err");
        return;
      }
      const conf = this.root.querySelector("#wf-pid-save")?.getAttribute("data-confirm");
      if (conf) {
        const msg = conf.includes(".") ? t(conf) : conf;
        if (!confirm(msg)) return;
      }
      await this._cli("conf write");
      this.paramMgr.markPersistedToFlash();
      // 固化后更新基准并触发同步动画
      this._markPidClean();
      this.render();
    });

    // 监听调参输入脏状态（切页重绘后以当前表单重建基准，避免误报）
    if (this.step === "pid") {
      this.pidBaseline = {};
    }
    PID_INPUT_IDS.forEach((id) => {
      const input = this.root.querySelector(`#${id}`);
      if (input) {
        if (this.pidBaseline[id] === undefined) {
          this.pidBaseline[id] = input.value;
        }
        input.addEventListener("input", () => this._checkPidDirty());
      }
    });
    if (this.step === "pid") {
      this._checkPidDirty();
    }
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
      const limP = pick(confText, /limit=([0-9.]+)/);
      if (limP) this._syncCurrentLimit(limP);
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
          unitEl.textContent = t("wf.motor.saliency_spmsm");
          unitEl.style.color = "var(--ok, #7fd962)";
        } else {
          unitEl.textContent = t("wf.motor.saliency_ipmsm");
          unitEl.style.color = "var(--primary, #58a6ff)";
        }
      }
    } else {
      salEl.value = "";
      if (unitEl) {
        unitEl.textContent = t("wf.motor.saliency_ratio");
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
      rated_voltage_v: Number(getVal("wf-v-rated")) || 14.8,
      rated_current_a: Number(getVal("wf-i-rated")) || 3.5,
      kv_rpm_v: Number(getVal("wf-kv")) || 960,
      pole_pairs: Number(getVal("wf-pp")) || 7,
      rs_ohm: Number(getVal("wf-rs")) || 0,
      ls_uh: Number(getVal("wf-ls")) || 0,
      ld_uh: Number(getVal("wf-ld")) || 0,
      lq_uh: Number(getVal("wf-lq")) || 0,
      saliency_ratio: Number(getVal("wf-saliency")) || 1.0,
      flux_linkage_wb: Number(getVal("wf-flux")) || 0,
      max_rpm: Number(getVal("wf-maxrpm")) || 12000,
      current_limit_a: Number(getVal("wf-limit")) || 5.2,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `motor_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._toast(t("wf.motor.export_done"), "ok");
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
        if (d.rated_voltage_v !== undefined) setVal("wf-v-rated", Number(d.rated_voltage_v).toFixed(1));
        if (d.rated_current_a !== undefined) setVal("wf-i-rated", Number(d.rated_current_a).toFixed(1));
        if (d.kv_rpm_v !== undefined) setVal("wf-kv", Math.round(Number(d.kv_rpm_v)));
        if (d.pole_pairs !== undefined) setVal("wf-pp", d.pole_pairs);
        if (d.rs_ohm !== undefined) setVal("wf-rs", Number(d.rs_ohm).toFixed(4));
        if (d.ls_uh !== undefined) setVal("wf-ls", Number(d.ls_uh).toFixed(2));
        if (d.ld_uh !== undefined) setVal("wf-ld", Number(d.ld_uh).toFixed(2));
        if (d.lq_uh !== undefined) setVal("wf-lq", Number(d.lq_uh).toFixed(2));
        if (d.flux_linkage_wb !== undefined) setVal("wf-flux", Number(d.flux_linkage_wb).toFixed(5));
        if (d.max_rpm !== undefined) setVal("wf-maxrpm", d.max_rpm);
        if (d.current_limit_a !== undefined) {
          const lim = Number(d.current_limit_a);
          setVal("wf-limit", lim.toFixed(1));
          this._syncCurrentLimit(lim);
        }

        this._updateSaliencyRatio();
        this._toast(t("wf.motor.import_done"), "ok");
      } catch (err) {
        this._toast(t("wf.motor.import_fail"), "err");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  /** 显示辨识完成批量采纳横条 */
  _showBatchAdoptBar() {
    const bar = this.root.querySelector("#batch-adopt-bar");
    const msg = this.root.querySelector("#batch-adopt-msg");
    const sess = this.paramMgr.activeSession;
    if (!bar || !sess || !sess.results) return;

    const count = Object.keys(sess.results).length;
    if (this.paramMgr.ppConflict) {
      bar.classList.add("has-conflict");
      if (msg) msg.textContent = `⚠ 辨识完成 (${count}项)：检测到极对数冲突！采纳将保护跳过该项。`;
    } else {
      bar.classList.remove("has-conflict");
      if (msg) msg.textContent = `✔ 辨识已完成，测得 ${count} 项高阶电机参数。`;
    }
    bar.hidden = false;
  }

  /** 显示 Popover 参数溯源卡 (仅呈现真实来源纯文本展示、采纳切换与三源对比，窗口内不提供输入框) */
  _showProvenancePopover(targetEl, paramKey) {
    // 先清理已存在的 Popover
    document.querySelectorAll(".provenance-popover").forEach((p) => p.remove());

    const p = this.paramMgr.get(paramKey);
    if (!p || p.schema?.isFixedManual) return; // 固定手填参数严格禁止弹窗
    const schema = p.schema;

    const popover = document.createElement("div");
    popover.className = "provenance-popover";

    const isZh = (typeof getLang === "function" ? getLang() : "zh") !== "en";
    const lblManual = isZh ? "✎ 手填" : "✎ Manual";
    const lblIdent = isZh ? "⚡ 辨识" : "⚡ Identified";
    const lblRead = isZh ? "📥 读取" : "📥 Read";
    const txtInUse = isZh ? "✔ 使用中" : "✔ In use";
    const btnAdopt = isZh ? "采纳" : "Adopt";
    const txtUnmeasured = isZh ? "未测定" : "Not yet";
    const txtUnread = isZh ? "未读取" : "No data";

    const fmt = (v) => (v !== null && v !== undefined ? (schema.decimals !== null ? Number(v).toFixed(schema.decimals) : v) : "—");
    const curSrc = p.candidate.source; // 当前正在生效的来源

    const hasManual = schema.sources?.includes("manual");
    const hasIdent = schema.sources?.includes("identified");
    const hasRead = schema.sources?.includes("active");

    let rowsHtml = "";

    // 1. 手填来源行 (纯文本数值展示，点击采纳后在主界面修改)
    if (hasManual) {
      const manualVal = p.sources.manual !== null && p.sources.manual !== undefined ? p.sources.manual : (curSrc === "manual" ? p.candidate.value : null);
      const isManualInUse = curSrc === "manual";
      const manualAct = isManualInUse
        ? `<span class="source-in-use">${txtInUse}</span>`
        : `<button class="btn-adopt" data-adopt-src="manual">${btnAdopt}</button>`;

      rowsHtml += `
        <tr class="${isManualInUse ? "is-active-row" : ""}">
          <td class="source-name">${lblManual}</td>
          <td class="source-val">
            <span class="source-val-text">${manualVal !== null ? `${fmt(manualVal)} ${schema.unit || ""}` : `<span style="color:var(--text-faint);">—</span>`}</span>
          </td>
          <td class="source-act">${manualAct}</td>
        </tr>`;
    }

    // 2. 系统辨识行 (硬件算法实测真值，只读保护)
    if (hasIdent) {
      const identVal = p.sources.identified;
      const isIdentInUse = curSrc === "identified" || curSrc === "calculated";
      let identAct = "";
      if (isIdentInUse) {
        identAct = `<span class="source-in-use">${txtInUse}</span>`;
      } else if (identVal !== null && identVal !== undefined) {
        identAct = `<button class="btn-adopt" data-adopt-src="identified">${btnAdopt}</button>`;
      } else {
        identAct = `<span style="color:var(--text-faint);font-size:10px;">${txtUnmeasured}</span>`;
      }

      rowsHtml += `
        <tr class="${isIdentInUse ? "is-active-row" : ""}">
          <td class="source-name">${lblIdent}</td>
          <td class="source-val">
            <span class="source-val-text">${identVal !== null ? `${fmt(identVal)} ${schema.unit || ""}` : `<span style="color:var(--text-faint);">—</span>`}</span>
          </td>
          <td class="source-act">${identAct}</td>
        </tr>`;
    }

    popover.innerHTML = `
      <div class="popover-header">
        <div class="popover-title">
          <span>${schema.name}</span>
        </div>
        <button class="popover-close">&times;</button>
      </div>
      <table class="popover-table">
        <tbody>${rowsHtml}</tbody>
      </table>`;

    document.body.appendChild(popover);

    // 计算精确定位 (浮动在 targetEl 右下方或左侧，紧凑 260px 宽度)
    const rect = targetEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX - 10;
    if (left + 270 > window.innerWidth) {
      left = window.innerWidth - 280;
    }
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    // 单项采纳按钮：采纳手填后自动解锁主界面输入框并聚集，采纳辨识或读取后锁定保护
    popover.querySelectorAll("[data-adopt-src]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.getAttribute("data-adopt-src");
        this.paramMgr.selectSourceForCandidate(paramKey, src);
        this.render();
        popover.remove();
        if (src === "manual") {
          // 采纳手填后，主界面输入框解锁，自动聚焦便于直接在主界面输入修改
          const mainInput = this.root.querySelector(`input[data-param-key="${paramKey}"]`);
          if (mainInput) {
            mainInput.focus();
            mainInput.select();
          }
          this._toast(isZh ? `已采纳【手填】，右侧输入框已解锁，可直接修改数值` : `Adopted Manual, input unlocked`, "ok");
        } else if (src === "identified") {
          this._toast(isZh ? `已采纳【系统辨识】，右侧输入框已锁定保护不可修改` : `Adopted Identified, value locked`, "ok");
        } else if (src === "active") {
          this._toast(isZh ? `已采纳【单片机读取】，右侧输入框已锁定保护不可修改` : `Adopted MCU Read, value locked`, "ok");
        }
      });
    });

    popover.querySelector(".popover-close")?.addEventListener("click", () => popover.remove());

    // 点击外部自动关闭 Popover
    const outsideClick = (evt) => {
      if (!popover.contains(evt.target) && evt.target !== targetEl) {
        popover.remove();
        document.removeEventListener("click", outsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", outsideClick), 50);
  }

  /** 弹出极对数两级确认人工裁决模态框 */
  _showPpConflictModal() {
    document.querySelectorAll(".pp-modal-overlay").forEach((el) => el.remove());

    const modal = document.createElement("div");
    modal.className = "pp-modal-overlay";

    const pp = this.paramMgr.get("pp");
    const manualVal = pp.sources.manual;
    const identVal = pp.sources.identified;

    modal.innerHTML = `
      <div class="pp-modal-content">
        <div class="pp-modal-title">
          <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 2.2L1.9 13.2h12.2L8 2.2z"/><path d="M8 6.2v3.1M8 11.3h.01"/></svg>
          <span>极对数存在严重冲突 (安全阻断)</span>
        </div>
        <div class="pp-modal-body">
          系统检测到手册标称极对数与单片机实测辨识值严重不一致！极对数差 1 将导致换相电角度全盘错误并引发过流失控。系统已硬阻断闭环，请由工程师裁决最终采纳值：
        </div>
        <div class="pp-modal-options">
          <div class="pp-option-card selected" data-pp-choice="manual">
            <div style="font-size:11px;color:var(--text-dim);">采纳手册标称</div>
            <div class="pp-option-val">${manualVal || "7"}</div>
          </div>
          <div class="pp-option-card" data-pp-choice="identified">
            <div style="font-size:11px;color:var(--text-dim);">采纳实测辨识</div>
            <div class="pp-option-val">${identVal || "8"}</div>
          </div>
        </div>
        <div class="pp-modal-footer">
          <button id="btn-cancel-pp-modal" style="padding:6px 14px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;">暂不确认</button>
          <button class="ok" id="btn-confirm-pp-modal" style="padding:6px 16px;border-radius:6px;">确认裁决并解除门禁</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    let currentChoice = "manual";
    modal.querySelectorAll(".pp-option-card").forEach((card) => {
      card.addEventListener("click", () => {
        modal.querySelectorAll(".pp-option-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        currentChoice = card.getAttribute("data-pp-choice");
      });
    });

    modal.querySelector("#btn-cancel-pp-modal")?.addEventListener("click", () => modal.remove());
    modal.querySelector("#btn-confirm-pp-modal")?.addEventListener("click", () => {
      this.paramMgr.confirmPpChoice(currentChoice);
      modal.remove();
      this.render();
      this._toast(`已确认采纳极对数: ${this.paramMgr.get("pp").candidate.value}，闭环门禁已放行`, "ok");
    });
  }
}

export { STEPS as WORKFLOW_STEPS };

