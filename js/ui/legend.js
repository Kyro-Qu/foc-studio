/**
 * Scope 侧栏图例：色块 + 通道名 + 实时值（与 Store 同源）。
 */

import { formatValue, channelLabel } from "../channels.js";
import { faultText } from "./fault.js";
import { getLang } from "../i18n.js";

export class ScopeLegend {
  /**
   * @param {HTMLElement} root
   * @param {import('../data/telemetry-store.js').TelemetryStore} store
   * @param {Array} channels
   * @param {object} [opts]
   * @param {import('./math.js').MathChannels} [opts.math]
   */
  constructor(root, store, channels, opts = {}) {
    this.root = root;
    this.store = store;
    this.channels = channels;
    this.math = opts.math || null;
    this._timer = null;
  }

  setChannels(channels) {
    this.channels = channels;
  }

  setMath(math) {
    this.math = math;
  }

  start(intervalMs = 80) {
    this.stop();
    this._timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  refresh() {
    const vis = this.channels.filter((c) => c.visible);
    const mathVis = this.math ? this.math.items.filter((m) => m.visible) : [];
    if (!vis.length && !mathVis.length) {
      this.root.innerHTML = `<div class="legend-empty">无可见通道</div>`;
      return;
    }
    const rows = [];
    for (const ch of vis) {
      let text;
      if (ch.id === 13) text = faultText(this.store.latest[13]);
      else text = formatValue(this.store.latest[ch.id], ch.unit);
      const label = channelLabel(ch.id, getLang());
      rows.push(
        `<div class="legend-row"><span class="swatch" style="background:${ch.color}"></span><span class="legend-name">${label}</span><span class="legend-val">${text}</span></div>`
      );
    }
    if (this.math) {
      for (const m of mathVis) {
        rows.push(
          `<div class="legend-row"><span class="swatch" style="background:${m.color}"></span><span class="legend-name">${m.name}</span><span class="legend-val math">M</span></div>`
        );
      }
    }
    this.root.innerHTML = rows.join("");
  }
}
