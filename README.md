# FOC Studio v0.3.3

网页版 FOC 上位机：兼容 G431B-FOC 的 **JustFloat 遥测 + ASCII CLI**，不依赖 VOFA+。

**不修改单片机固件。**

## 当前能力边界（请如实理解）

| 有 | 没有 |
|----|------|
| JustFloat 16 通道波形 | Binary Protocol |
| ASCII CLI 终端 / 控制台 / 调参 | CAN |
| 仪表盘表盘 + 快捷控制滑条 | MCU 参数回读 |
| 录制 / CSV 回放 | Blackbox / 校准向导 |
| 中英切换 | 多设备 / 云端 |

Tuning、快捷控制均为 **本地编辑值 → CLI 写入 RAM**，不是 MCU 当前值。

## 在线

https://kyroqu.xyz/foc-studio/ （Chrome / Edge）

## 功能摘要

- **仪表盘**：RPM / Iq / Vbus / 占空比 指针表；目标滑条（单位随模式：RPM / A / rad）
- **示波器**：保峰绘制、双游标、触发、数学通道、图例、PNG/CSV
- **控制台 / 调参 / 终端 / 录制**
- **仿真**：1 / 2 / 5 kHz（输入与 60FPS 绘图解耦）

## 测试

```powershell
npm test
npm run test:stability
```

## Chrome DevTools 性能方法

1. 仿真选 **5 kHz Stress**，Scope 打开 2–3 个通道  
2. Performance 录 30s：看 FPS、Long Tasks、GC  
3. Memory 录 Heap snapshot ×2 间隔 1min：对比是否有持续上涨  
4. 真板 6.5 Mbaud 长跑时同样采样  

## 架构

```
UI → Math/Trigger/Measure → Adapter/Store → JustFloat / Sim / Replay / Serial
```

## License

MIT
