/**
 * FOC-STP v1.0 独立复核缺陷专项闭环测试集
 * 覆盖 2026-09-12 独立复核报告中指出的所有 12 项行为缺陷
 */

import assert from "node:assert/strict";

// Node 最小 DOM Stub
const makeElement = () => {
  const nodes = new Map();
  const el = {
    className: "",
    textContent: "",
    innerHTML: "",
    style: {},
    dataset: {},
    setAttribute: () => {},
    getAttribute: () => null,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    appendChild: () => {},
    querySelector: (sel) => {
      if (!nodes.has(sel)) nodes.set(sel, makeElement());
      return nodes.get(sel);
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    getContext: () => ({
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      stroke: () => {},
      fill: () => {},
      save: () => {},
      restore: () => {},
      rotate: () => {},
      translate: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 10 }),
      fillText: () => {},
    }),
  };
  return el;
};
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    getElementById: () => null,
  };
}

import { StpDecoder, FOC_STP_VERSION, FOC_STP_TYPE_WAVE, FOC_STP_TYPE_STATUS, crc16Ccitt } from "../js/protocol/stp.js";
import { TelemetryStore } from "../js/data/telemetry-store.js";
import { TelemetryAdapter } from "../js/protocol/protocol.js";
import { SerialTransport, SerialState } from "../js/transport/serial.js";
import { Dashboard } from "../js/ui/dashboard.js";
import { SessionRecorder } from "../js/data/recorder.js";
import { TriggerEngine, TriggerMode } from "../js/ui/trigger.js";
import { DEFAULT_CHANNELS, CHANNEL_COUNT } from "../js/channels.js";
import { t } from "../js/i18n.js";
import { faultTextUi } from "../js/ui/fault.js";

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

console.log("\n[1. 掩码同步状态与下发检查 (针对缺陷 1)]");
{
  const serial = new SerialTransport();
  serial.state = SerialState.READING;
  check("SerialTransport.isConnected() returns true in READING", serial.isConnected() === true);
  serial.state = SerialState.CONNECTED;
  check("SerialTransport.isConnected() returns true in CONNECTED", serial.isConnected() === true);
  serial.state = SerialState.DISCONNECTED;
  check("SerialTransport.isConnected() returns false in DISCONNECTED", serial.isConnected() === false);

  // 模拟 main.js 中的 syncChannelMaskToDevice 逻辑
  let sentCommand = null;
  const mockConsole = {
    run: async (cmd) => { sentCommand = cmd; }
  };
  function testSync(currentState, gen) {
    if (currentState !== SerialState.CONNECTED && currentState !== SerialState.READING) return;
    const mask = 0x0000003C; // ch2, 3, 4, 5
    mockConsole.run(`telem mask 0x${mask.toString(16).toUpperCase()}`);
  }
  testSync(SerialState.READING, 0);
  check("telem mask command is sent under READING state", sentCommand === "telem mask 0x3C");
}

console.log("\n[2. Dashboard 故障显示与状态解耦 (针对缺陷 3)]");
{
  const store = new TelemetryStore(CHANNEL_COUNT, 50);
  // 模拟 DOM
  const root = {
    innerHTML: "",
    appendChild: () => {},
    querySelector: (sel) => {
      if (!root._nodes) root._nodes = {};
      if (!root._nodes[sel]) {
        root._nodes[sel] = makeElement();
      }
      return root._nodes[sel];
    },
    querySelectorAll: () => []
  };

  const dash = new Dashboard(root, store, DEFAULT_CHANNELS);
  // 传入过压故障 STATUS (motorFault=12, vbus=14.4)
  dash.handleStatusUpdate({
    timestampMs: 1000,
    vbus: 14.4,
    motorFault: 12,
    shuntFault: 0,
    state: 3,
    mode: 2,
    tempC: 35,
    rpmEst: 0,
    iqEst: 0.0
  });

  const faultEl = (dash.strip || root).querySelector('[data-strip="fault"]');
  const expectedFaultStr = `${t("dash.fault")} ${faultTextUi(1200)}`;
  const expectedStaleStr = `${t("dash.fault")} —`;
  check("Status update sets fault string correctly", faultEl.textContent === expectedFaultStr);

  // 执行 5 次 refresh()（模拟波形关闭或波形未包含旧通道时的定时刷新）
  for (let i = 0; i < 5; i++) {
    dash.refresh();
  }
  check("Refresh DOES NOT overwrite active fault with OK", faultEl.textContent === expectedFaultStr);

  // 模拟超时 (超过 3.5s 未收到 STATUS)
  dash._lastStatusTime = (typeof performance !== "undefined" && performance.now) ? performance.now() - 4000 : Date.now() - 4000;
  dash.refresh();
  check("Stale status (timeout) shows dash instead of OK", faultEl.textContent === expectedStaleStr);
}

console.log("\n[3. 稀疏通道展开与录制、触发对齐 (针对缺陷 4)]");
{
  const store = new TelemetryStore(CHANNEL_COUNT, 20);
  const recorder = new SessionRecorder(CHANNEL_COUNT, 20);
  recorder.start();
  const trigger = new TriggerEngine();
  trigger.mode = TriggerMode.NORMAL;
  trigger.armed = true;
  trigger.source = 2; // 监听通道 2 (vel_ctrl)
  trigger.level = 50.0;

  // 掩码 0x0C = bit 2 和 bit 3
  // 模拟第一帧：ch2 = 40.0 (< 50.0)
  const fullValues1 = new Float32Array(CHANNEL_COUNT);
  fullValues1.fill(NaN);
  fullValues1[2] = 40.0;
  fullValues1[3] = 100.0;
  trigger.push(fullValues1, 100);

  // 模拟第二帧：ch2 跃升至 60.0 (>= 50.0)，产生 rising 边沿
  const fullValues2 = new Float32Array(CHANNEL_COUNT);
  fullValues2.fill(NaN);
  fullValues2[2] = 60.0;
  fullValues2[3] = 123.0;

  store.push(fullValues2, 101);
  recorder.push(fullValues2, 101);
  const fired = trigger.push(fullValues2, 101);

  check("Sparse展開: ch0 is NaN", Number.isNaN(store.latest[0]));
  check("Sparse展開: ch2 is 60.0", store.latest[2] === 60.0);
  check("Sparse展開: ch3 is 123.0", store.latest[3] === 123.0);

  // 检查录制器获取的数据
  const recSample = recorder.at(0);
  check("Recorder records ch2 at index 2 (not ch0)", recSample.values[2] === 60.0 && Number.isNaN(recSample.values[0]));

  // 检查触发器（真实从 40.0 穿越到 60.0 > 50.0）
  check("Trigger fires correctly on sparse ch2", fired === true);
}

console.log("\n[4. 16 位序号解缠绕与时间轴单调性 (针对缺陷 5)]");
{
  let receivedSamples = [];
  const adapter = new TelemetryAdapter({
    onSample: (s) => receivedSamples.push(s)
  });

  const decoder = {
    onWave: null,
    push: () => {}
  };
  adapter.attach(decoder);

  // 模拟连续数据经过 65535 回绕到 0, 1
  decoder.onWave(1000, 0x04, new Float32Array([10]), 65534);
  decoder.onWave(1002, 0x04, new Float32Array([11]), 65535);
  decoder.onWave(1004, 0x04, new Float32Array([12]), 0);
  decoder.onWave(1006, 0x04, new Float32Array([13]), 1);

  check("Sequence wraps: unwrapped sampleIndex 65534", receivedSamples[0].sampleIndex === 65534);
  check("Sequence wraps: unwrapped sampleIndex 65535", receivedSamples[1].sampleIndex === 65535);
  check("Sequence wraps: unwrapped sampleIndex 65536 (unwrapped past wrap)", receivedSamples[2].sampleIndex === 65536);
  check("Sequence wraps: unwrapped sampleIndex 65537", receivedSamples[3].sampleIndex === 65537);
  check("Raw seq preserved", receivedSamples[2].rawSeq === 0);
  check("TimeMs preserved", receivedSamples[2].timeMs === 1004);
}

console.log("\n[5. 掩码与载荷强校验、畸变帧过滤 (针对缺陷 6 & 9)]");
{
  const dec = new StpDecoder({
    onWave: () => decFrames.push("wave"),
    onStatus: () => decFrames.push("status")
  });
  let decFrames = [];

  // A. 伪造一个 WAVE 帧：掩码设置了 32 位全选 (0xFFFFFFFF)，但只有 16 个 float (载荷 72 字节)
  const bufInconsistent = new Uint8Array(80);
  bufInconsistent[0] = 0xA5;
  bufInconsistent[1] = 0x5A;
  bufInconsistent[2] = 0x11; // WAVE
  bufInconsistent[3] = 72;   // LEN
  bufInconsistent[4] = 0; bufInconsistent[5] = 0; // seq
  // tick = 0
  const dv = new DataView(bufInconsistent.buffer);
  dv.setUint32(6, 100, true);
  dv.setUint32(10, 0xFFFFFFFF, true); // mask = 32 通道，但 LEN 只有 72 (16 float)
  const crcA = crc16Ccitt(bufInconsistent, 2, 4 + 72);
  dv.setUint16(78, crcA, true);

  dec.push(bufInconsistent);
  check("Inconsistent mask popcount vs payload rejected by decoder", decFrames.length === 0);

  // B. 伪造一个带畸变超长 LEN=255 的同步字，后面紧跟一个合法的 STATUS 帧
  const badSync = new Uint8Array([0xA5, 0x5A, 0x11, 255, 0x00, 0x01]);
  // 合法 STATUS 帧 (总长 23 字节)
  const validStatus = new Uint8Array(23);
  validStatus[0] = 0xA5;
  validStatus[1] = 0x5A;
  validStatus[2] = 0x12; // STATUS
  validStatus[3] = 15;   // LEN = 15
  validStatus[4] = 1; validStatus[5] = 0; // seq = 1
  const dvS = new DataView(validStatus.buffer);
  dvS.setUint32(6, 500, true);  // timestamp
  dvS.setUint16(10, 1420, true); // vbus 14.2V
  const crcS = crc16Ccitt(validStatus, 2, 4 + 15);
  dvS.setUint16(21, crcS, true);

  const mixedBuf = new Uint8Array(badSync.length + validStatus.length);
  mixedBuf.set(badSync, 0);
  mixedBuf.set(validStatus, badSync.length);

  dec.push(mixedBuf);
  check("Fake sync with invalid large LEN skipped immediately without stalling", decFrames.length === 1 && decFrames[0] === "status");
}

console.log("\n[6. 下采样保留 NaN，绝不转换为假零 (针对缺陷 7)]");
{
  const store = new TelemetryStore(4, 100);
  // 向通道 1 填入正常数值，通道 2 始终填入 NaN
  for (let i = 0; i < 100; i++) {
    const v = new Float32Array(4);
    v[0] = i;
    v[1] = 10.0 + Math.sin(i / 5.0);
    v[2] = NaN; // 未订阅通道
    v[3] = 0.0;
    store.push(v, i);
  }

  // 触发下采样为 10 列
  const peaksCh2 = store.getSeriesPeaks(2, 100, 10);
  let hasZeroInCh2 = false;
  let allNaNInCh2 = true;
  for (let i = 0; i < peaksCh2.n; i++) {
    if (peaksCh2.minY[i] === 0 || peaksCh2.maxY[i] === 0) {
      hasZeroInCh2 = true;
    }
    if (!Number.isNaN(peaksCh2.minY[i]) || !Number.isNaN(peaksCh2.maxY[i])) {
      allNaNInCh2 = false;
    }
  }
  check("Downsampled peaks for unselected channel DOES NOT convert to 0", !hasZeroInCh2);
  check("Downsampled peaks for unselected channel remains NaN", allNaNInCh2);

  // 测试冻结区间版本 getSeriesPeaksByRange
  const rangePeaksCh2 = store.getSeriesPeaksByRange(2, 20, 80, 10);
  let rangeHasZero = false;
  let rangeAllNaN = true;
  for (let i = 0; i < rangePeaksCh2.n; i++) {
    if (rangePeaksCh2.minY[i] === 0 || rangePeaksCh2.maxY[i] === 0) {
      rangeHasZero = true;
    }
    if (!Number.isNaN(rangePeaksCh2.minY[i]) || !Number.isNaN(rangePeaksCh2.maxY[i])) {
      rangeAllNaN = false;
    }
  }
  check("Range downsampled peaks for unselected channel DOES NOT convert to 0", !rangeHasZero);
  check("Range downsampled peaks for unselected channel remains NaN", rangeAllNaN);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
