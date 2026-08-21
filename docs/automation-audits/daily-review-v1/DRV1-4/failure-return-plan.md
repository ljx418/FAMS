# DRV1-4 首轮失败回路与续验计划

日期：2026-08-20  
状态：`CLOSED`

## 首轮失败

- 已真实生成且仅生成一轮复盘：`9b7ddf05-9050-4483-b109-11e56a809364`。
- 失败断言：513770 MA30，报告为 `0.3708`，未舍入独立均值为 `0.3708333333…`。
- 根因：验收脚本使用 `1e-6` 比较未舍入均值，但正式 `averageAt` 合同明确 `toFixed(4)`；验收精度与产品合同不一致。
- 分类：验收实现错误，不是行情或 MA 算法错误。

## 闭环

1. 查验 `assetTrendService.averageAt`，确认 MA5/10/30 均保留 4 位小数。
2. 验收标准改为独立求均值后 `toFixed(4)`，再与 indicators 和 chart 末值精确比较。
3. 禁止再次触发复盘。续验模式必须提供已生成 reviewId 和首轮 `pre-run.db`，仅只读当前数据库与备份数据库。
4. 受保护表的“运行前”哈希从 online backup 重新计算，确保进程中断不降低证据强度。

致命/重大规格风险：0 个未关闭。允许对同一 reviewId 执行只读续验。

## 前端 E2E 定位失败

- 首轮浏览器脚本直接点击 Ant Select 内部透明 combobox input，可见的 selection item 正常拦截了该内部节点的 pointer event。
- 分类：自动化定位错误，不是资产选择器功能失败；该轮无业务写入。
- 闭环：改为聚焦具名 combobox 后用 Enter 打开列表，再从真实 option 选择；同时更直接覆盖键盘操作能力。
- 处理：四视口从头重跑，不复用首轮部分成功结果。

复验进一步发现 Select 虚拟列表虽然视觉显示 6 个资产，但 Chromium 可访问树只暴露 2 个内部 option。由于这里只有少量持仓与筛选项，已关闭三个 Select 的虚拟化，使视觉列表与辅助技术选项一一对应；该产品修复完成后再从头验收。

第三次脚本在 localStorage 断言中对“包含 JSON 字符串的 JSON 对象”直接做正则，转义字符导致假失败。改为读取指定 reviewId 的 storage value 后 `JSON.parse`，逐字段断言 `positions.status/note`；页面状态本身已正确保存，无业务副作用。

## 组合运行时路径合同漂移

- `test:fivd-r-portfolio-runtime` 旧断言强制 SQLite 路径匹配 `/mnt/c/workspace/` 小写别名。
- 该别名已被真实 Prisma 连接证明会在当前 DrvFS 环境触发 `unable to open database file`，不能保留为正确合同。
- 修复：断言 resolver 输出等于从脚本 import URL 解析的仓库真实 `backend/prisma/dev.db` 路径，并继续通过 `initializePrisma` 实际连接、写入临时用户和清理来验证可用性。

## 全系统扩展回归失败

- 红利低波审计包在“尚无策略证据”分支漏出 `allowedActions`，汇总模板调用 `join` 时异常。补齐与有证据分支一致的研究动作白名单，不改变任何交易权限。
- 组合回测的 `custom_weight_portfolio` 是 UI 模板占位符，实际会展开为具体自定义策略；默认正式验证候选集却仍冻结占位符，导致缺少版本。改为仅在调用方未显式指定候选集时冻结展开后的具体策略 ID；显式候选集保持不变。
- 3100 端口已由另一工作区的 Vite 占用，旧验收器仅检查 `#root` 后错误复用，导致页面代码与 4000 后端不匹配并产生 404。增加当前工作区 `/@fs/` 模块探针；本轮复验显式使用当前工作区 3000 端口。不会终止或改写另一工作区进程。
- `test:trade-action-readiness` 因缺少真实 strategy evidence 继续失败属于既定正式交易门禁，不以修改测试或放宽权限伪造通过。
- 全系统复验首次从仓库根目录调用 npm，但根目录没有 `package.json`，npm 在任何测试或业务写入前以 ENOENT 退出；改从 `backend/` 包按正式脚本入口重跑。
- 使用正确工作区后 24 张截图与全部 API 通过，但浏览器捕获到 Ant Design 静态 message 无法消费主题上下文的警告。将红利低波页和组合回测页迁移到已存在的 `AntApp.useApp()` 上下文消息实例后重验。
- 报告原先把“严格交易 readiness 命令拒绝”直接视为产品失败，造成“正式交易和自动交易禁止”也被反向标红。验收归一化现要求严格命令非零退出，并同时验证 `strictTrade=true`、三项交易锁为 false 且存在 blocker；原始命令结果仍保留 failed 以保持事实，不改变正式交易状态。
