import { MotorParamManager } from "../js/data/motor-param-manager.js";
import { calcKvFromFlux, calcFluxFromKv } from "../js/data/motor-schema.js";

console.log("=== 1. 测试标准换算向量 ===");
// 测试向量：pp=7, flux=0.00082075 Wb -> KV≈960 (严格对应 foc_cmd.c:705 固件公式)
const testKv = calcKvFromFlux(0.00082075, 7);
console.log(`calcKvFromFlux(0.00082075, 7) = ${testKv} (期望: 960)`);
if (Math.abs(testKv - 960) > 2) throw new Error("KV换算偏差过大！");

// 反算磁链
const testFlux = calcFluxFromKv(960, 7);
console.log(`calcFluxFromKv(960, 7) = ${testFlux} Wb (期望: ~0.000821)`);
if (Math.abs(testFlux - 0.000821) > 0.00001) throw new Error("磁链反算偏差过大！");

console.log("\n=== 2. 测试 MotorParamManager 状态机与单向 DAG ===");
const mgr = new MotorParamManager();

// 设置手册已知项
mgr.setUserInput("pp", 7);
mgr.setUserInput("kv", 960);

const fluxCandidate = mgr.get("flux").candidate;
console.log("手册输入 pp=7, kv=960 后，推导磁链:", fluxCandidate);
if (fluxCandidate.source !== "identified" || !fluxCandidate.value) {
  throw new Error("磁链未自动推导！");
}

console.log("\n=== 3. 测试辨识事务与极对数冲突门禁 ===");
mgr.startIdentSession("full");
// 模拟单片机测得：Rs=0.1042, Ls=22.5, Flux=0.000948, 但测得 pp=8（与手册 7 冲突！）
mgr.feedIdentResult({
  rs: 0.1042,
  ls: 22.5,
  flux: 0.000948,
  pp: 8,
});

console.log("极对数冲突状态 ppConflict:", mgr.ppConflict);
if (!mgr.ppConflict) throw new Error("极对数冲突未拦截！");

const reportBefore = mgr.getReadinessReport();
console.log("闭环允许状态 canCloseLoop (期望 false):", reportBefore.canCloseLoop);
console.log("拦截原因 blockers:", reportBefore.blockers);
if (reportBefore.canCloseLoop) throw new Error("极对数冲突时竟允许闭环！");

// 批量采纳（安全门禁：跳过冲突项）
const batchRes = mgr.applyIdentSession(true);
console.log("批量采纳结果 (跳过冲突项):", batchRes);
if (!batchRes.skippedKeys.includes("pp")) throw new Error("批量采纳未跳过冲突的 pp！");
if (mgr.get("rs").candidate.value !== 0.1042) throw new Error("Rs 未采纳实测值！");

console.log("\n=== 4. 测试人工裁决极对数门禁放行 ===");
mgr.confirmPpChoice("identified"); // 人工确认采用辨识的 8
console.log("人工确认后 ppCandidate:", mgr.get("pp").candidate);
const reportAfter = mgr.getReadinessReport();
console.log("人工确认后 canCloseLoop (期望 true):", reportAfter.canCloseLoop);
if (!reportAfter.canCloseLoop) throw new Error("人工确认后仍未放行闭环！");

console.log("\n=== 5. 测试 RAM 应用与 Flash 固化 Dirty 状态 ===");
mgr.markAppliedToMcu();
console.log("应用到 RAM 后 flashDirty (期望 true):", mgr.flashDirty);
if (!mgr.flashDirty) throw new Error("应用到 RAM 后未标记 flashDirty！");

mgr.markPersistedToFlash();
console.log("固化到 Flash 后 flashDirty (期望 false):", mgr.flashDirty);
if (mgr.flashDirty) throw new Error("固化到 Flash 后未清除 flashDirty！");

console.log("\n=== 6. 测试全参数硬件读取 (syncFromMcuRam) 与双源/三源采纳 ===");
mgr.syncFromMcuRam({
  max_rpm: 7200,
  i_rated: 5.5,
  v_rated: 12.6,
  pp: 7,
  rs: 0.115,
});

console.log("max_rpm active 读取值:", mgr.get("max_rpm").active.value);
if (mgr.get("max_rpm").active.value !== 7200) throw new Error("max_rpm active 读取失败！");
if (mgr.get("i_rated").active.value !== 5.5) throw new Error("i_rated active 读取失败！");
if (mgr.get("v_rated").active.value !== 12.6) throw new Error("v_rated active 读取失败！");

// 测试最大转速采纳硬件读取值
mgr.selectSourceForCandidate("max_rpm", "active");
console.log("max_rpm 采纳 active 后 candidate:", mgr.get("max_rpm").candidate);
if (mgr.get("max_rpm").candidate.value !== 7200 || mgr.get("max_rpm").candidate.source !== "active") {
  throw new Error("max_rpm 采纳 active 失败！");
}

// 测试最大转速切回手填
mgr.selectSourceForCandidate("max_rpm", "manual");
console.log("max_rpm 切回 manual 后 candidate:", mgr.get("max_rpm").candidate);
if (mgr.get("max_rpm").candidate.source !== "manual") {
  throw new Error("max_rpm 切回 manual 失败！");
}

console.log("\n>>> ALL MOTOR PARAM MANAGER TESTS PASSED! <<<");
