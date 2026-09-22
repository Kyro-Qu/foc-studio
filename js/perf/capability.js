/**
 * 渲染能力探测 — 自动适配核显/独显/软渲染，不依赖独显字符串。
 */

/**
 * @typedef {{
 *   webgl2: boolean,
 *   renderer: string,
 *   offscreen: boolean,
 *   sab: boolean,
 *   workers: number,
 *   dpr: number,
 *   dprCap: number,
 *   preferWebGL: boolean,
 *   reason: string
 * }} PerfProfile
 */

/** @returns {PerfProfile} */
export function detectCapabilities(win = typeof window !== "undefined" ? window : null) {
  const dpr = (win && win.devicePixelRatio) || 1;
  const workers = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const mem = (typeof navigator !== "undefined" && navigator.deviceMemory) || 4;
  let webgl2 = false;
  let renderer = "none";
  let preferWebGL = false;
  let reason = "no-webgl";

  if (win && win.document) {
    try {
      const cv = win.document.createElement("canvas");
      const gl = cv.getContext("webgl2", {
        alpha: false,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      if (gl) {
        webgl2 = true;
        preferWebGL = true;
        reason = "webgl2";
        try {
          const dbg = gl.getExtension("WEBGL_debug_renderer_info");
          renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "webgl2";
        } catch {
          renderer = "webgl2";
        }
        // 软渲染（SwiftShader 等）不走 GL 主路径
        if (/swiftshader|software|llvmpipe|microsoft basic/i.test(renderer)) {
          preferWebGL = false;
          reason = "software-gl";
        }
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch {
      webgl2 = false;
      preferWebGL = false;
      reason = "webgl-error";
    }
  }

  const offscreen =
    typeof OffscreenCanvas !== "undefined" &&
    typeof Worker !== "undefined" &&
    webgl2;

  let sab = false;
  try {
    sab = typeof SharedArrayBuffer !== "undefined" && (typeof crossOriginIsolated === "undefined" || crossOriginIsolated);
  } catch {
    sab = false;
  }

  // 低内存/高 DPR 机器压低 backing store，避免像素爆炸（不降低逻辑分辨率观感太多）
  let dprCap = 2;
  if (mem <= 2) dprCap = 1;
  else if (mem <= 4 || workers <= 2) dprCap = 1.5;
  if (dpr >= 2 && mem <= 4) dprCap = Math.min(dprCap, 1.5);

  return {
    webgl2,
    renderer,
    offscreen,
    sab,
    workers,
    dpr,
    dprCap: Math.min(dpr, dprCap),
    preferWebGL,
    reason,
  };
}
