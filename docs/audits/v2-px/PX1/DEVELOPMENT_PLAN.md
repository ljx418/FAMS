# V2-PX PX1 详细开发计划

日期：2026-08-28
状态：APPROVED_FOR_IMPLEMENTATION

## PRD 切片与目标体验

PX1 覆盖 PX-REQ-001/002/003/006/008/009/010/012/014/015/018/020 的技术基座。用户必须能在真实 Chrome 中识别 Side Panel、Workspace 和 Host 入口，主动连接本地 FAMS，并确认重复打开不会制造重复工作台；本阶段不宣称完整五视图业务体验。

## 实现顺序

1. 创建独立 `packages/fams-v2-px-extension` WXT/MV3 包，锁定 WXT 0.21.4、React 18、Playwright 1.62.1，提供 background、sidepanel、workspace 三 entrypoint。
2. 保留 PX0 schema 作为历史回归基线，新增 intent-route/3、operation-command/2、lifecycle/3、real-chrome-evidence/2 的 schema、TypeScript 类型、运行时校验和八个冻结 fixture。
3. Manifest 安装权限为空；optional host 只列 4000；3000 只属于 `externally_connectable`；CSP 只允许 self。
4. Background 实现健康连接、受控授权、canonical workspace URL 和多窗口单标签复用；容器不直接访问后端。
5. 建立 lifecycle event store 和最小 recovery/ledger 存储接口，为 PX4/PX5 的完整实现保留同一状态合同。
6. 实现 Playwright + Chrome CDP collector，优先 `--headless=new` 加载真实 unpacked extension，采集真实 URL、ID、版本、build digest、console/network/trace 和 360/420/768/1280 四视口。

## 接口不变量

- Host `view_source` 合法目标是 Workspace；Side Panel 入口 `view_source` 仍落 Side Panel。
- intent `ask` 只允许 `workspaceId/conversationId?`，严格拒绝 `question`。
- lifecycle eventType 只允许运行时合同冻结的 15 个值；实现状态不能冒充 eventType。
- POST dispatch 的 prepared 写入失败必须 0 请求；结果后 completed 写入失败只能进入 `unknown_result`，不得重试。
- 交易四锁恒 false，broker order 请求数恒 0。

## 回退与停止

- schema/type/fixture/validator 不能原子对齐：停在 PX1-02 并返回合同计划。
- Headless Chrome 无法承载扩展：记录平台事实后改用隔离的自动化 headed Chrome；静态 HTML 不得替代。
- 需要扩大权限、改变 intent 或修改交易锁：立即停止并请求用户确认。
