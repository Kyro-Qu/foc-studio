---
feature: foc-studio-v02
status: delivered
updated: 2026-09-12
branch: master→main
commits: root..cc99ccd
---

# FOC Studio v0.2 — 示波器工程化 + 控制台 + 回放

## Report

**What was built** — 网页版 FOC Studio v0.2：在不改 G431 固件前提下，兼容现有 JustFloat + ASCII CLI。Scope 增加双游标（Δt/Δy）、显示触发（Auto/Normal、边沿/电平、Arm）、滚轮缩放、PNG/CSV、数学通道（a±b、|a|、da/dt）与测量条（min/max/avg/rms/p2p）。Console 将 Enable/E-STOP/mode/target/rpm/vq/自定义命令映射到 CLI。Record 支持录制、标记、CSV/JSON 导出与 CSV 回放。已推送 `https://github.com/Kyro-Qu/foc-studio` 并开启 GitHub Pages。

**Verification** — `npm test`：28 unit + 5 integration + 21 v02 + 9 trigger-freeze + check-links 全部 PASS。解码约 47 万帧/秒。Review 后已修：触发冻结改为锁定数据窗（getSeriesPeaksByRange）。

**Journey log**
1. CLI 与 JustFloat 混流必须常驻解复用 + 帧锁定。
2. JustFloat 的 +Inf 字节与 tail 相同，需 locked 对齐。
3. 显示触发必须冻结**数据切片**，只改坐标轴轨迹会继续滚动。
4. 不改固件是硬约束：触发/数学/回放全在前端。
5. GitHub Pages 域名 kyroqu.xyz/foc-studio/；Web Serial 需 HTTPS。

## [S1] Problem

v0.1 能替代 VOFA 出波形，但缺触发、测量、数学通道、控制台快捷操作与录制回放。

## [S2] Design

分层：UI → Math/Trigger/Measure → Adapter/Store → JustFloat/Sim/Replay/Serial。触发为纯显示触发；控制台只发既有 CLI；CSV 列 `time_s,ch0..ch15`。

## [S3] Out of Scope

固件修改、Binary Protocol、CAN、Tauri、自动 PID 整定。

## Tasks

- [x] T1: measure.js — min/max/mean/rms/p2p 单测通过 (covers S2)
- [x] T2: math.js — sub/add/abs/dt 单测通过 (covers S2)
- [x] T3: trigger.js — rise/fall 冻结视图 (covers S2)
- [x] T4: Scope 双游标/PNG/滚轮/测量条 (covers S2)
- [x] T5: Console CLI 映射 (covers S2)
- [x] T6: Recorder CSV 往返 (covers S2)
- [x] T7: UI 总装 + check-links (covers S2)
- [x] T8: npm test 全绿 + README (covers S2)
