# S1 未读提醒查询合同验收审计

日期：2026-09-11

## 结论

```text
stageId=S1
alertUnreadContract=PASS
backendBuild=PASS
marketWatchRealDataRegression=PASS
marketWatchLatestDataDate=2026-09-11
stopAlertRealAccountRegression=PASS_RESTORED
invalidQueryCasesRejected=5
serviceCallsForInvalidCases=0
privateAccountFieldsPublished=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
exitDecision=PASS_FOR_S2
```

## 验收证据

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run test:alert-unread-contract` | PASS | 默认 10、字符串 30 均以 number 进入 service；非数字、0、101、小数、缺失 userId 均返回 400 |
| `npm run build` | PASS | 后端 TypeScript 编译通过 |
| `npm run test:market-watch` | PASS | 6 条市场规则均完成真实行情计算，最新数据日期为 2026-09-11 |
| `npm run test:stop-alerts` | PASS | 在真实本地持仓上验证收益率止损提醒；测试结束恢复原阈值并清理本轮新增止损提醒 |

## 防虚假验收说明

- 新增合同测试替换 service 方法，只用于确认路由类型转换和无效请求阻断，不冒充数据库 E2E。
- 市场监控与止损回归负责真实数据链路，两类证据共同覆盖接口合同与实际功能。
- 本报告不公开真实账户标的、金额、收益率、提醒 ID 或成交信息。
- 本阶段没有修改提醒计算公式，也没有改变交易边界。
