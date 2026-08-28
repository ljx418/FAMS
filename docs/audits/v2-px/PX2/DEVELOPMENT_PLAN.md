# V2-PX PX2 详细开发计划

日期：2026-08-28
状态：APPROVED_FOR_IMPLEMENTATION

## PRD 切片与目标体验

PX2 覆盖 PX-REQ-003/005/007/011/013/016/017/018/019，并继续验证 008/012/015/020。用户在 Workspace 的来源库、来源详情、快速问答、任务追踪和关系图谱五个视图中读取真实 FAMS 对象；首屏先给简明结论、数据时间和下一步，原始证据折叠展示。

## 实现顺序

1. 新增 External Brain DTO、Policy、Read、Ask 和 Fastify route；固定本地默认用户并拒绝 `userId` 注入。
2. 先实现 External Brain route 的 deny-by-default origin pre-handler，验证允许/错误/缺失 extension allowlist 与 Host 3000 负例，再收紧全局 CORS。
3. Sources/Detail 只读映射真实 Operation artifact、Daily Review evidence；Trace 映射真实 Operation task；Graph 由 Daily Review workflow 或 Operation task 派生，不建第二业务库。
4. Ask 只委托现有 `famsChatService.sendMessage`；只允许 `read_only_direct/compute_quick_run`，禁止自动 confirmation、订单或永久阻断动作。
5. 扩展 Background 新增 FamsApiClient/FamsDomainAdapter；GET 按 250ms/1000ms 有限重试，POST Ask 自动重试为 0。
6. 把 Workspace 空壳替换为五个真实视图、七种用户可见状态、摘要和折叠证据；Background 仍是唯一网络访问者。

## 真实数据

- 使用当前真实 SQLite 中的 286 个 Operation、28 个 Daily Review、现有 artifact/chat audit。
- 同源验收按对象 ID、时间、status、artifactRef 同时比对数据库/原服务、External Brain API 和浏览器 DOM。
- Ask 使用专用 `px-acceptance-*` conversationId 调用真实 FAMS Chat；执行前保留数据库备份，不生成订单。

## 停止条件

- 需要复制投资计算、增加第二数据库、扩大权限或改变五 intent：停止请求用户确认。
- 真实 FAMS 字段不足时只修 facade mapping；无法满足时返回 API 合同/ADR，禁止 mock。
- CORS allowlist 存在旁路或影响现有 FAMS Web 无法安全回退：停在 PX2-01。
