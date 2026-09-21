/**
 * CLI Terminal：JustFloat 文本分离 + 历史 + Raw + `/` 命令提示。
 * 缓冲上限借鉴 simplefoc-webcontroller（防 runaway 文本）。
 * 命令表与固件 foc_cmd.c 保持一致，不发明底层没有的命令。
 */

import { getLang } from "../i18n.js";

const MAX_RAW_BYTES = 8192;
const MAX_TEXT_CHARS = 200000;

/** 固件 ASCII CLI 命令目录：左侧命令，右侧说明 */
const CLI_COMMANDS = [
  { cmd: "help", fill: "help", zh: "显示命令帮助", en: "Show CLI help" },
  { cmd: "version", fill: "version", zh: "固件 / 板卡 / CLI 版本", en: "Firmware / board / CLI version" },
  { cmd: "status", fill: "status", zh: "电机状态、故障、母线等", en: "Motor state, fault, bus, etc." },
  { cmd: "motor [n]", fill: "motor ", zh: "查看 / 选择当前电机轴", en: "Show / select motor axis" },
  { cmd: "enable", fill: "enable", zh: "使能当前电机（ARM）", en: "Arm / enable selected motor" },
  { cmd: "disable", fill: "disable", zh: "失能当前电机（DISARM）", en: "Disarm / disable selected motor" },
  { cmd: "fault [clear]", fill: "fault ", zh: "查看故障；clear 清除", en: "Show fault; clear to reset" },
  { cmd: "calib [full]", fill: "calib ", zh: "电角度校准；full 强制完整校准", en: "Angle calib; full forces complete" },
  { cmd: "calib offset [rad]", fill: "calib offset ", zh: "查看 / 设置电角度零点（IDLE）", en: "Show / set electrical offset (IDLE)" },
  { cmd: "mode [vf|iq|vel|pos]", fill: "mode ", zh: "查看 / 切换控制模式", en: "Show / switch control mode" },
  { cmd: "target <value>", fill: "target ", zh: "设定目标：iq:A / vel:RPM / pos:rad", en: "Set target: iq:A / vel:RPM / pos:rad" },
  { cmd: "angle [enc|ol]", fill: "angle ", zh: "查看 / 设置角度源", en: "Show / set angle source" },
  { cmd: "vq [V]", fill: "vq ", zh: "V/F 电压 boost 查询 / 设置", en: "V/F voltage boost get / set" },
  { cmd: "rpm [RPM]", fill: "rpm ", zh: "V/F 开环转速查询 / 设置", en: "V/F open-loop RPM get / set" },
  { cmd: "vf [slope <V/RPM>]", fill: "vf ", zh: "查看 / 设置 V/F 曲线", en: "Show / set V/F curve" },
  { cmd: "limit [A]", fill: "limit ", zh: "查看 / 设置电流软限幅", en: "Show / set soft current limit" },
  { cmd: "vbus [uv|ov <V>]", fill: "vbus ", zh: "母线欠压 / 过压保护", en: "Bus undervolt / overvolt protection" },
  { cmd: "temp [ot <C>]", fill: "temp ", zh: "查看 / 设置过温保护", en: "Show / set overtemperature protection" },
  { cmd: "current [bw <rad/s>]", fill: "current ", zh: "查看 / 设置电流环带宽", en: "Show / set current-loop bandwidth" },
  { cmd: "vel [kp|ki|…]", fill: "vel ", zh: "速度环参数查询 / 设置", en: "Velocity loop params get / set" },
  { cmd: "pos", fill: "pos", zh: "查看位置环状态", en: "Show position-loop state" },
  { cmd: "pos abs|rel|step <val>", fill: "pos ", zh: "设置位置目标（rad/deg/turn）", en: "Set position goal (rad/deg/turn)" },
  { cmd: "pos zero|origin", fill: "pos zero", zh: "将当前位置设为原点", en: "Set current position as origin" },
  { cmd: "pos [kp|ki|…]", fill: "pos ", zh: "位置环参数查询 / 设置", en: "Position loop params get / set" },
  { cmd: "ident [full|…|apply]", fill: "ident ", zh: "参数辨识；apply 写入 RAM", en: "Param identification; apply writes RAM" },
  { cmd: "tune [...]", fill: "tune ", zh: "调试参数 angle_delay/fw/pll（仅 RAM）", en: "Debug params angle_delay/fw/pll (RAM)" },
  { cmd: "acog", fill: "acog ", zh: "抗齿槽力矩标定查询 / 启停", en: "Anti-cogging query / start / stop" },
  { cmd: "obs [0|1|2 [off]]", fill: "obs ", zh: "无感观测器对比 / 切换", en: "Sensorless observer compare / switch" },
  { cmd: "feedback [sensored|auto|sensorless]", fill: "feedback ", zh: "反馈模式查询 / 切换", en: "Feedback mode show / switch" },
  { cmd: "enc", fill: "enc ", zh: "编码器相关命令", en: "Encoder-related commands" },
  { cmd: "sensorless", fill: "sensorless ", zh: "无感模式相关命令", en: "Sensorless mode commands" },
  { cmd: "cpu [reset]", fill: "cpu ", zh: "快环负载统计（reset 清零）", en: "Fast-loop load stats (reset clears)" },
  { cmd: "blackbox", fill: "blackbox", zh: "拉取跳闸黑匣子波形", en: "Dump fault blackbox waveform" },
  { cmd: "bench [...]", fill: "bench ", zh: "无感观测器台架测试", en: "Sensorless observer bench test" },
  { cmd: "deadtime [obs|volt]", fill: "deadtime ", zh: "死区补偿查询 / 设置", en: "Deadtime compensation get / set" },
  { cmd: "conf read|write|erase", fill: "conf ", zh: "配置读取 / 固化 Flash / 擦除", en: "Config read / Flash write / erase" },
  { cmd: "wave [0|1]", fill: "wave ", zh: "波形流开关", en: "Wave stream on / off" },
  { cmd: "log [0|1]", fill: "log ", zh: "FOC-STP 波形流开关（别名）", en: "FOC-STP wave stream (alias)" },
  { cmd: "telem [mask|rate|enable]", fill: "telem ", zh: "遥测掩码 / 频率 / 开关", en: "Telemetry mask / rate / enable" },
];

export class Terminal {
  constructor(logEl, inputEl, sendBtn, opts) {
    this.logEl = logEl;
    this.inputEl = inputEl;
    this.sendBtn = sendBtn;
    this.onSend = opts.onSend;
    this.autoScroll = true;
    this.rawMode = false;
    this.rawBytes = [];
    this.history = [];
    this.histIdx = -1;
    this.maxLines = 1500;
    this._textBudget = MAX_TEXT_CHARS;
    this.onHistoryChange = opts.onHistoryChange || null;

    this.suggestRoot = opts.suggestEl || null;
    this.suggestOpen = false;
    this.suggestIdx = 0;
    this.suggestList = [];
    /** 最近写入日志的类型：tx/rx/err/sys — 用于命令前分段 */
    this._lastKind = null;

    this.sendBtn.addEventListener("click", () => this._submit());
    this.inputEl.addEventListener("input", () => this._suggestUpdate());
    this.inputEl.addEventListener("keydown", (e) => this._onKeydown(e));
    this.inputEl.addEventListener("blur", () => {
      setTimeout(() => this._suggestClose(), 160);
    });
  }

  /** 发送命令时蓝色回显；与上一段内容之间加细分割线 */
  echoCommand(cmd) {
    const line = String(cmd || "").trim();
    if (!line) return;
    if (this._lastKind && this._lastKind !== "tx") {
      this._appendSep();
    }
    this.appendText(`> ${line}\n`, "tx");
  }

  _appendSep() {
    const div = document.createElement("div");
    div.className = "term-sep";
    div.setAttribute("aria-hidden", "true");
    this.logEl.appendChild(div);
    const extra = this.logEl.childNodes.length - this.maxLines;
    if (extra > 0) {
      for (let i = 0; i < extra; i++) this.logEl.removeChild(this.logEl.firstChild);
    }
    this._textBudget -= 1;
    while (this._textBudget < 0 && this.logEl.firstChild) {
      const first = this.logEl.firstChild;
      this._textBudget += (first.textContent || "").length + 1;
      this.logEl.removeChild(first);
    }
  }

  _onKeydown(e) {
    if (this.suggestOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this._suggestMove(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this._suggestMove(-1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this._suggestClose();
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        this._suggestApply();
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this._submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this._hist(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this._hist(1);
    }
  }

  _hist(dir) {
    if (!this.history.length) return;
    if (dir < 0) {
      if (this.histIdx < 0) this.histIdx = this.history.length - 1;
      else this.histIdx = Math.max(0, this.histIdx - 1);
    } else {
      if (this.histIdx < 0) return;
      this.histIdx += 1;
      if (this.histIdx >= this.history.length) {
        this.histIdx = -1;
        this.inputEl.value = "";
        return;
      }
    }
    this.inputEl.value = this.history[this.histIdx] || "";
  }

  _suggestUpdate() {
    const raw = this.inputEl.value;
    if (!raw.startsWith("/")) {
      this._suggestClose();
      return;
    }
    const q = raw.slice(1).trim().toLowerCase();
    const lang = getLang() === "en" ? "en" : "zh";
    let list;
    if (!q) {
      list = CLI_COMMANDS;
    } else {
      const byCmd = CLI_COMMANDS.filter((c) => {
        const hay = `${c.cmd} ${c.fill}`.toLowerCase();
        return hay.includes(q);
      });
      const byDesc = CLI_COMMANDS.filter((c) => {
        if (byCmd.includes(c)) return false;
        return c.zh.includes(q) || c.en.toLowerCase().includes(q);
      });
      list = byCmd.concat(byDesc);
    }
    this.suggestList = list.map((c) => ({ ...c, desc: c[lang] || c.zh }));
    this.suggestIdx = 0;
    this._suggestRender();
  }

  _suggestRender() {
    if (!this.suggestRoot) return;
    if (!this.suggestList.length) {
      this.suggestRoot.hidden = true;
      this.suggestRoot.innerHTML = "";
      this.suggestOpen = false;
      return;
    }
    this.suggestRoot.hidden = false;
    this.suggestOpen = true;
    this.suggestRoot.innerHTML = this.suggestList
      .map(
        (item, i) => `
      <button type="button" class="term-suggest-item${i === this.suggestIdx ? " active" : ""}" data-idx="${i}" role="option">
        <span class="term-suggest-cmd">${item.cmd}</span>
        <span class="term-suggest-desc">${item.desc}</span>
      </button>`
      )
      .join("");
    this.suggestRoot.querySelectorAll(".term-suggest-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.suggestIdx = Number(btn.dataset.idx) || 0;
        this._suggestApply();
      });
    });
  }

  _suggestMove(delta) {
    const n = this.suggestList.length;
    if (!n) return;
    this.suggestIdx = (this.suggestIdx + delta + n) % n;
    this._suggestRender();
    const active = this.suggestRoot?.querySelector(".term-suggest-item.active");
    active?.scrollIntoView({ block: "nearest" });
  }

  _suggestApply() {
    const item = this.suggestList[this.suggestIdx];
    if (!item) return;
    this.inputEl.value = item.fill;
    this._suggestClose();
    this.inputEl.focus();
    const len = this.inputEl.value.length;
    this.inputEl.setSelectionRange(len, len);
  }

  _suggestClose() {
    this.suggestOpen = false;
    this.suggestList = [];
    this.suggestIdx = 0;
    if (this.suggestRoot) {
      this.suggestRoot.hidden = true;
      this.suggestRoot.innerHTML = "";
    }
  }

  async _submit() {
    if (this.suggestOpen) {
      this._suggestApply();
      return;
    }
    const line = this.inputEl.value.trim();
    if (!line) return;
    // 「/」只作提示前缀，不下发给固件
    if (line === "/" || line.startsWith("/")) {
      this.appendText(`\n[sys] / 仅用于命令提示，回车前请去掉斜杠或点选命令\n`, "sys");
      return;
    }
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > 50) this.history.shift();
      if (this.onHistoryChange) this.onHistoryChange(this.history);
    }
    this.histIdx = -1;
    this.inputEl.value = "";
    try {
      await this.onSend(line);
    } catch (e) {
      this.appendText(`\n[send error] ${e.message || e}\n`, "err");
    }
  }

  appendText(text, kind = "rx") {
    if (this.rawMode) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i++) this.rawBytes.push(bytes[i]);
      if (this.rawBytes.length > MAX_RAW_BYTES) this.rawBytes.splice(0, this.rawBytes.length - MAX_RAW_BYTES);
    }
    // 限制超长单片（CLI 大行 / 垃圾）
    let out = text;
    if (out.length > 4096) out = out.slice(-4096);

    const span = document.createElement("span");
    span.className = `term-${kind}`;
    span.textContent = out;
    this.logEl.appendChild(span);
    this._lastKind = kind;

    const extra = this.logEl.childNodes.length - this.maxLines;
    if (extra > 0) {
      for (let i = 0; i < extra; i++) this.logEl.removeChild(this.logEl.firstChild);
    }

    this._textBudget -= out.length;
    while (this._textBudget < 0 && this.logEl.firstChild) {
      const first = this.logEl.firstChild;
      this._textBudget += (first.textContent || "").length;
      this.logEl.removeChild(first);
    }

    if (this.autoScroll) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  feedRaw(bytes) {
    if (!this.rawMode) return;
    for (let i = 0; i < bytes.length; i++) this.rawBytes.push(bytes[i]);
    if (this.rawBytes.length > MAX_RAW_BYTES) this.rawBytes.splice(0, this.rawBytes.length - MAX_RAW_BYTES);
  }

  renderRaw() {
    return this.rawBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  }

  clear() {
    this.logEl.innerHTML = "";
    this.rawBytes = [];
    this._textBudget = MAX_TEXT_CHARS;
    this._lastKind = null;
    this._suggestClose();
  }
}
