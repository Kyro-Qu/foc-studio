/**
 * WebGL2 波形后端 — 包络线 + 中心线，观感对齐 Canvas2D（峰包络，不丢尖峰）。
 * 核显/独显由浏览器调度。
 */

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uArea;
uniform vec2 uY;
uniform float uCssW;
uniform float uCssH;
void main(){
  float ax = uArea.x, ay = uArea.y, aw = uArea.z, ah = uArea.w;
  float px = ax + aPos.x;
  float yy = ay + ah * (1.0 - (aPos.y - uY.x) / max(1e-6, uY.y - uY.x));
  gl_Position = vec2(px / uCssW * 2.0 - 1.0, 1.0 - yy / uCssH * 2.0);
  gl_Position = vec4(gl_Position, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 o;
void main(){ o = uColor; }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader: ${log || "compile fail"}`);
  }
  return sh;
}

function link(gl) {
  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`link: ${log || "fail"}`);
  }
  return p;
}

function parseColor(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(css || "").trim());
  if (!m) return [1, 1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export class WebGLScopeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.kind = "webgl2";
    this.dprCap = 2;
    this._dpr = 1;
    this._cssW = 0;
    this._cssH = 0;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!this.gl) throw new Error("no webgl2");
    const gl = this.gl;
    this._prog = link(gl);
    this._vbo = gl.createBuffer();
    this._uArea = gl.getUniformLocation(this._prog, "uArea");
    this._uY = gl.getUniformLocation(this._prog, "uY");
    this._uW = gl.getUniformLocation(this._prog, "uCssW");
    this._uH = gl.getUniformLocation(this._prog, "uCssH");
    this._uCol = gl.getUniformLocation(this._prog, "uColor");
    this._buf = new Float32Array(16384);
    this.onContextLost = null;
    this._onLost = (e) => {
      e.preventDefault();
      if (this.onContextLost) this.onContextLost();
    };
    canvas.addEventListener("webglcontextlost", this._onLost, false);
  }

  setDprCap(v) {
    this.dprCap = v;
  }

  getDprCap() {
    return this.dprCap;
  }

  destroy() {
    this.canvas.removeEventListener("webglcontextlost", this._onLost, false);
  }

  resize(cssW, cssH) {
    this._cssW = cssW;
    this._cssH = cssH;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this._dpr = dpr;
    const pw = Math.max(1, Math.floor(cssW * dpr));
    const ph = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const gl = this.gl;
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(21 / 255, 26 / 255, 38 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  _setUniforms(area, meta) {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.uniform4f(this._uArea, area.x, area.y, area.w, area.h);
    gl.uniform2f(this._uY, meta.yMin, meta.yMax);
    gl.uniform1f(this._uW, this._cssW);
    gl.uniform1f(this._uH, this._cssH);
  }

  _drawLineStrip(area, meta, pts, color, mode) {
    const gl = this.gl;
    const n = pts.length / 2;
    if (n < 2) return;
    this._setUniforms(area, meta);
    gl.uniform4f(this._uCol, color[0], color[1], color[2], color[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(mode, 0, n);
  }

  drawChrome(area, meta) {
    const gl = this.gl;
    const verts = [];
    for (let i = 0; i <= 8; i++) {
      const y = area.y + (area.h * i) / 8;
      verts.push(area.x, y, area.x + area.w, y);
    }
    for (let i = 0; i <= 10; i++) {
      const x = area.x + (area.w * i) / 10;
      verts.push(x, area.y, x, area.y + area.h);
    }
    this._drawLineStrip(area, meta, new Float32Array(verts), [0.14, 0.19, 0.27, 1], gl.LINES);
  }

  drawSeries(area, meta, seriesList) {
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.floor(area.x * this._dpr),
      Math.floor((this._cssH - area.y - area.h) * this._dpr),
      Math.floor(area.w * this._dpr),
      Math.floor(area.h * this._dpr)
    );
    for (const s of seriesList) {
      const p = s.peaks;
      if (!p || p.n < 2) continue;
      let has = false;
      for (let i = 0; i < p.n; i++) {
        if (Number.isFinite(p.maxY[i])) {
          has = true;
          break;
        }
      }
      if (!has) continue;
      const col = parseColor(s.color);
      const n = p.n;
      const dx = n > 1 ? area.w / (n - 1) : 0;

      // 包络：max 向前 + min 向后（与 Canvas2D 同构，α=0.25）
      const need = n * 2 * 2 + n * 2;
      if (this._buf.length < need) this._buf = new Float32Array(need);
      const env = this._buf;
      let w = 0;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(p.maxY[i])) continue;
        env[w++] = dx * i;
        env[w++] = p.maxY[i];
      }
      // 断线段：按有限点分段 LINE_STRIP
      this._drawSegs(area, meta, env, w, [col[0], col[1], col[2], 0.25], p, dx, true);
      this._drawSegs(area, meta, env, 0, [col[0], col[1], col[2], 0.25], p, dx, false);

      // 中心线
      this._drawCenter(area, meta, col, p, dx);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  _drawSegs(area, meta, _env, _w, color, p, dx, isMax) {
    // 分段画 max 或 min
    let segStart = -1;
    const n = p.n;
    const flush = (from, to) => {
      const cnt = to - from + 1;
      if (cnt < 2) {
        segStart = -1;
        return;
      }
      const pts = new Float32Array(cnt * 2);
      let w = 0;
      for (let k = from; k <= to; k++) {
        pts[w++] = dx * k;
        pts[w++] = isMax ? p.maxY[k] : p.minY[k];
      }
      this._drawLineStrip(area, meta, pts, color, this.gl.LINE_STRIP);
      segStart = -1;
    };
    for (let i = 0; i < n; i++) {
      const ok = Number.isFinite(isMax ? p.maxY[i] : p.minY[i]);
      if (ok && segStart < 0) segStart = i;
      if (segStart >= 0 && (!ok || i === n - 1)) flush(segStart, ok ? i : i - 1);
    }
  }

  _drawCenter(area, meta, col, p, dx) {
    let segStart = -1;
    const n = p.n;
    const flush = (from, to) => {
      const cnt = to - from + 1;
      if (cnt < 2) {
        segStart = -1;
        return;
      }
      const pts = new Float32Array(cnt * 2);
      let w = 0;
      for (let k = from; k <= to; k++) {
        pts[w++] = dx * k;
        pts[w++] = (p.minY[k] + p.maxY[k]) * 0.5;
      }
      this._drawLineStrip(area, meta, pts, [col[0], col[1], col[2], 1], this.gl.LINE_STRIP);
      segStart = -1;
    };
    for (let i = 0; i < n; i++) {
      const ok = Number.isFinite(p.minY[i]) && Number.isFinite(p.maxY[i]);
      if (ok && segStart < 0) segStart = i;
      if (segStart >= 0 && (!ok || i === n - 1)) flush(segStart, ok ? i : i - 1);
    }
  }
}
