# V2-PX PX5-01 恢复与迁移验收计划

日期：2026-08-31

## 1. 自动验收标准

| 场景 | 操作 | 门槛 |
| --- | --- | --- |
| 生命周期合同 | 首包非 subscribe、Host、路径冒充、secret、未知字段 | 100% disconnect；storage/API/tab 副作用=0 |
| 导航恢复 | 真实来源库→详情→trace/graph→Back→Forward→Refresh | view/ref 与真实 FAMS 对象一致；5 秒内状态结论 |
| 关闭重开 | 关闭 Workspace 后从 Side Panel 重开 | workspace tab=1；同 workspace/view/ref |
| Chrome 重启 | 同 profile 关闭并重启 Chrome | session 缺失；local RecoveryIndex/2 恢复并重取真实 FAMS 数据 |
| 版本迁移 | seed 合法 v1、未知 `/99` | v1→v2 + `state_migrated`；/99 原始 JSON 字节等值且 blocked |
| TTL/LRU | seed 过期与 21 条记录 | 过期删除；保留最新 20；ledger 独立清理 |
| 安全 | 扫描 storage/network/SQLite | question/answer/secret=0；订单请求/交易表差分=0；四锁 false |

## 2. 证据

使用 Google 官方 Chrome for Testing（当前执行环境为 Linux）`--headless=new` + CDP、真实 unpacked extension、真实 SQLite backup 和真实 4000 API。验收服务仅绑定 `[::1]:4000`，Chrome 在本次 profile 内将 `localhost` 映射到 `::1`，不停止或替换已运行的 IPv4 项目服务。截图、trace、network、storage、事件和 hash 写入 `.verification/private/v2-px/<commit>/PX5-01/`。

## 3. 失败回退

普通失败回到本计划修复重跑；若需要新权限、Router 主链重写、heartbeat 或业务后端变更，停止并请求人类确认。
