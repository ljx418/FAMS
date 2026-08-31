# V2-PX PX5-02 验收独立审计

日期：2026-08-31

结论：`PASS`

## 1. 精确证据

- 验收提交：`51a9329ec6f8f8af3a4a1fe8888be533580d8993`
- 私有证据：`.verification/private/v2-px/51a9329ec6f8f8af3a4a1fe8888be533580d8993/PX5-02/`
- 主报告 SHA-256：`62b39a5143f5eee6b29382f1c7543e87cd246695cfcdfc0df5a2917d3c1c8aa2`
- Chrome trace SHA-256：`913bcaf3229bb66db66b24f48d2389b01a2112bbf146cc520ea6d3cb9ec6d770`
- network SHA-256：`d05fd155a5b7a180da80bd2398d83e3190fbe955db75363607e0f60e4e6f7c97`
- lifecycle storage SHA-256：`fbd03a3881fe9a924004158bfc656c2a884a4c61a74cb7cca40500f65cab95e8`
- console SHA-256：`b71f852bb5c3b5280018b4c4cdf0145f2a659fc92a5a9ffa833969190b68538e`

## 2. 自动验收结果

| 门槛 | 结果 |
| --- | --- |
| typecheck / 全量测试 | PASS；14 files / 93 tests |
| 语义/API/策略合同 | PASS；5/5 target schema 正例通过、负例拒绝；真实 API 339 Operation/28 Review；交易策略锁定 |
| 真实浏览器与数据 | Chrome for Testing `152.0.7977.64`；真实 `backend/prisma/dev.db` backup；真实 `running` Operation `68ade055-92e0-4cc8-a78b-092bd11f6fd1` |
| extension update | 0.1.0→0.2.0；同 profile/同 ID；session 为空；RecoveryIndex 恢复 276ms；权限集合不扩大 |
| active Operation | 页面控制消息恰为 1；Background 4 次 GET；间隔 2010/4001/8000/10002ms；第四次后停止 |
| FAMS 断连/恢复 | 2680ms 内显示 disconnected；服务恢复后 108ms 回到 ready |
| worker / lease | CDP 终止 Worker 后 315ms 恢复；reconnect 事件可见；6 分钟 stale lease 产生 lease_expired/closed |
| 双容器 | lease 2→1→0；关闭一个不 closed；最后关闭后 closed 且新增 GET=0 |
| 安全/真实性 | POST=0；交易请求=0；Transaction 差分=0；secret-like storage=0；console error=0；四锁 false |

## 3. 防假绿与失败处置

开发验收曾真实暴露并闭环五类问题：事件结束后 MV3 内存 timer 消失；unpacked update 继续使用旧 Worker 缓存；`runtime.reload()` 在 headless 命令行扩展下不可用；Worker 初始化与 Port 订阅整表写入竞争；网络耗时叠加导致 10 秒间隔漂移。每次失败均打回合同/实现或验收器修复，未计为通过。最终正式证据来自精确、干净提交，未使用 DevTools 保活、heartbeat、alarm、远程服务或虚构业务数据。

## 4. 出门结论

PX5-02 致命问题=0，重大规格偏差=0。PX5-01 + PX5-02 已覆盖 M5 lifecycle 的刷新、重开、Chrome 重启、FAMS 断连、Worker suspend、extension update、stale/dual lease 与有界轮询，M5 判定 `PASS`。允许进入 PX6-01 全量自动验收；PX6-02 人类体验确认仍未执行，V2-PX 不得声明最终产品化 candidate，也不得解锁任何交易能力。
