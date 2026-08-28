# V2-PX PX3 入场与验收审计

日期：2026-08-28
当前结论：BLOCKED_SPEC_REENTRY_REQUIRED

## 实施前审计

| 检查 | 结论 |
| --- | --- |
| PX1 target 与 Chrome 重签 | PASS；`0e34a1f.../PX1` |
| PX2 API/policy/真实数据 | PASS；`246e09a.../PX2` |
| DTO/重试/状态/五视图是否唯一 | PASS；均由 PRD、目标架构和运行时合同冻结 |
| 未决高风险选择 | 0；不扩大 permission/intent/数据权威/交易能力 |

## 出门门槛

| 场景 | 操作 | 硬门槛 |
| --- | --- | --- |
| Client envelope | 注入正常、字段缺失、网络、400、500、503 | 正常精确解析；malformed fail；GET 仅网络/503 最多 2 次；POST=1 |
| 五视图 | 依次打开真实 library/detail/ask/trace/graph | 5/5 含真实 read model；首屏有摘要/依据/数据时间/下一步；证据默认折叠 |
| at-most-once | prepared/dispatched/completed 及三类写失败 | 副作用前请求=0；结果后 unknown_result；同 key 重放请求总数=1 |
| 六状态 | 未连接/加载/空/失败/恢复/阻断 | 6/6 有发生事实、保留内容和下一步；伪 success=0 |
| 同源 | 对一个 Operation artifact 和一个 Review evidence 对比 DB/service/API/DOM | ID/ref/asOf/status 一致，DOM 无人工假数据 |
| Chrome | 768/1280 真实 unpacked extension | 两视口五视图可用、无根溢出、console error=0、截图/hash/trace 可复核 |
| 交易/隐私 | 检查 network/storage/DOM | POST Ask=1；confirmation/order/broker=0；四锁=false；storage 无 question/answer/secret |

出现 fatal/major、只能 mock 通过、POST 重试或同源不一致时立即返回计划阶段。

## 2026-08-28 实施后独立复核

### 已通过

- `npm run typecheck`：PASS。
- `npm test`：8 个测试文件、40/40 PASS。
- `npm run test:workspace`：6/6 PASS。
- `npm run build`：PASS；正式 manifest 仍为 `host_permissions=[]`，4000 两个 origin 仅在 `optional_host_permissions`。
- 来源库缺失“下一步”已由测试真实打回并修复；无路由状态的 Workspace 不再显示伪就绪。

### 真实 Chrome 阻断事实

1. Chrome for Testing 152 `--headless=new` 中，真实点击“连接本地 FAMS”后 `chrome.permissions.request` 返回 `false`；这是浏览器不支持在 headless 中确认可选 host permission，不得记录为产品授权通过。
2. 为继续隔离验证业务链路，验收器只在私有证据目录复制构建并预授予 4000；正式构建未被改写。
3. 预授权副本的 Background 真实读取 `/health` 为 200，但服务端观测 `request.headers.origin=null`；随后受保护 `/api/v1/external-brain/sources` 为 403 `PX_ORIGIN_BLOCKED`。
4. 结论：当前 API 合同要求“扩展请求必须携带 allowlist Origin”，但真实 MV3 Background GET 不携带 Origin。PX2 的 Fastify inject 通过不能证明真实 Chrome 可调用，因此 PX3 不得出门，PX4+ 不得自动推进。
5. 本轮没有执行 Ask POST，没有订单/broker 请求，没有业务表写入；不存在把失败伪装为通过的证据。

原始自动化诊断口径见 `REAL_CHROME_FAILURE_EVIDENCE.json`；失败运行仅存在于 git-ignored 私有目录 `.verification/private/v2-px/40a36a0.../PX3-dev`，不得作为 PASS 证据引用。

## 需要批准的合同重入方向

推荐最小方案 A：Background 对 External Brain API 增加固定 `X-FAMS-Extension-Id`，服务端在 `Origin` 缺失时仅接受“该头严格匹配 `FAMS_V2_PX_EXTENSION_IDS` 且请求没有任何 Web Origin”的调用；只要存在非扩展 Web Origin仍一律拒绝。该方案解决浏览器网页跨站调用边界，但不能阻止本机进程伪造请求头，因此文档必须明确它不是本机身份认证。

备选方案 B：增加一次性本机配对，并把短期 pairing token 仅保存在 `chrome.storage.session`；安全性更强，但会修改“扩展不保存 secret”的既有合同，且实现/验收范围明显扩大。

未获人类批准前，不修改生产 API 认证合同，不宣称五视图真实 E2E 通过。
