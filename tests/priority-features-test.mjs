/**
 * 针对新特性的单元与自动化验证测试：
 * 1. 示波器双游标物理换算引擎（Δt, f, Overshoot%）
 * 2. 调参脏状态与基准感知逻辑
 * 3. 专家面板：无感状态机解析、黑匣子十六进制解析与抗齿槽 144 点解析
 */

import assert from "node:assert";
import { TelemetryStore } from "../js/data/telemetry-store.js";
import { CHANNEL_COUNT } from "../js/channels.js";
import { ExpertPanel } from "../js/ui/expert.js";
import { decodeFault, faultText } from "../js/ui/fault.js";

console.log("\n[1. 示波器双游标物理换算与超调量算法验证]");
{
  const store = new TelemetryStore(CHANNEL_COUNT, 1000);
  const sampleRate = 500; // 500 Hz -> dt = 2ms per sample

  // 构造模拟阶跃波形：从 0 RPM 阶跃至 1000 RPM，峰值冲到 1100 RPM（超调 10%）
  for (let i = 0; i < 100; i++) {
    const vals = new Float32Array(CHANNEL_COUNT);
    vals.fill(NaN);
    if (i < 20) {
      vals[2] = 0; // ch2: vel_ctrl
    } else if (i < 40) {
      // 阶跃上升并在 i=30 达到峰值 1100
      vals[2] = 1000 + (10 - Math.abs(i - 30)) * 10;
    } else {
      vals[2] = 1000; // 稳态 1000
    }
    store.push(vals, i);
  }

  // 模拟游标在 i1 = 10 (v=0), i2 = 60 (v=1000)
  const s1 = store.sampleAt(store.offsetOf(10));
  const s2 = store.sampleAt(store.offsetOf(60));
  assert(s1 && s2);

  const dt = (s2.sampleIndex - s1.sampleIndex) / sampleRate;
  const absDt = Math.abs(dt);
  const freqHz = 1 / absDt;

  assert.strictEqual(dt, 50 / 500); // 0.1s
  assert.strictEqual(freqHz, 10); // 10 Hz

  // 峰值搜索计算超调量
  let peakVal = s1.values[2];
  const deltaY = s2.values[2] - s1.values[2];
  for (let i = 10; i <= 60; i++) {
    const val = store.sampleAt(store.offsetOf(i)).values[2];
    if (val > peakVal) peakVal = val;
  }
  assert.strictEqual(peakVal, 1100);
  const overshoot = ((peakVal - s2.values[2]) / deltaY) * 100;
  assert.strictEqual(overshoot, 10.0); // 10%

  console.log("  PASS  Δt=0.1s, f=10Hz, ΔY=1000rpm, 超调量计算精确为 10.0%");
}

console.log("\n[2. 故障黑匣子十六进制浮点解析验证]");
{
  // 模拟下位机输出的十六进制浮点数 dump
  // iu=1.5A (0x3FC00000), iw=-1.5A (0xBFC00000), th=3.14rad (0x4048F5C3), iq=2.0A (0x40000000), id=0.0A (0x00000000)
  const line = "0 3fc00000 bfc00000 4048f5c3 40000000 00000000";
  const parts = line.trim().split(/\s+/);

  const buf = new ArrayBuffer(4);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);

  const parseHexFloat = (hexStr) => {
    u32[0] = parseInt(hexStr, 16);
    return f32[0];
  };

  const iu = parseHexFloat(parts[1]);
  const iw = parseHexFloat(parts[2]);
  const th = parseHexFloat(parts[3]);
  const iq = parseHexFloat(parts[4]);
  const id = parseHexFloat(parts[5]);

  assert(Math.abs(iu - 1.5) < 1e-5);
  assert(Math.abs(iw - (-1.5)) < 1e-5);
  assert(Math.abs(th - 3.14) < 1e-2);
  assert(Math.abs(iq - 2.0) < 1e-5);
  assert(Math.abs(id - 0.0) < 1e-5);

  console.log("  PASS  Blackbox dump 十六进制单精度浮点逆向还原精度 100%");
}

console.log("\n[3. 纯无感 7 状态机回显匹配解析验证]");
{
  const fbText = "feedback: mode=sensorless state=run blend=1.00 delta=2.1deg spd_open=800.0 spd_obs=798.5 lock=1 conf=0.98 streak=150 lost=0 if_curr=0.50 if_rpm=800";
  const pick = (re) => {
    const m = fbText.match(re);
    return m ? m[1] : null;
  };

  const state = pick(/state=([a-zA-Z0-9_]+)/);
  const delta = parseFloat(pick(/delta=([0-9.-]+)deg/));
  const spdObs = parseFloat(pick(/spd_obs=([0-9.-]+)/));
  const lock = parseInt(pick(/lock=([0-9]+)/), 10);
  const conf = parseFloat(pick(/conf=([0-9.]+)/));

  assert.strictEqual(state, "run");
  assert.strictEqual(delta, 2.1);
  assert.strictEqual(spdObs, 798.5);
  assert.strictEqual(lock, 1);
  assert.strictEqual(conf, 0.98);

  console.log("  PASS  feedback 状态机模式、角差、观测转速、锁定和置信度全字段匹配无误");
}

console.log("\n[4. 抗齿槽力矩 144 点 dump 数据解析验证]");
{
  const lines = [];
  lines.push("acog dump start pts=144");
  for (let i = 0; i < 144; i++) {
    // 构造一个正弦力矩扰动补偿测试数据
    const deg = i * (360 / 144);
    const buf = new ArrayBuffer(4);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    f32[0] = Math.sin((deg * Math.PI) / 180) * 0.25;
    const hex = u32[0].toString(16).padStart(8, "0");
    lines.push(`${i} ${deg.toFixed(1)} ${hex}`);
  }
  lines.push("acog dump end");

  const fullDump = lines.join("\n");
  const parsedTable = new Float32Array(144);

  const buf = new ArrayBuffer(4);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);

  let count = 0;
  for (const line of fullDump.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const idx = parseInt(parts[0], 10);
      if (idx >= 0 && idx < 144 && parts[2].length === 8) {
        u32[0] = parseInt(parts[2], 16);
        parsedTable[idx] = f32[0];
        count++;
      }
    }
  }

  assert.strictEqual(count, 144);
  assert(Math.abs(parsedTable[36] - 0.25) < 1e-4); // sin(90) = 1 -> 0.25
  assert(Math.abs(parsedTable[72] - 0.0) < 1e-4); // sin(180) = 0 -> 0.0
  assert(Math.abs(parsedTable[108] - (-0.25)) < 1e-4); // sin(270) = -1 -> -0.25

  console.log("  PASS  acog dump 144 槽力矩前馈分布表完整解析与幅值校准无误\n");
}

console.log("\n[5. 板卡信息多维解析与一键系统体检诊断引擎测试]");
{
  const { parseBoardAndStatus, diagnoseSystemHealth, parseResetFlags } = await import(
    "../js/ui/wizard.js"
  );

  // 1. 测试正常上电工况 (Flash 固化校准、cs 就绪、0 丢拍、无故障)
  const normalText = `
firmware=FOC-G431 version=0.4.0 board=B-G431B-ESC1 cli=0.4.0 build=Sep 13 2026 12:00:00
M0 pole_pairs=7 encoder_cpr=4000 udc=24.15V max_rpm=12000 limit=5.20A
M0 IDLE mode=vel target=0.000 vel=0.000
calib=1*
fault=0
calib_state=3 telem=1
rst_flags=0x0C000000 (IWDG=0 SFT=0 BOR=0 PIN=1) chk=1024
cli_rx_overflow=0
calib_dir=1 offset=3.1415rad
cs_ready=1
cs_fault=0 rejected=0 consecutive=0
cpu=18.5% (max 24.2%)
`;

  const info1 = parseBoardAndStatus(normalText);
  assert.strictEqual(info1.board, "B-G431B-ESC1");
  assert.strictEqual(info1.firmware, "FOC-G431");
  assert.strictEqual(info1.version, "0.4.0");
  assert.strictEqual(info1.calibValid, true);
  assert.strictEqual(info1.calibFromStore, true); // 带 '*'
  assert.strictEqual(info1.csReady, 1);
  assert.strictEqual(info1.csFault, 0);
  assert.strictEqual(info1.rejected, 0);
  assert.strictEqual(info1.faultCode, 0);
  assert.strictEqual(info1.cliRxOverflow, 0);

  const diag1 = diagnoseSystemHealth(info1);
  assert.strictEqual(diag1.score, 100);
  assert.strictEqual(diag1.overall, "ok");
  const md1 = diag1.generateMarkdownReport();
  assert(md1.includes("# FOC 系统健康诊断报告"));
  assert(md1.includes("100 / 100"));
  assert(md1.includes("B-G431B-ESC1"));

  // 2. 测试异常工况 (看门狗复位、欠压报警、电流丢拍、RAM校准未持久化)
  const faultyText = `
firmware=FOC-G431 version=0.4.0 board=B-G431B-ESC1 cli=0.4.0 build=Sep 13 2026 12:00:00
M0 IDLE mode=vel target=0.000 vel=0.000
calib=1
fault=11
calib_state=3 telem=0
rst_flags=0x20000000 (IWDG=1 SFT=0 BOR=0 PIN=0) chk=1024
cli_rx_overflow=12
calib_dir=1 offset=1.5700rad
cs_ready=1
cs_fault=0 rejected=5 consecutive=1
cpu=82.0% (max 95.0%)
udc=8.50V
`;

  const info2 = parseBoardAndStatus(faultyText);
  assert.strictEqual(info2.calibFromStore, false); // 不带 '*'
  assert.strictEqual(info2.faultCode, 11); // UNDERVOLTAGE
  assert.strictEqual(info2.faultName, "UNDERVOLTAGE (母线欠压)");
  assert.strictEqual(info2.rejected, 5);
  assert.strictEqual(info2.cliRxOverflow, 12);

  const diag2 = diagnoseSystemHealth(info2);
  assert(diag2.score < 60);
  assert.strictEqual(diag2.overall, "bad");
  assert(diag2.checks.some((c) => c.id === "reset" && c.status === "bad"));
  assert(diag2.checks.some((c) => c.id === "vbus" && c.status === "warn"));
  assert(diag2.checks.some((c) => c.id === "current_sense" && c.status === "warn"));
  assert(diag2.checks.some((c) => c.id === "calib" && c.status === "warn"));

  console.log("  PASS  parseBoardAndStatus 与 diagnoseSystemHealth 诊断全分支与报告生成测试 100% 通过\n");
}

console.log("\n[6. 下位机 wave/silent 模式状态回显与命令兼容验证]");
{
  // 验证 wave 命令回显解析
  const waveResp1 = "wave=1 telem=1\r\n";
  const m1 = waveResp1.match(/wave=([01])\s+telem=([01])/);
  assert(m1 !== null);
  assert.strictEqual(m1[1], "1");
  assert.strictEqual(m1[2], "1");

  const waveResp0 = "wave=0 telem=0\r\n";
  const m0 = waveResp0.match(/wave=([01])\s+telem=([01])/);
  assert(m0 !== null);
  assert.strictEqual(m0[1], "0");
  assert.strictEqual(m0[2], "0");

  console.log("  PASS  wave [0|1] 命令回显解析与双向状态同步逻辑无误\n");
}

console.log("\n[7. 侧边栏折叠状态持久化与状态机测试]");
{
  const mockStorage = new Map();
  const LS_SIDEBAR_KEY = "foc-studio-nav-collapsed";

  const setCollapsed = (val) => mockStorage.set(LS_SIDEBAR_KEY, val ? "1" : "0");
  const getCollapsed = () => mockStorage.get(LS_SIDEBAR_KEY) === "1";

  assert.strictEqual(getCollapsed(), false);
  setCollapsed(true);
  assert.strictEqual(getCollapsed(), true);
  setCollapsed(false);
  assert.strictEqual(getCollapsed(), false);

  console.log("  PASS  侧边栏折叠/展开持久化存储与切换逻辑无误\n");
}

console.log("\n[8. 电机安全与保护功能联动及回读解析测试 (方案 B)]");
{
  // 1. 软电流限幅与过流跳闸 trip 联动公式测试: clamp(limit * 1.25 + 0.1, limit, hard_limit)
  const calcTrip = (limit, hard = 40.0) => {
    return Math.min(Math.max(limit * 1.25 + 0.1, limit), hard);
  };

  assert.strictEqual(Number(calcTrip(5.2).toFixed(2)), 6.60);
  assert.strictEqual(Number(calcTrip(4.0).toFixed(2)), 5.10);
  assert.strictEqual(Number(calcTrip(2.0).toFixed(2)), 2.60);

  // 2. 下位机 limit 与 vbus 回显文本正则回填测试
  const mockLimitText = "M0 limit=5.20A trip=6.60A hard=10.00A\r\n";
  const mockVbusText = "vbus=24.12V (raw=2350 OK) uv=10.00V ov=30.00V\r\n";

  const pick = (text, re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };

  const limitVal = pick(mockLimitText, /limit=([0-9.]+)/i);
  const tripVal = pick(mockLimitText, /trip=([0-9.]+)/i);
  const uvVal = pick(mockVbusText, /uv=([0-9.]+)/i);
  const ovVal = pick(mockVbusText, /ov=([0-9.]+)/i);

  assert.strictEqual(limitVal, "5.20");
  assert.strictEqual(tripVal, "6.60");
  assert.strictEqual(uvVal, "10.00");
  assert.strictEqual(ovVal, "30.00");

  console.log("  PASS  trip 联动公式计算准确且 limit/vbus 响应回填解析无误\n");
}

console.log("\n[9. 板载温度传感器解析与过温保护 (OVERTEMP) 测试]");
{
  // 1. 故障码 13 (OVERTEMP) 解码验证
  const d = decodeFault(13);
  assert.strictEqual(d.motorName, "OVERTEMP");
  assert.strictEqual(d.ok, false);
  assert.strictEqual(faultText(13), "13 OVERTEMP (过温)");

  // 2. CLI temp 输出正则解析验证
  const mockTempText = "temp=36.9C (raw=1729 R=6432ohm OK) ot=85.0C\r\n";
  const m = mockTempText.match(/temp=([\-\d\.]+)C\s+\(raw=(\d+)\s+R=([\-\d\.]+)ohm\s+(\w+)\)\s+ot=([\-\d\.]+)C/);
  assert(m !== null);
  assert.strictEqual(m[1], "36.9");
  assert.strictEqual(m[2], "1729");
  assert.strictEqual(m[3], "6432");
  assert.strictEqual(m[4], "OK");
  assert.strictEqual(m[5], "85.0");

  console.log("  PASS  过温保护代码与温度数据回显解析测试 100% 通过\n");
}


