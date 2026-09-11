# FOC Studio v0.3.1

网页版 FOC 上位机：兼容 G431B-FOC 的 **JustFloat 遥测 + ASCII CLI**，不依赖 VOFA+。

**不修改单片机固件。当前未实现 Binary Protocol / CAN。**

## 在线

https://kyroqu.xyz/foc-studio/ （Chrome / Edge，Web Serial 需 HTTPS）

## 功能（v0.3.1）

| 模块 | 能力 |
|------|------|
| Scope | 16 通道、保峰绘制、双游标、触发、数学通道、PNG/CSV、图例实时值 |
| Dashboard | 状态条 + 关键量 + 故障名（对齐固件枚举） |
| Console | Enable / E-STOP / mode / target / 自定义 CLI |
| Tuning | 滑条 → CLI（本地编辑值，非 MCU 回读；RAM） |
| Terminal | CLI + JustFloat 解复用 |
| Record | 录制 / 标记 / CSV·JSON / 回放 |
| Sim | 1 kHz Normal / 5 kHz Stress |

## 稳定性（v0.3.1 加固）

- Serial：generation 防串台、写队列串行化、E-STOP 优先、异常回 DISCONNECTED
- JustFloat：随机分包 / 文本插入 / 假 tail / Inf 可恢复
- Store：环形缓冲不膨胀；`sampleAtInto` 低分配；index 用 Float64
- Scope：`start()` 幂等；`destroy()` 卸监听
- 测试：`npm test` 含 lifecycle + soak/fuzz

## 本地

```powershell
npm test
npm run test:stability
python -m http.server 8765
```

## 协议

JustFloat：`16 × float32-LE + 00 00 80 7F`。通道见 `foc_telemetry.h`。  
ch13 = `motor_fault*100 + current_shunt_fault`。

## 架构

```
UI → Math/Trigger/Measure → Adapter/Store → JustFloat/Sim/Replay/Serial
```

## License

MIT
