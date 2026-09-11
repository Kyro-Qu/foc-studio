/**
 * CLI Terminal：接收 JustFloatDecoder 分离出的文本，支持历史与 Raw。
 */

export class Terminal {
  /**
   * @param {HTMLElement} logEl
   * @param {HTMLInputElement} inputEl
   * @param {HTMLButtonElement} sendBtn
   * @param {object} opts
   * @param {(line: string) => Promise<void>|void} opts.onSend
   */
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
    this.maxLines = 2000;

    this.sendBtn.addEventListener("click", () => this._submit());
    this.inputEl.addEventListener("keydown", (e) => {
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
    });
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

  async _submit() {
    const line = this.inputEl.value.trim();
    if (!line) return;
    this.history.push(line);
    if (this.history.length > 50) this.history.shift();
    this.histIdx = -1;
    this.inputEl.value = "";
    try {
      await this.onSend(line);
    } catch (e) {
      this.appendText(`\n[send error] ${e.message || e}\n`, "err");
    }
  }

  /**
   * @param {string} text
   * @param {'rx'|'tx'|'err'|'sys'} [kind]
   */
  appendText(text, kind = "rx") {
    if (this.rawMode) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i++) this.rawBytes.push(bytes[i]);
      if (this.rawBytes.length > 4096) this.rawBytes = this.rawBytes.slice(-4096);
    }
    const span = document.createElement("span");
    span.className = `term-${kind}`;
    span.textContent = text;
    this.logEl.appendChild(span);

    // 节点过多时批量裁剪
    const extra = this.logEl.childNodes.length - this.maxLines;
    if (extra > 0) {
      for (let i = 0; i < extra; i++) this.logEl.removeChild(this.logEl.firstChild);
    }
    if (this.autoScroll) {
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  }

  /** 直接灌入原始字节（Raw RX 面板） */
  feedRaw(bytes) {
    if (!this.rawMode) return;
    for (let i = 0; i < bytes.length; i++) {
      this.rawBytes.push(bytes[i]);
    }
    if (this.rawBytes.length > 8192) this.rawBytes = this.rawBytes.slice(-8192);
  }

  renderRaw() {
    return this.rawBytes
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }

  clear() {
    this.logEl.innerHTML = "";
    this.rawBytes = [];
  }
}
