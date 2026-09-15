/**
 * 紧凑转子位置可视化（参考 FOC Rotor Position Pro）。
 * setActualRad / setTargetRad 由 rAF 平滑驱动。
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const TAU = Math.PI * 2;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function polar(cx, cy, r, deg) {
  const a = (-deg * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

export class RotorGauge {
  constructor(host) {
    this.host = host;
    this.actualTargetRad = 0;
    this.targetTargetRad = 0;
    this.renderActualRad = 0;
    this.renderTargetRad = 0;
    this.smoothingMs = 32;
    this.direction = -1; // SVG rotate 正数为顺时针；机械角 CCW+ 用 -1
    this.lastTime = 0;
    this._raf = 0;
    this._destroyed = false;
    this._build();
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    this._raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  setActualRad(rad) {
    rad = Number(rad);
    if (Number.isFinite(rad)) this.actualTargetRad = rad;
  }

  setTargetRad(rad) {
    rad = Number(rad);
    if (Number.isFinite(rad)) this.targetTargetRad = rad;
  }

  _build() {
    this.host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rotor-wrap";
    wrap.innerHTML = `
      <svg class="rotor-svg" viewBox="0 0 400 400" aria-label="Rotor position">
        <defs>
          <radialGradient id="rotor-housing" cx="50%" cy="45%" r="58%">
            <stop offset="0%" stop-color="#243044"/>
            <stop offset="72%" stop-color="#151d2a"/>
            <stop offset="100%" stop-color="#0b1018"/>
          </radialGradient>
          <radialGradient id="rotor-body" cx="42%" cy="38%" r="70%">
            <stop offset="0%" stop-color="#3a475d"/>
            <stop offset="55%" stop-color="#202b3a"/>
            <stop offset="100%" stop-color="#111720"/>
          </radialGradient>
          <linearGradient id="rotor-copper" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffd073"/>
            <stop offset="45%" stop-color="#dd811e"/>
            <stop offset="100%" stop-color="#8f410d"/>
          </linearGradient>
          <radialGradient id="rotor-shaft" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#d8e0e9"/>
            <stop offset="38%" stop-color="#7f8b99"/>
            <stop offset="100%" stop-color="#28313d"/>
          </radialGradient>
          <filter id="rotor-cyanGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.8" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="rotor-orangeGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="200" cy="200" r="194" fill="#0d131d" stroke="#293447" stroke-width="3"/>
        <circle cx="200" cy="200" r="187" fill="url(#rotor-housing)" stroke="#111925" stroke-width="2"/>
        <circle cx="200" cy="200" r="180" fill="none" stroke="#354158" stroke-width="1" stroke-dasharray="2 6"/>
        <g class="rotor-scale"></g>
        <g class="rotor-stator"></g>
        <circle cx="200" cy="200" r="103" fill="#080c12" stroke="#222d3d" stroke-width="3"/>
        <circle cx="200" cy="200" r="96" fill="#0b1017" stroke="#05080c" stroke-width="1"/>
        <g class="rotor-target">
          <line x1="200" y1="200" x2="348" y2="200" stroke="#ff9d2e" stroke-width="2"
                stroke-dasharray="6 5" opacity=".72" filter="url(#rotor-orangeGlow)"/>
          <path d="M354 200 L342 193 L342 207 Z" fill="#ff9d2e" opacity=".9"/>
        </g>
        <g class="rotor-visual">
          <circle cx="200" cy="200" r="88" fill="url(#rotor-body)" stroke="#3b485c" stroke-width="2"/>
          <g class="rotor-magnets"></g>
          <circle cx="200" cy="200" r="58" fill="#121925" stroke="#273246" stroke-width="2"/>
          <path d="M176 196 L176 204 L138 208 L126 200 L138 192 Z" fill="#19e5ff" opacity=".22"/>
          <line x1="200" y1="200" x2="347" y2="200" stroke="#19e5ff" stroke-width="4.2"
                stroke-linecap="round" filter="url(#rotor-cyanGlow)"/>
          <line x1="210" y1="200" x2="345" y2="200" stroke="#eaffff" stroke-width="1.25" stroke-linecap="round"/>
          <path d="M357 200 L342 191.5 L342 208.5 Z" fill="#bffaff" filter="url(#rotor-cyanGlow)"/>
          <circle cx="200" cy="200" r="31" fill="url(#rotor-shaft)" stroke="#98a5b5" stroke-width="1.4"/>
          <circle cx="200" cy="200" r="22" fill="#121a25" stroke="#4c5869" stroke-width="2"/>
          <circle cx="200" cy="200" r="8.5" fill="#070b10" stroke="#d9e3ed" stroke-width="1.3"/>
          <circle cx="200" cy="200" r="3.8" fill="#eaffff" filter="url(#rotor-cyanGlow)"/>
        </g>
        <circle cx="200" cy="200" r="158" fill="none" stroke="#1d2838" stroke-width="1"/>
      </svg>
      <div class="rotor-readout">
        <span class="rotor-chip"><b class="rotor-actual">0.00</b>°</span>
        <span class="rotor-chip dim"><b class="rotor-target-deg">0.00</b>° tgt</span>
        <span class="rotor-chip dim"><b class="rotor-err">+0.00</b> rad</span>
      </div>
    `;
    this.host.appendChild(wrap);
    this.rotorEl = wrap.querySelector(".rotor-visual");
    this.targetEl = wrap.querySelector(".rotor-target");
    this.actualDegEl = wrap.querySelector(".rotor-actual");
    this.targetDegEl = wrap.querySelector(".rotor-target-deg");
    this.errEl = wrap.querySelector(".rotor-err");

    const scale = wrap.querySelector(".rotor-scale");
    for (let deg = 0; deg < 360; deg += 5) {
      const major = deg % 30 === 0;
      const mid = !major && deg % 10 === 0;
      const [x1, y1] = polar(200, 200, major ? 162 : mid ? 167 : 171, deg);
      const [x2, y2] = polar(200, 200, 176, deg);
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", major ? "#7c8aa1" : mid ? "#52627b" : "#35445b");
      line.setAttribute("stroke-width", major ? 2.2 : mid ? 1.4 : 1);
      scale.appendChild(line);
      if (major) {
        const [tx, ty] = polar(200, 200, 151, deg);
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", tx);
        text.setAttribute("y", ty);
        text.setAttribute("fill", deg % 90 === 0 ? "#aeb9c9" : "#8190a8");
        text.setAttribute("font-size", deg % 90 === 0 ? "10" : "9.5");
        text.setAttribute("font-weight", "700");
        text.setAttribute("font-family", "ui-monospace, monospace");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = `${deg}°`;
        scale.appendChild(text);
      }
    }

    const stator = wrap.querySelector(".rotor-stator");
    const core = document.createElementNS(SVG_NS, "circle");
    core.setAttribute("cx", "200");
    core.setAttribute("cy", "200");
    core.setAttribute("r", "126");
    core.setAttribute("fill", "none");
    core.setAttribute("stroke", "#303b4c");
    core.setAttribute("stroke-width", "29");
    stator.appendChild(core);
    const phases = ["U", "V", "W"];
    const phaseColors = ["#ff5b67", "#54a8ff", "#ffd15a"];
    for (let i = 0; i < 12; i++) {
      const slot = document.createElementNS(SVG_NS, "g");
      slot.setAttribute("transform", `rotate(${i * 30} 200 200)`);
      const tooth = document.createElementNS(SVG_NS, "path");
      tooth.setAttribute("d", "M190 89 H210 L216 119 H184 Z");
      tooth.setAttribute("fill", "#283242");
      tooth.setAttribute("stroke", "#111822");
      tooth.setAttribute("stroke-width", "1.5");
      const coil = document.createElementNS(SVG_NS, "rect");
      coil.setAttribute("x", "184");
      coil.setAttribute("y", "103");
      coil.setAttribute("width", "32");
      coil.setAttribute("height", "22");
      coil.setAttribute("rx", "5");
      coil.setAttribute("fill", "url(#rotor-copper)");
      coil.setAttribute("stroke", "#7b3d12");
      const phase = document.createElementNS(SVG_NS, "text");
      phase.setAttribute("x", "200");
      phase.setAttribute("y", "118");
      phase.setAttribute("text-anchor", "middle");
      phase.setAttribute("dominant-baseline", "middle");
      phase.setAttribute("font-size", "8");
      phase.setAttribute("font-weight", "900");
      phase.setAttribute("fill", phaseColors[i % 3]);
      phase.textContent = phases[i % 3];
      slot.append(tooth, coil, phase);
      stator.appendChild(slot);
    }

    const magnets = wrap.querySelector(".rotor-magnets");
    for (let i = 0; i < 14; i++) {
      const pole = document.createElementNS(SVG_NS, "path");
      pole.setAttribute("d", "M194 113 H206 L208 124 H192 Z");
      pole.setAttribute("fill", i % 2 === 0 ? "#ff5868" : "#4a9cff");
      pole.setAttribute("stroke", i % 2 === 0 ? "#ff8793" : "#7ab6ff");
      pole.setAttribute("stroke-width", ".6");
      pole.setAttribute("transform", `rotate(${(i * 360) / 14} 200 200)`);
      magnets.appendChild(pole);
    }

    this.rotorEl.style.transformBox = "view-box";
    this.rotorEl.style.transformOrigin = "200px 200px";
    this.targetEl.style.transformBox = "view-box";
    this.targetEl.style.transformOrigin = "200px 200px";
  }

  loop(now) {
    if (this._destroyed) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = clamp(dt, 0, 0.05);
    const tau = this.smoothingMs / 1000;
    const alpha = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    this.renderActualRad += (this.actualTargetRad - this.renderActualRad) * alpha;
    this.renderTargetRad += (this.targetTargetRad - this.renderTargetRad) * Math.min(1, alpha * 1.35);

    const actualDeg = (this.renderActualRad * 180) / Math.PI;
    const targetDeg = (this.renderTargetRad * 180) / Math.PI;
    this.rotorEl.style.transform = `rotate(${this.direction * actualDeg}deg)`;
    this.targetEl.style.transform = `rotate(${this.direction * targetDeg}deg)`;

    const norm = (d) => ((d % 360) + 360) % 360;
    if (this.actualDegEl) this.actualDegEl.textContent = norm(actualDeg).toFixed(1);
    if (this.targetDegEl) this.targetDegEl.textContent = norm(targetDeg).toFixed(1);
    if (this.errEl) {
      const err = this.targetTargetRad - this.actualTargetRad;
      this.errEl.textContent = `${err >= 0 ? "+" : ""}${err.toFixed(2)}`;
    }
    this._raf = requestAnimationFrame(this.loop);
  }
}
