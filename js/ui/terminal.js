/**
 * CLI Terminal：JustFloat 文本分离 + 历史 + Raw。
 * 缓冲上限借鉴 simplefoc-webcontroller（防 runaway 文本）。
 */

const MAX_RAW_BYTES = 8192;
const MAX_TEXT_CHARS = 200000;

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
  }
}
