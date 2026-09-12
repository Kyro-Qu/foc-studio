/**
 * @file    stp-cross-verify.mjs
 * @brief   读取 C 程序生成的真实二进制帧，验证 JS 解码器的一致性
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { StpDecoder } from "../js/protocol/stp.js";

const binPath = path.resolve("..", "FOC_G431", "tests", "stp_golden.bin");
assert.ok(fs.existsSync(binPath), `Golden bin not found: ${binPath}`);
const bin = fs.readFileSync(binPath);

const results = {
  wave: null,
  status: null,
  text: null,
  event: null,
  ack: null,
};

const decoder = new StpDecoder({
  onWave: (tick, mask, values, seq) => {
    results.wave = { tick, mask, values: Array.from(values), seq };
  },
  onStatus: (status, seq) => {
    results.status = { ...status, seq };
  },
  onText: (text, seq) => {
    results.text = { text, seq };
  },
  onEvent: (event, seq) => {
    results.event = { ...event, seq };
  },
  onAck: (ack, seq) => {
    results.ack = { ...ack, seq };
  },
});

// 模拟 7 字节不规则分片流式解包
for (let i = 0; i < bin.length; i += 7) {
  decoder.push(bin.subarray(i, Math.min(i + 7, bin.length)));
}

console.log("[Cross-Language FOC-STP Verification]");

// 1. Wave 验证
assert.ok(results.wave, "Wave frame decoded");
assert.equal(results.wave.seq, 1);
assert.equal(results.wave.tick, 10000);
assert.equal(results.wave.mask, 0x0000000F);
const expectedVals = [3.14159, -12.5, 0.05, 1500.0];
for (let i = 0; i < 4; i++) {
  assert.ok(Math.abs(results.wave.values[i] - expectedVals[i]) < 1e-4, `Wave val[${i}] matches`);
}
console.log("  PASS  Wave frame matches C values within float tolerance");

// 2. Status 验证
assert.ok(results.status, "Status frame decoded");
assert.equal(results.status.seq, 2);
assert.equal(results.status.timestampMs, 10050);
assert.equal(results.status.vbus, 14.4);
assert.equal(results.status.tempC, 42);
assert.equal(results.status.rpmEst, 1500);
assert.equal(results.status.iqEst, 0.52);
console.log("  PASS  Status frame matches C heartbeat values");

// 3. Text 验证
assert.ok(results.text, "Text frame decoded");
assert.equal(results.text.seq, 3);
assert.equal(results.text.text, "M0 RUN mode=vel\r\n");
console.log("  PASS  Text frame matches CLI output");

// 4. Event 验证
assert.ok(results.event, "Event frame decoded");
assert.equal(results.event.seq, 4);
assert.equal(results.event.eventId, 1);
assert.equal(results.event.motorFault, 6);
assert.equal(results.event.detail, 1850);
console.log("  PASS  Event frame matches trip snapshot");

// 5. ACK 验证
assert.ok(results.ack, "ACK frame decoded");
assert.equal(results.ack.seq, 5);
assert.equal(results.ack.cmdCode, 1);
assert.equal(results.ack.effectiveMask, 0x000000FF);
assert.equal(results.ack.effectiveRateHz, 500);
console.log("  PASS  ACK frame matches response");

console.log("\nALL 5 C-generated STP frames successfully verified by JS decoder!\n");
