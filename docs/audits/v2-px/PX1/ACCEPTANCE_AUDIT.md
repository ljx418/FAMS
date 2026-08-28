# V2-PX PX1 入场与验收审计

日期：2026-08-28
当前结论：ENTRY_PASS_IMPLEMENTATION_PENDING

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

## 实施后结果

尚未执行。代码、命令、真实 Chrome 证据和 PRD 复核将在本文件后续章节追加，未追加前不得声明 PX1 通过。
