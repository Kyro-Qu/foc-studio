/**
 * 轻量 i18n：默认中文，可切 English。localStorage 持久化。
 */

export const LANGS = ["zh", "en"];

const STRINGS = {
  zh: {
    "nav.dashboard": "仪表盘",
    "nav.scope": "示波器",
    "nav.console": "控制台",
    "nav.tuning": "调参",
    "nav.terminal": "终端",
    "nav.record": "录制",
    "mode.uart": "串口",
    "mode.sim": "仿真",
    "mode.replay": "回放",
    "baud": "波特率",
    "sim": "仿真",
    "sim.1k": "1 kHz",
    "sim.2k": "2 kHz",
    "sim.5k": "5 kHz 压力",
    "connect": "连接",
    "reconnect": "重连",
    "disconnect": "断开",
    "estop": "急停",
    "status.off": "未连接",
    "status.connecting": "连接中…",
    "status.connected": "已连接",
    "status.error": "错误",
    "status.sim": "仿真中",
    "status.stress": "仿真压力",
    "status.replay": "回放中",
    "status.connecting2": "连接中",
    "status.disconnecting": "断开中",
    "panel.dashboard.title": "实时状态（与示波器同一帧源）",
    "panel.scope.title": "实时示波器 — FOC-STP v1.0 自解释 32 通道 · 点击设 t1/t2 · Shift/Alt 微调 · 滚轮缩放",
    "panel.console.title": "控制台 — 映射到现有 CLI（不改固件）",
    "panel.tuning.title": "调参 — 滑条/数字 → CLI（本地编辑值，非 MCU 回读）",
    "panel.terminal.title": "ASCII CLI（与遥测同一串口，自动解复用）",
    "panel.record.title": "录制 / 回放 / 标记",
    "preset.title": "通道预设",
    "preset.current": "电流",
    "preset.velocity": "速度",
    "preset.voltage": "电压",
    "preset.sensorless": "无感",
    "preset.all": "全开",
    "preset.none": "全关",
    "ch.title": "通道",
    "math.title": "数学",
    "legend.title": "图例",
    "window": "窗口",
    "pause": "暂停",
    "resume": "继续",
    "clear": "清屏",
    "clear.cursors": "清除游标",
    "png": "PNG",
    "csv": "CSV",
    "auto": "自动",
    "y": "Y",
    "trig": "触发",
    "src": "源",
    "level": "电平",
    "arm": "武装",
    "release": "解除",
    "cursor.hint": "鼠标移到波形可读值 · 点击设 t1/t2",
    "empty.scope": "等待遥测数据… 选择仿真或连接串口",
    "term.autoscroll": "自动滚动",
    "term.raw": "原始 RX",
    "rec.start": "开始录制",
    "rec.stop": "停止录制",
    "rec.mark": "标记",
    "rec.mark.ph": "标记说明",
    "rec.export.csv": "导出 CSV",
    "rec.export.json": "导出 JSON",
    "rec.load": "加载 CSV…",
    "rec.replay": "回放",
    "rec.replay.stop": "停止回放",
    "kbd.hint": "空格 暂停 · R 清屏 · E 急停 · 1–5 面板",
    "lang": "语言",
    "dash.fault": "故障",
    "dash.rpm": "转速",
    "dash.iq": "Iq",
    "dash.vbus": "母线",
    "dash.track": "跟踪",
    "dash.grp.speed": "速度环",
    "dash.grp.current": "电流环",
    "dash.grp.voltage": "电压 / 占空比",
    "dash.grp.angle": "角度 / 故障",
    "dash.ctrl.title": "快捷控制",
    "dash.ctrl.target": "目标",
    "dash.ctrl.mode": "模式",
    "dash.ctrl.send": "发送",
    "dash.ctrl.set": "设为",
    "dash.ctrl.enable": "使能",
    "dash.ctrl.disable": "停止",
    "dash.ctrl.note": "滑条为本地编辑，发送后经 CLI 写入；非 MCU 回读。",
    "dash.hint": "数据与示波器同源。故障位仅供参考，以固件 status/fault 命令为准。",
    "fb.title": "无感闭环控制 feedback",
    "fb.note": "无感独立闭环控制与状态观察（VESC + I/F 算法）。",
    "fb.status": "无感状态",
    "fb.sensorless": "切换纯无感",
    "fb.sensored": "切换编码器",
    "fb.auto": "自动降级模式",
    "fb.if_def": "默认 I/F 参数",
    "ident.title": "参数辨识 ident",
    "ident.note": "需 IDLE。Rs/Ls 静止；PP/磁链/Full 会转动电机。",
    "ident.rs": "Rs+Ls",
    "ident.ldq": "Ld/Lq",
    "ident.pp": "极对数",
    "ident.flux": "磁链",
    "ident.full": "完整辨识",
    "ident.show": "显示结果",
    "ident.apply": "应用到 RAM",
    "ident.busy": "辨识进行中…",
    "mode.vf": "开环强拖",
    "mode.iq": "电流环",
    "mode.vel": "速度环",
    "mode.pos": "位置环",
    "advanced": "高级",
    "sys.boot": "FOC Studio v0.3.6 — 示波器/图例 · 调参 · 控制台 · 录制 · 串口遥测 500 Hz",
    "sys.sim": "[sys] 仿真 @ {rate} Hz\n",
    "sys.serial": "[sys] 串口模式\n",
    "sys.replay": "[sys] 回放模式 — 在录制页加载 CSV 后点回放\n",
    "sys.noserial": "[sys] 无 Web Serial。请用 Chrome/Edge，或使用仿真/回放。\n",
    "sys.estop": "[sys] 急停 → disable\n",
    "sys.disconnected": "[sys] 已断开\n",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.scope": "Scope",
    "nav.console": "Console",
    "nav.tuning": "Tuning",
    "nav.terminal": "Terminal",
    "nav.record": "Record",
    "mode.uart": "UART",
    "mode.sim": "Sim",
    "mode.replay": "Replay",
    "baud": "Baud",
    "sim": "Sim",
    "sim.1k": "1 kHz",
    "sim.2k": "2 kHz",
    "sim.5k": "5 kHz Stress",
    "connect": "Connect",
    "reconnect": "Reconnect",
    "disconnect": "Disconnect",
    "estop": "E-STOP",
    "status.off": "DISCONNECTED",
    "status.connecting": "CONNECTING…",
    "status.connected": "CONNECTED",
    "status.error": "ERROR",
    "status.sim": "SIMULATION",
    "status.stress": "SIM STRESS",
    "status.replay": "REPLAY",
    "status.connecting2": "CONNECTING",
    "status.disconnecting": "DISCONNECTING",
    "panel.dashboard.title": "Live status (same frame source as Scope)",
    "panel.scope.title": "Real-time scope — FOC-STP v1.0 32ch · click t1/t2 · Shift/Alt · wheel zoom",
    "panel.console.title": "Console — maps to existing CLI (no firmware change)",
    "panel.tuning.title": "Tuning — sliders → CLI (local edit values, not MCU readback)",
    "panel.terminal.title": "ASCII CLI (same serial as telemetry, auto demux)",
    "panel.record.title": "Record / Replay / Marks",
    "preset.title": "Channel presets",
    "preset.current": "Current",
    "preset.velocity": "Velocity",
    "preset.voltage": "Voltage",
    "preset.sensorless": "Sensorless",
    "preset.all": "All",
    "preset.none": "None",
    "ch.title": "Channels",
    "math.title": "Math",
    "legend.title": "Legend",
    "window": "Window",
    "pause": "Pause",
    "resume": "Resume",
    "clear": "Clear",
    "clear.cursors": "Clear cursors",
    "png": "PNG",
    "csv": "CSV",
    "auto": "Auto",
    "y": "Y",
    "trig": "Trig",
    "src": "Src",
    "level": "Level",
    "arm": "Arm",
    "release": "Release",
    "cursor.hint": "Hover to read · click to set t1/t2",
    "empty.scope": "Waiting for telemetry… pick Sim or connect UART",
    "term.autoscroll": "Auto Scroll",
    "term.raw": "Raw RX",
    "rec.start": "Start Record",
    "rec.stop": "Stop Record",
    "rec.mark": "Mark",
    "rec.mark.ph": "Mark note",
    "rec.export.csv": "Export CSV",
    "rec.export.json": "Export JSON",
    "rec.load": "Load CSV…",
    "rec.replay": "Replay",
    "rec.replay.stop": "Stop Replay",
    "kbd.hint": "Space pause · R clear · E e-stop · 1–5 panels",
    "lang": "Lang",
    "dash.fault": "FAULT",
    "dash.rpm": "RPM",
    "dash.iq": "Iq",
    "dash.vbus": "Vbus",
    "dash.track": "Track",
    "dash.grp.speed": "Velocity",
    "dash.grp.current": "Current",
    "dash.grp.voltage": "Voltage / Duty",
    "dash.grp.angle": "Angle / Fault",
    "dash.ctrl.title": "Quick control",
    "dash.ctrl.target": "Target",
    "dash.ctrl.mode": "Mode",
    "dash.ctrl.send": "Send",
    "dash.ctrl.set": "Set",
    "dash.ctrl.enable": "Enable",
    "dash.ctrl.disable": "Disable",
    "dash.ctrl.note": "Slider is a local edit value; sent via CLI. Not MCU readback.",
    "dash.hint": "Same source as Scope. Fault bits are informational; use firmware status/fault.",
    "fb.title": "Sensorless Feedback",
    "fb.note": "Sensorless primary control & status inquiry (VESC + I/F algorithm).",
    "fb.status": "Feedback Status",
    "fb.sensorless": "Switch Sensorless",
    "fb.sensored": "Switch Sensored",
    "fb.auto": "Auto Fallback",
    "fb.if_def": "Default I/F Config",
    "ident.title": "Motor ident",
    "ident.note": "Needs IDLE. Rs/Ls static; PP/flux/full will spin the motor.",
    "ident.rs": "Rs+Ls",
    "ident.ldq": "Ld/Lq",
    "ident.pp": "Pole pairs",
    "ident.flux": "Flux",
    "ident.full": "Full",
    "ident.show": "Show result",
    "ident.apply": "Apply (RAM)",
    "ident.busy": "Ident running…",
    "mode.vf": "vf",
    "mode.iq": "iq",
    "mode.vel": "vel",
    "mode.pos": "pos",
    "advanced": "Advanced",
    "sys.boot": "FOC Studio v0.3.6 — Scope/Legend · Tuning · Console · Record · UART telemetry 500 Hz",
    "sys.sim": "[sys] simulation @ {rate} Hz\n",
    "sys.serial": "[sys] serial mode\n",
    "sys.replay": "[sys] replay mode — load CSV on Record page then Replay\n",
    "sys.noserial": "[sys] No Web Serial. Use Chrome/Edge, or Sim/Replay.\n",
    "sys.estop": "[sys] E-STOP → disable\n",
    "sys.disconnected": "[sys] disconnected\n",
  },
};

const LS_KEY = "foc-studio-lang-v1";
let _lang = null;

export function getLang() {
  if (_lang) return _lang;
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "zh" || v === "en") {
      _lang = v;
      return _lang;
    }
  } catch {
    /* ignore */
  }
  _lang = "zh";
  return _lang;
}

export function setLang(lang) {
  const l = LANGS.includes(lang) ? lang : "zh";
  _lang = l;
  try {
    localStorage.setItem(LS_KEY, l);
  } catch {
    /* ignore */
  }
  return l;
}

export function t(key, vars) {
  const lang = getLang();
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 应用到 [data-i18n] / [data-i18n-ph] / [data-i18n-title] */
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-ph"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}
