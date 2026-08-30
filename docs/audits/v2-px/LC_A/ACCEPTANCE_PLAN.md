# V2-PX LC-A 合同重入验收计划

日期：2026-08-31

## 1. 入场门槛

- 用户已明确批准 LC-A。
- 变更范围不要求新 Chrome 权限、远程服务或业务数据库迁移。
- Router/Command 主 envelope 形状保持不变。

## 2. 自动验收

1. target schema 正例通过、负例失败；生命周期 Port 首包、Host、secret、旧 envelope 负例均被拒绝。
2. semantic validator 必须识别合同 metadata、current state 和代码 envelope 一致；旧 `messageId+kind` 通用命令 envelope 必须失败。
3. extension typecheck/build/test 全绿；历史 Router/Host/Workspace/Side Panel 单测无回归。
4. 使用真实 SQLite 中已有 Operation 与 DailyReviewRun 完成 sourceRef encode/decode/schema round-trip。
5. 全仓检索不再有生产 `PX_STORAGE_VERSION_BLOCKED`；历史审计引用可保留。

## 3. 出门门槛

- fatal=0，major=0。
- 三项 `MJR-LC-01..03` 全部关闭。
- `productPx5LifecycleProductionCodeAllowed=true`，但只开放 PX5-01，不代表生命周期已实现。
- 四个交易锁保持 false，交易写入为 0。
