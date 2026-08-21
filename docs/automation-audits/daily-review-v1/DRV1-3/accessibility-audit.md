# DRV1-3 无障碍开发审计

日期：2026-08-20  
目标标准：WCAG 2.2 AA  
结论：`PARTIAL — 自动化与键盘范围通过；不声明完整 WCAG 符合`

## 方法与边界

- 自动检查：Chromium Accessibility Tree、DOM 语义、可访问名称、标题层级、表头、图片文本替代、文档溢出。
- 手工脚本化键盘检查：节点按钮 Enter 激活、备注输入、可见焦点、ChatBox Esc 关闭与焦点返回。
- 重排检查：1440/768/390 视口；长截图文件名在 390px 视口内量测。
- 本地不存在 axe-core、Lighthouse、NVDA、JAWS 或 VoiceOver；未为本阶段临时下载安装依赖，也未执行真实屏幕阅读器。因此不作完整符合性或辅助技术兼容性声明。

## 发现与闭环

| 问题 | WCAG 2.2 | 严重度 | 修复与复测 |
| --- | --- | --- | --- |
| 行情 Select 的 combobox 无可访问名称 | 4.1.2 Name, Role, Value | Serious | 增加“选择行情资产”；历史两个筛选同步加名称；最终未命名交互元素 0 |
| 侧栏菜单没有 navigation landmark | 1.3.1 Info and Relationships | Moderate | 用 `nav aria-label="FAMS 主导航"` 包裹；最终 main=1、nav=1 |
| ChatBox 关闭后未显式归还触发器焦点 | 2.4.3 Focus Order | Serious | 保存 FloatButton ref，Drawer 关闭后 focus；Esc 关闭和焦点返回均通过 |
| 手机长文件名越出截图面板 | 1.4.10 Reflow | Moderate | 文件 Tag 限宽与省略；最终 tag 307px ≤ panel 315px |

## 最终自动化结果

- 可见交互元素：62；无名称：0。
- 标题：单一 h1，功能区为 h2，节点检查器 h3，输入/输出分组 h4。
- 节点键盘激活：PASS；焦点轮廓：3px 可见。
- ChatBox：Esc 关闭 PASS；焦点返回 PASS。
- 可见无 alt 图片：0；表头：24；根页面横向溢出：0。
- 浏览器 console/page errors：0。

运行证据：`.verification/daily-review-v1/DRV1-3/accessibility-runtime-final.json`。

未关闭 Critical/Serious（已测范围）：0。真实屏幕阅读器兼容性保持“未执行”，不得被后续报告改写为 PASS。
