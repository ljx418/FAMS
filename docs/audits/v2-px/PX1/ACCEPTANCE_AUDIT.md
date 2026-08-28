# V2-PX PX1 入场与验收审计

日期：2026-08-28
当前结论：PASS_PX2_ENTRY_ALLOWED

## 入场三轮审计

1. 架构审计：目标实体、依赖方向、业务数据所有权和最小权限均能映射到 PRD/目标架构；PASS。
2. 规格审计：目标 schema 版本、三入口三动作、十五类 eventType、四视口和失败分流均无待开发者自决项；PASS。
3. 反假绿审计：禁止 mock URL、缺文件/hash、少视口、重复视口、尺寸不符、Ask 注入 question、未知 eventType 和伪 success；PASS。

致命问题：0。重大问题：0。允许开始 PX1 代码开发。

## 出门验收标准

| 场景 | 操作 | 硬门槛 | 证据 |
| --- | --- | --- | --- |
| 构建与加载 | 构建并在真实 Chrome 加载 unpacked extension | 三 entrypoint 可识别；manifest/CSP/权限精确匹配 | manifest、build digest、extension target |
| 合同迁移 | 运行目标正负 fixtures | 目标正例全过；所有负例必须失败；PX0 回归继续过 | contract audit JSON |
| 三入口三动作 | 顺序触发 3×3 路由 | 合法矩阵 9/9；Host view_source→Workspace；非法组合拒绝 | route trace、页面 URL |
| 权限连接 | 未授权→点击授权→健康检查 | 安装默认 host=0；仅授权 4000；3000 不进入 host permission | permission/network audit |
| 标签复用 | 连续打开 Workspace 20 次并跨窗口重复 | 匹配 tab 总数始终为 1，聚焦既有窗口 | tab trace |
| 四视口 | 捕获 360/420/768/1280 | 恰好四个唯一视口；实际像素与声明一致；根级横向溢出为 0 | PNG、尺寸/hash audit |
| 恢复诚实性 | 模拟断连、storage 前后写失败 | 5 秒内显示明确状态；前写失败 0 请求；后写失败 unknown_result 且重试 0 | lifecycle/network trace |
| 隐私交易边界 | 扫描证据与网络 | secret/cookie/token/账户原图=0；broker order=0；四锁=false | redaction/trade audit |

## 阶段 PRD 出门规则

- PX1 只能把技术基座相关条目标记为“阶段实现”，不能把完整 Side Panel、Workspace 五视图或最终体验标记完成。
- 真实 Chrome 证据缺失、只有 shell/root 节点、截图不可复核或 manifest 自报均为 FAIL。
- 任一失败自动回到本阶段计划；出现权限、交易、真实数据或架构偏移则停止请求用户确认。

## 实施后自动验收结果

| 项目 | 结果 |
| --- | --- |
| WXT 0.21.4 MV3 构建 | PASS；background/sidepanel/workspace 三 entrypoint 均进入真实 build |
| 目标合同与八个 fixture | PASS；4 个正例通过、4 个负例按预期失败；PX0 回归继续通过 |
| 扩展单元/合同测试 | PASS；5 个测试文件、18 个断言场景 |
| 3×3 路由与 20 次标签复用 | PASS；Host view_source→Workspace，重复打开 tab=1 |
| at-most-once 故障分流 | PASS；prepared 写失败请求=0；结果后写失败 unknown_result；同 key 重放请求=1 |
| 真实 Chrome | PASS；Chrome for Testing 152.0.7977.64、真实 extension ID、实际 Side Panel target |
| 四视口与视觉复核 | PASS；360/420 Side Panel、768/1280 Workspace，PNG 实际像素一致，根级横向溢出=0 |
| 隐私与交易边界 | PASS；console error=0、secret/cookie/token/账户原图=0、broker order=0、四锁=false |

真实证据：`.verification/private/v2-px/74ef3c82fc9896575db4c065060fd6575232c116/PX1/`。

普通 Google Chrome 151 因 Chrome 137 起移除品牌版 `--load-extension` 而未加载 unpacked extension；验收没有降级为静态网页，改用 Chrome 官方提供的 Chrome for Testing 152，在 `--headless=new` 下完成真实扩展与 Side Panel 验证。

## PRD 阶段规格检视

- PX-REQ-006、010、015 的 PX1 技术门槛已实现并有真实证据。
- PX-REQ-001/002/003/008/009/012/014/018/020 已实现合同或基础实体，但仍需后续阶段完整集成，不提前标记全需求完成。
- PX-REQ-004/005/007/011/013/016/017/019 的完整业务/UI 门槛仍属于 PX2～PX6。
- Side Panel 和 Workspace 截图清晰、可读、无假数据；页面明确说明 PX2 才接入真实 read model，因此不存在把空壳冒充完整业务的风险。

致命问题：0。重大规格偏差：0。新增假绿风险：0。PX1 出门，允许进入 PX2。
