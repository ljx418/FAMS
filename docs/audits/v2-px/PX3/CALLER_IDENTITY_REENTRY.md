# V2-PX PX3 调用方识别合同重入

日期：2026-08-28  
批准：用户已明确批准方案 A  
结论：DOCUMENT_REENTRY_PASS_IMPLEMENTATION_ALLOWED

## 触发事实

Chrome for Testing 152 的真实 MV3 Background GET 到 4000 时，服务端观测 `Origin=null`。旧合同只接受 allowlist extension Origin，导致真实 `/sources` 返回 403；Fastify inject 的 Origin 正例不能继续代表真实浏览器。

## 冻结方案 A

1. `FamsApiClient` 从 Background 注入 `browser.runtime.id`，每个 External Brain API 请求发送 `X-FAMS-Extension-Id`；值严格为 32 位 `[a-p]`，它不是 secret。
2. 后端继续读取 `FAMS_V2_PX_EXTENSION_IDS`。未配置或仅包含非法 ID时返回 503。
3. `Origin` 缺失：只有 header ID 位于 allowlist 才允许。
4. `Origin` 存在：必须为 `chrome-extension://<同一 header ID>`；任何 `http://localhost:3000`、`http://127.0.0.1:3000` 或其他 Web Origin 均拒绝，即使伪造正确 header。
5. 缺失/畸形/未配置 header 返回 `PX_EXTENSION_CALLER_BLOCKED`；Web Origin 或 Origin/header 不一致返回 `PX_ORIGIN_BLOCKED`。
6. CORS 仍负责浏览器响应头，route pre-handler 才是 facade 的 deny-by-default 业务门槛。caller header 不能认证本机进程，不扩大为远程/生产身份能力。

## 开发及验收顺序

1. Policy 先实现纯判定并增加两正例、八负例；所有业务 handler 保持不可达。
2. Route pre-handler 接入判定与精确错误 envelope。
3. Extension client 所有 GET/POST 加 header；生产 manifest 仍保持安装时 host permission 为空。
4. 运行 backend policy/API 真实数据回归，确认业务表无写入、四锁 false。
5. 运行扩展类型/40 项测试/构建；再运行真实 headless Chrome。自动化允许在私有副本预授予 host permission，但必须把正式用户点击授权保留为人类门槛。
6. 对 Operation artifact 与 Review evidence 做 DB/API/DOM 同源，五视图 768/1280、Ask POST=1、console error=0、storage 无问题/回答、broker/order=0。

## 入场审计

| 风险 | 结论 |
| --- | --- |
| 缺 Origin 被任意放行 | CLOSED；必须同时有合法 allowlist header |
| 网页伪造 header | CLOSED；任何 Web Origin硬拒绝 |
| extension Origin 与 header 冲突 | CLOSED；必须同 ID |
| 把公开 ID冒充认证 secret | CLOSED；PRD/架构/图显式声明不是本机身份认证 |
| 扩大 host permission | CLOSED；manifest 不变 |
| 交易能力漂移 | CLOSED；四锁、零订单保持 |

新增 fatal/major=0；允许进入方案 A 最小代码实现。任何负例放行或真实 Chrome 仍为 403，立即保持 PX3 blocked。
