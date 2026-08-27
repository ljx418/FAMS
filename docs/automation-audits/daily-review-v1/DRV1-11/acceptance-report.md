# DRV1-11 端到端验收报告

日期：2026-08-25（Asia/Shanghai）

## 验收对象

- 真实复盘：`ee2e00b7-a490-499c-94f0-5a5c72b4715f`
- 真实行情源：新浪行情；六项持仓各 30 个交易日，区间 2026-07-15 至 2026-08-25
- 页面：`/daily-reviews/ee2e00b7-a490-499c-94f0-5a5c72b4715f`
- 宿主浏览器：Windows Chrome，1348×1038 窗口

## 自动验收结果

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 后端 TypeScript 构建 | PASS | `npm run build` |
| 前端交付构建 | PASS | 3730 modules transformed，Vite build 成功 |
| 前端静态合同 | PASS | `dualGridAndFourFocusAssets=true`；DAG、图表、节点详情合同均为 true |
| 四重点标的 | PASS | 601127、600276、159851、513770 均显示最新价、即时/条件网格状态 |
| 双清单隔离 | PASS | 即时 `proposed` 与条件 `awaiting_parent_fill` 分区、分动作、分复制入口 |
| 收盘安全语义 | PASS | 16:49 运行后两类清单均明确提示 `session_closed`，没有生成过期草案 |
| DAG 统计 | PASS | 十节点均由工作流接口返回；网格节点分别统计即时、条件和两类草案 |
| 旧报告兼容 | PASS | 可选字段均有空安全降级，前端构建与合同验证通过 |
| 真实桌面渲染 | PASS | 宿主 Chrome 完整加载结论、四重点卡片、双网格、十二行完整台账和十节点 DAG |
| Playwright 四视口 | BLOCKED | Chromium 启动前因 WSL 缺 `libnspr4.so` / `libnss3.so` 退出，未进入页面代码 |

## 环境限制判定

四视口自动截图没有伪造为通过。该失败发生在浏览器进程启动阶段；真实宿主 Chrome 已成功加载同一源码和真实报告，静态响应式合同、TypeScript 与生产构建也全部通过。因此本子阶段记为 **PASS_WITH_ENVIRONMENT_LIMITATION**，不把基础设施缺库误报为产品缺陷，也不把未执行的多视口检查写成通过。

## 交易安全核验

验收发生在上海时区 15:00 以后。页面没有把观察档位表达为“现在可下单”，四个重点标的统一给出下一交易时段重跑提示；条件买回没有脱离父卖单成交条件。
