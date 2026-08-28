# V2-PX PX2 入场与验收审计

日期：2026-08-28
当前结论：STOPPED_SPEC_REENTRY_REQUIRED

> 重入更新：PX1 已由 `fe3faaf...` 重签，以下 R2 标准在实质开发前重新审查；旧的 `STOPPED_SPEC_REENTRY_REQUIRED` 作为历史停止记录保留，不能覆盖本节的新结论。

## R2 重入后的实施前计划与审计

当前 R2 入场结论：`ENTRY_PASS_IMPLEMENTATION_ALLOWED`。

| 子项 | 开发计划 | 验收门槛 |
| --- | --- | --- |
| Envelope | 五端点统一 `fams.external-brain.response.v1` | requestId/status/data/evidenceRefs/warnings/researchOnly+四锁逐字段精确；error 含同 requestId |
| 来源映射 | Operation.artifactRefsJson 与 Review report evidenceRefs 逐条映射 | kind 仅两值；sourceRef 可反解且必须属于父实体；无 Operation/Review 聚合项冒充来源 |
| 分页/新鲜度 | snapshotAt+lastAsOf+lastSourceRef keyset | 插入/刷新不造成跨页重复；24h 边界和 trust 映射可测试 |
| Ask | 严格五必填字段、无 additional/userId | contextRefs 合法；POST=1；35 秒内完成或诚实终态；不调用 confirmation/order |
| Policy/CORS | 缺 permission fail closed；confirm blocked；permanent hard fail；四 Origin | standalone policy 先通过，再做 API；数据库故障=503，只有明确 not-found=404 |
| 真实数据 | 原 DB、service、API 同 ID/ref/time/status | 真实 Operation/Review 均存在；读/Ask 前后 Operation/Review/Transaction 不变；broker/order=0 |

重入前规格检查：PX1 证据有效；字段、错误、来源、分页、策略和停止条件均有唯一口径。fatal=0、major=0，允许开始 R2。

> 2026-08-28 实施中发现真实 FAMS UUID/opaque sourceRef 与 PX1 target schema 共用 ID 正则冲突。详见 `SPEC_REENTRY_AUDIT.md`。PX2 未通过，禁止把首轮 API build/真实读取结果作为出门结论。

## 入场三轮审计

1. 架构审计：Facade 是现有 FAMS 业务服务的下游防腐层，业务事实仍归 Prisma/Chat/Review/Operation；PASS。
2. 规格审计：五端点 DTO、默认用户、分页、错误 envelope、1/35 秒 Ask、GET/POST 重试、七种 UI 状态均已冻结；PASS。
3. 反假绿审计：要求数据库/原服务/API/DOM 同源，拒绝 userId/raw error/mock read model/自动确认/订单调用；PASS。

共享工作区中的隔夜策略改动属于另一有界模块。PX2 只在 `src/index.ts` 增加独立 route 注册、在 `package.json` 增加独立测试命令，不覆盖其路由、Prisma 实体或测试；当前不存在不可安全合并的重叠代码块。

致命问题：0。重大问题：0。允许开始 PX2 代码开发。

## 出门验收标准

| 场景 | 操作 | 硬门槛 |
| --- | --- | --- |
| Policy/CORS | 对五端点发送允许、错误、缺失和 3000 Origin | 仅配置的 extension origin 可进入；Web 现有 API 仍可用；切换有证据 |
| 来源库/详情 | 读取真实 Operation/Review 来源并打开详情 | API 字段与数据库/原服务同 ID、时间、status、artifactRef；无正文复制 |
| Ask | 从 Workspace 提交真实问题 | ack≤1s；最终≤35s 或明确终态；真实 Chat conversation/message 可复核；POST 请求=1 |
| Trace/Graph | 打开真实 Operation、Review workflow | 节点/任务/证据均由现有对象派生；不存在第二图数据库 |
| 五视图 UI | 在 768/1280 依次操作五 intent | 5/5 真实 read model；正常/空/失败/断连/恢复/阻断均有下一步 |
| 信息与无障碍 | 键盘遍历、对比度、点击区、证据折叠 | 首屏包含结论/依据/数据时间/下一步；44px、focus-visible、无根级溢出 |
| 交易边界 | 扫描 API、DOM、网络 | 四锁=false；confirmation/order/broker 请求=0；无误导交易动作 |

## 实施后结果

尚未执行。未追加真实 API/Chrome 证据和 PRD 复核前不得声明 PX2 通过。
