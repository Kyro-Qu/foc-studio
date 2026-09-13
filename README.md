# FOC Studio v0.4.0

网页版 FOC 上位机：对接 G431B-FOC 固件 v0.4.0+ 的 **FOC-STP v1.0 自解释掩码遥测 + ASCII CLI**，不依赖 VOFA+。

需要与固件 **FOC_G431 ≥ 0.4.0**（FOC-STP 协议）配套；旧的 JustFloat 固件（≤ 0.3.x）不再兼容。

## 当前能力边界（请如实理解）

| 有 | 没有 |
|----|------|
| FOC-STP 32 通道字典、任意子集订阅（单帧 ≤16 通道，真板 500 Hz，可 `telem rate` 降速） | CAN |
| 10 Hz 独立 STATUS 心跳驱动仪表盘 / 故障灯（波形关闭时依旧刷新） | MCU 参数回读 |
| EVENT 故障跳闸 / 状态跳变事件、ACK 配置应答 | Blackbox / 校准向导 |
| ASCII CLI 终端 / 控制台 / 调参 | 多设备 / 云端 |
| 录制 / CSV 回放、中英切换 | |

Tuning、快捷控制均为 **本地编辑值 → CLI 写入 RAM**，不是 MCU 当前值。

## 在线

https://kyroqu.xyz/foc-studio/ （Chrome / Edge）

## 功能摘要

- **仪表盘**：RPM / Iq / Vbus / 占空比 指针表；目标滑条（单位随模式：RPM / A / rad）；由 STATUS 心跳独立驱动
- **示波器**：32 通道字典勾选即下发 `telem mask`，未订阅通道以 NaN 断线显示（不画假零线）；保峰绘制、双游标、触发、数学通道、图例、PNG/CSV
- **协议**：CRC16-CCITT 校验、16 位帧序号解缠绕、粘包/切片/假同步字自恢复；CLI 裸文本与二进制帧交错时按字节流解复用
- **控制台 / 调参 / 终端 / 录制**
- **仿真**：1 / 2 / 5 kHz（输入与 60FPS 绘图解耦）

## 测试

```powershell
npm test
npm run test:stability
```

`tests/stp-cross-verify.mjs` 会读取固件仓库 `../FOC_G431/tests/stp_golden.bin`（由 C 端 `tests/test_stp_cross.c` 生成）做跨语言一致性校验。

## Chrome DevTools 性能方法

1. 仿真选 **5 kHz Stress**，Scope 打开 2–3 个通道  
2. Performance 录 30s：看 FPS、Long Tasks、GC  
3. Memory 录 Heap snapshot ×2 间隔 1min：对比是否有持续上涨  
4. 真板 6.5 Mbaud 长跑时同样采样  

## 架构

```
UI → Math/Trigger/Measure → Adapter/Store → FOC-STP (stp.js) / Sim / Replay / Serial
```

协议规格见固件仓库 `Docs/11_FOC-STP遥测协议.md`。

## License

MIT
