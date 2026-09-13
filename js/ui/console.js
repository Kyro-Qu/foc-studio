/**
 * 控制台：把 UI 控件映射到现有 ASCII CLI（不改固件）。
 */

export const PRESET_COMMANDS = [
  { id: "help", label: "Help", cmd: "help", kind: "normal" },
  { id: "version", label: "Version", cmd: "version", kind: "normal" },
  { id: "status", label: "Status", cmd: "status", kind: "normal" },
  { id: "enable", label: "Enable", cmd: "enable", kind: "ok" },
  { id: "disable", label: "Disable", cmd: "disable", kind: "warn" },
  { id: "fault", label: "Fault?", cmd: "fault", kind: "normal" },
  { id: "faultclear", label: "Fault Clear", cmd: "fault clear", kind: "warn" },
  { id: "calib", label: "Calib full", cmd: "calib full", kind: "normal" },
  { id: "logon", label: "Log ON", cmd: "log 1", kind: "normal" },
  { id: "logoff", label: "Log OFF", cmd: "log 0", kind: "normal" },
];

/** 无感闭环控制 — 映射固件 feedback [sensored|sensorless|auto|if|speed|blend] */
export const FEEDBACK_COMMANDS = [
  { id: "fb-status", key: "fb.status", cmd: "feedback", danger: false },
  { id: "fb-sensorless", key: "fb.sensorless", cmd: "feedback sensorless", danger: false },
  { id: "fb-sensored", key: "fb.sensored", cmd: "feedback sensored", danger: false },
  { id: "fb-auto", key: "fb.auto", cmd: "feedback auto", danger: false },
  { id: "fb-if-def", key: "fb.if_def", cmd: "feedback if 0.6 500 300", danger: false },
];

/** 参数辨识 — 映射固件 ident [full|rs|ldq|pp|flux|show|apply] */
export const IDENT_COMMANDS = [
  { id: "ident-rs", key: "ident.rs", cmd: "ident rs", danger: false },
  { id: "ident-ldq", key: "ident.ldq", cmd: "ident ldq", danger: false },
  { id: "ident-pp", key: "ident.pp", cmd: "ident pp", danger: true },
  { id: "ident-flux", key: "ident.flux", cmd: "ident flux", danger: true },
  { id: "ident-full", key: "ident.full", cmd: "ident full", danger: true },
  { id: "ident-show", key: "ident.show", cmd: "ident show", danger: false },
  { id: "ident-apply", key: "ident.apply", cmd: "ident apply", danger: false },
];

export const MODES = [
  { id: "vf", key: "mode.vf" },
  { id: "iq", key: "mode.iq" },
  { id: "vel", key: "mode.vel" },
  { id: "pos", key: "mode.pos" },
];

const LS_KEY = "foc-studio-console-v1";

export class ControlConsole {
  /**
   * @param {object} opts
   * @param {(cmd:string)=>Promise<void>|void} opts.send
   */
  constructor(opts) {
    this.send = opts.send;
    this.custom = this._loadCustom();
  }

  _loadCustom() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  _saveCustom() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.custom));
    } catch {
      /* ignore */
    }
  }

  addCustom(label, cmd) {
    const item = { id: `c${Date.now()}`, label: label || cmd, cmd, kind: "custom" };
    this.custom.push(item);
    this._saveCustom();
    return item;
  }

  removeCustom(id) {
    this.custom = this.custom.filter((x) => x.id !== id);
    this._saveCustom();
  }

  async run(cmd) {
    const line = String(cmd || "").trim();
    if (!line) return;
    await this.send(line);
  }

  async setMode(mode) {
    await this.run(`mode ${mode}`);
  }

  async setTarget(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("target must be a number");
    await this.run(`target ${n}`);
  }

  async setRpm(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("rpm must be a number");
    await this.run(`rpm ${n}`);
  }

  async setVq(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("vq must be a number");
    await this.run(`vq ${n}`);
  }

  async estop() {
    await this.run("disable");
  }

  allPresets() {
    return [...PRESET_COMMANDS, ...this.custom];
  }
}
