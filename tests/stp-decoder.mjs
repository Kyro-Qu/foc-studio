/**
 * @file    stp-decoder.mjs
 * @brief   FOC-STP v1.0 编解码器自动化测试
 */

import assert from "node:assert/strict";
import {
  StpDecoder,
  crc16Ccitt,
  FOC_STP_SYNC0,
  FOC_STP_SYNC1,
  FOC_STP_TYPE_WAVE,
  FOC_STP_TYPE_STATUS,
  FOC_STP_TYPE_EVENT,
  FOC_STP_TYPE_TEXT,
  FOC_STP_TYPE_ACK,
} from "../js/protocol/stp.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`, err);
    throw err;
  }
}

console.log("\n[FOC-STP v1.0 Decoder Tests]");

test("CRC16-CCITT 基础向量验证 ('123456789' -> 0x29B1)", () => {
  const bytes = new TextEncoder().encode("123456789");
  const crc = crc16Ccitt(bytes);
  assert.equal(crc, 0x29B1, `Expected 0x29B1, got 0x${crc.toString(16)}`);
});

test("Wave 帧打包与流式解码", () => {
  const waves = [];
  const decoder = new StpDecoder({
    onWave: (tick, mask, values, seq) => {
      waves.push({ tick, mask, values: Array.from(values), seq });
    },
  });

  // 构造一帧 4 通道波形
  const tick = 1000;
  const mask = 0x0000000F; // 4 通道
  const vals = [1.25, -0.5, 123.456, 0.001];
  const payloadLen = 8 + 4 * 4; // 24
  const frameLen = 8 + payloadLen; // 32
  const buf = new Uint8Array(frameLen);
  const view = new DataView(buf.buffer);

  buf[0] = FOC_STP_SYNC0;
  buf[1] = FOC_STP_SYNC1;
  buf[2] = 0x11; // ver 1, type WAVE (1)
  buf[3] = payloadLen;
  view.setUint16(4, 42, true); // seq = 42

  view.setUint32(6, tick, true);
  view.setUint32(10, mask, true);
  for (let i = 0; i < 4; i++) {
    view.setFloat32(14 + i * 4, vals[i], true);
  }

  const crc = crc16Ccitt(buf, 2, 4 + payloadLen);
  view.setUint16(frameLen - 2, crc, true);

  // 分成 3 字节碎片流式推送
  for (let i = 0; i < buf.length; i += 3) {
    decoder.push(buf.subarray(i, Math.min(i + 3, buf.length)));
  }

  assert.equal(waves.length, 1, "Should receive 1 wave frame");
  assert.equal(waves[0].tick, 1000);
  assert.equal(waves[0].mask, 0x0000000F);
  assert.equal(waves[0].seq, 42);
  assert.equal(waves[0].values.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(waves[0].values[i] - vals[i]) < 1e-5);
  }
});

test("Status 心跳帧与 Event 事件帧", () => {
  let statusReceived = null;
  let eventReceived = null;
  const decoder = new StpDecoder({
    onStatus: (s, seq) => { statusReceived = { ...s, seq }; },
    onEvent: (e, seq) => { eventReceived = { ...e, seq }; },
  });

  // 1. Status
  const sBuf = new Uint8Array(23);
  const sView = new DataView(sBuf.buffer);
  sBuf[0] = FOC_STP_SYNC0;
  sBuf[1] = FOC_STP_SYNC1;
  sBuf[2] = 0x12; // ver 1, type STATUS
  sBuf[3] = 15;
  sView.setUint16(4, 101, true); // seq
  sView.setUint32(6, 5000, true); // time 5000ms
  sView.setUint16(10, 1440, true); // 14.40V
  sBuf[12] = 0; // motor fault
  sBuf[13] = 0; // shunt fault
  sBuf[14] = 1; // RUN
  sBuf[15] = 2; // VEL
  sBuf[16] = 35; // 35 degC
  sView.setInt16(17, 1500, true); // 1500 rpm
  sView.setInt16(19, 52, true); // 0.52 A
  const sCrc = crc16Ccitt(sBuf, 2, 4 + 15);
  sView.setUint16(21, sCrc, true);

  // 2. Event
  const eBuf = new Uint8Array(19);
  const eView = new DataView(eBuf.buffer);
  eBuf[0] = FOC_STP_SYNC0;
  eBuf[1] = FOC_STP_SYNC1;
  eBuf[2] = 0x13; // ver 1, type EVENT
  eBuf[3] = 11;
  eView.setUint16(4, 102, true); // seq
  eView.setUint32(6, 5050, true); // time 5050ms
  eBuf[10] = 1; // FAULT_TRIP
  eBuf[11] = 5; // OVERCURRENT
  eBuf[12] = 0;
  eView.setUint32(13, 0x12345678, true);
  const eCrc = crc16Ccitt(eBuf, 2, 4 + 11);
  eView.setUint16(17, eCrc, true);

  // 粘包推送
  const merged = new Uint8Array(sBuf.length + eBuf.length);
  merged.set(sBuf, 0);
  merged.set(eBuf, sBuf.length);
  decoder.push(merged);

  assert.ok(statusReceived, "Status should be received");
  assert.equal(statusReceived.vbus, 14.4);
  assert.equal(statusReceived.rpmEst, 1500);
  assert.equal(statusReceived.tempC, 35);
  assert.equal(statusReceived.seq, 101);

  assert.ok(eventReceived, "Event should be received");
  assert.equal(eventReceived.eventId, 1);
  assert.equal(eventReceived.motorFault, 5);
  assert.equal(eventReceived.seq, 102);
});

test("抗噪与自动滑窗同步（包含伪同步字与损坏帧）", () => {
  const texts = [];
  const waves = [];
  const decoder = new StpDecoder({
    onText: (t) => texts.push(t),
    onWave: (tick, mask, values, seq) => waves.push({ seq }),
  });

  // 噪声：ASCII 字符 + 假 A5 5A + 损坏数据
  const noise = new TextEncoder().encode("some boot message\r\n\xA5\x5A\xFF\x00corrupted\xA5\x5A");
  decoder.push(noise);

  // 随后跟一个合法波形帧
  const buf = new Uint8Array(16); // 0 通道波形
  const view = new DataView(buf.buffer);
  buf[0] = FOC_STP_SYNC0;
  buf[1] = FOC_STP_SYNC1;
  buf[2] = 0x11;
  buf[3] = 8;
  view.setUint16(4, 999, true);
  view.setUint32(6, 1234, true); // tick
  view.setUint32(10, 0, true); // mask 0
  const crc = crc16Ccitt(buf, 2, 4 + 8);
  view.setUint16(14, crc, true);

  decoder.push(buf);

  assert.equal(waves.length, 1, "Should recover and decode the valid wave frame");
  assert.equal(waves[0].seq, 999);
  assert.ok(texts.some(t => t.includes("boot message")), "Text before frames should be extracted");
});

function makeStatusFrame(seq) {
  const buf = new Uint8Array(23);
  const view = new DataView(buf.buffer);
  buf[0] = FOC_STP_SYNC0;
  buf[1] = FOC_STP_SYNC1;
  buf[2] = 0x10 | FOC_STP_TYPE_STATUS;
  buf[3] = 15;
  view.setUint16(4, seq, true);
  view.setUint32(6, 5000, true);
  view.setUint16(10, 1442, true);
  view.setUint16(21, crc16Ccitt(buf, 2, 4 + 15), true);
  return buf;
}

test("裸 CLI 文本与二进制帧交错：行尾 \\r\\n 完整保留、不合并行", () => {
  const texts = [];
  const statuses = [];
  const decoder = new StpDecoder({
    onText: (t) => texts.push(t),
    onStatus: (s) => statuses.push(s),
  });
  const enc = new TextEncoder();

  // 1) 文本块单独到达（长度 >= 8，无同步字），最后一字节是 '\n'，必须整体上交
  decoder.push(enc.encode("M0 IDLE mode=vf\r\n"));
  assert.equal(texts.join(""), "M0 IDLE mode=vf\r\n", "trailing newline must not be retained/dropped");

  // 2) 文本紧跟 STATUS 帧在同一块内
  const line2 = enc.encode("telem: enable=1\r\n");
  const st = makeStatusFrame(7);
  const mixed = new Uint8Array(line2.length + st.length);
  mixed.set(line2, 0);
  mixed.set(st, line2.length);
  decoder.push(mixed);
  assert.equal(statuses.length, 1, "STATUS frame after text decodes");
  assert.equal(texts.join(""), "M0 IDLE mode=vf\r\ntelem: enable=1\r\n");

  // 3) 文本以 0xA5 结尾且同步字被块边界切开：帧仍需完整解码，A5 不得当成文本
  const line3 = enc.encode("ok line\r\n");
  const st2 = makeStatusFrame(8);
  const part1 = new Uint8Array(line3.length + 1);
  part1.set(line3, 0);
  part1[line3.length] = FOC_STP_SYNC0;
  decoder.push(part1);
  decoder.push(st2.subarray(1));
  assert.equal(statuses.length, 2, "split-sync STATUS frame decodes");
  assert.equal(statuses[1].vbus, 14.42);
  assert.equal(texts.join(""), "M0 IDLE mode=vf\r\ntelem: enable=1\r\nok line\r\n");

  // 4) 不足 8 字节的短回复只在空闲刷新时上交
  decoder.push(enc.encode("ok\r\n"));
  assert.equal(texts.join(""), "M0 IDLE mode=vf\r\ntelem: enable=1\r\nok line\r\n", "short text waits");
  decoder.flushIdle();
  assert.equal(texts.join(""), "M0 IDLE mode=vf\r\ntelem: enable=1\r\nok line\r\nok\r\n", "idle flush emits short text");

  // 5) 空闲刷新不得吞掉已就位但未到齐的帧头
  decoder.push(st.subarray(0, 10));
  decoder.flushIdle();
  decoder.push(st.subarray(10));
  assert.equal(statuses.length, 3, "partial frame survives idle flush");
});

console.log(`\nAll ${passed} FOC-STP decoder tests passed!\n`);
