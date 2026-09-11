---
feature: foc-studio-v02
status: designed
updated: 2026-09-12
branch: none-in-place
commits: n/a
---

# FOC Studio v0.2 — 示波器工程化 + 控制台 + 回放

## Report

（交付后填写）

## [S1] Problem

v0.1 已能替代 VOFA 做 JustFloat 波形 + CLI，但对标 VESC Tool / SimpleFOC WebController / ODrive 仍缺：

1. **示波器工程能力**：无触发、无测量统计、无数学通道、无截图、游标单点。
2. **控制台**：无预设按钮、无 target/模式快捷操作，全靠手打 CLI。
3. **数据资产**：无录制/回放，调参过程无法离线复盘。

约束：**不改 G431 固件**；继续兼容现有 JustFloat + ASCII CLI。

## [S2] Design

### 架构扩展（在 v0.1 分层上挂载）

```
UI: Scope / Console / Terminal / Dashboard / Replay
        │
  Math + Trigger + Measure     ← 纯前端处理
        │
  TelemetryAdapter → Store     ← 样本结构不变
        │
  JustFloatDecoder / Sim / Serial
```

### 2.1 Scope 工程化

| 能力 | 行为 |
|------|------|
| 双游标 | 水平 t1/t2，显示 Δt、各可见通道 Δy |
| 触发 | 源通道、边沿 rise/fall、电平、Arm/Off；触发后冻结显示窗 |
| 测量 | 当前窗口 min/max/mean/rms/p2p/last |
| 数学通道 | M0=a-b, M1=a+b, M2=|a|, M3=d(a)/dt（用源通道 id） |
| 截图 | canvas → PNG 下载 |
| 时间缩放 | 滚轮改 windowSec（0.1–30s） |

触发模型（无固件配合，纯显示触发）：

- 维护滚动缓冲；Arm 后扫描源通道穿越电平
- 触发后锁定显示视图到 pre 20% + post 80% 窗口
- Auto 模式：无触发 2s 仍刷新

### 2.2 控制台 Console

映射到现有 CLI，不发明新协议：

| 控件 | CLI |
|------|-----|
| Enable / Disable / Fault Clear / Calib / Status / Help | 同名命令 |
| Mode | `mode vf\|iq\|vel\|pos` |
| Target 数字框+Apply | `target <v>` |
| RPM | `rpm <v>` |
| Vq | `vq <v>` |
| Log on/off | `log 0\|1` |
| E-Stop | `disable`（最高优先级红按钮） |
| 自定义按钮（localStorage） | 用户命令行 |

### 2.3 录制 / 回放

- **Record**：把 Store 推入 Session（环形或定长 60s），可导出 CSV（与 v0.1 相同列）
- **Replay**：加载 CSV → 按 sample 重放进 Scope（不走串口）
- **Mark**：在时间轴打标记（文本），随 CSV 导出 `mark` 列可选；JSON session 保存 marks

CSV 扩展：保持 `time_s,ch0..ch15`；marks 另存 JSON sidecar 可选。

### 2.4 会话持久化

localStorage：通道名/可见性、控制台自定义按钮、默认 mode。

## [S3] Out of Scope

- 修改 FOC_G431 固件任何文件
- Binary Protocol v1 / CAN / 多设备
- 真实 PID 自动整定
- Electron/Tauri 打包

## Tasks

- [ ] T1: 测量模块 measure.js — acceptance: 单元测试 min/max/mean/rms/p2p 正确 (covers S2.1)
- [ ] T2: 数学通道 math.js — acceptance: a-b/|a|/dt 测试通过 (covers S2.1)
- [ ] T3: 触发引擎 trigger.js — acceptance: 仿真 iq 阶跃可触发并冻结 (covers S2.1)
- [ ] T4: Scope 集成双游标+截图+滚轮+测量条 — acceptance: 单元/链接检查 + 手动可点 (covers S2.1)
- [ ] T5: Console 控制台面板 — acceptance: 发送正确 CLI 字符串（mock write） (covers S2.2)
- [ ] T6: Recorder 录制与 CSV 回放 — acceptance: 录→导→读→回放帧数一致 (covers S2.3)
- [ ] T7: UI 总装 index.html/main.js/css — acceptance: check-links + 全量 npm test 通过 (covers S2)
- [ ] T8: 回归与文档 README v0.2 — acceptance: 测试全绿 (covers S2)
