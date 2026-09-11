# S1 未读提醒查询合同开发及验收计划

日期：2026-09-11

## 问题

`GET /api/v1/alerts/unread` 将 URL 查询参数 `limit` 直接传给 Prisma `take`。Fastify 收到的查询参数默认为字符串，因此 `?limit=30` 存在运行时类型错误风险。

## 开发范围

1. 为未读提醒路由增加 Fastify query schema。
2. `userId` 必填且非空；`limit` 默认为 10，只接受 1 至 100 的整数。
3. 有效数字字符串必须被 Fastify 转换为 number 后再进入 `alertService`。
4. 非数字、小于 1、超过 100 或小数必须返回 HTTP 400，不能触发数据库查询。
5. 增加独立 API 合同测试和 package script。

现有 `test:market-watch` 与 `test:stop-alerts` 作为真实数据回归：前者可能按去重规则创建市场提醒；后者临时修改一条持仓阈值，并必须在 `finally` 中恢复阈值、删除本轮新增止损提醒。公开审计不得记录账户标的和收益细节。

## 验收命令

```bash
cd backend
npm run build
npm run test:alert-unread-contract
npm run test:market-watch
npm run test:stop-alerts
```

## 出门条件

- 默认请求传入 service 的 `limit` 为 number 10。
- `?limit=30` 传入 service 的 `limit` 为 number 30。
- 四类无效输入返回 400，service 调用次数不增加。
- 现有市场监控和止损提醒测试通过。
- 不修改提醒算法、投资规则或交易权限。
