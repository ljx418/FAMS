# UX-F7 实际开发子阶段计划与验收标准

更新时间：2026-07-07

## 阶段边界

本阶段只实现前端体验优化、资产 Excel 导入导出闭环、总览页视觉密度和审计证据。不得释放正式交易能力。

必须保持：

- `formalTradingUnlocked=false`
- `autoTradeUnlocked=false`
- `canCreateOrder=false`
- `orderCreateAllowed=false`
- `prohibitedActions` 包含 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`

## 子阶段

### UX-F7-1 视觉系统基础

开发内容：

- 建立 light-first 设计 token。
- 统一卡片、按钮、统计卡、图标壳、空状态、按压反馈。
- 总览页和资产页优先切换到统一设计语言。

验收标准：

- 页面主背景、卡片、表格、按钮不再依赖碎片化深色块。
- 卡片具备 hover / active / focus-visible 的力感反馈。
- 主要页面没有文字溢出和按钮挤压。

### UX-F7-2 总览页视觉密度与图标

开发内容：

- 总览页统计卡增加语义图标。
- 缩小无意义空白，保留可读留白。
- 无持仓时给出清晰的 Excel 导入入口。

验收标准：

- 总览页可在 1440px、768px、390px 下完成阅读。
- 用户能从总览页进入资产导入路径。
- 专家模块入口不被删除。

### UX-F7-3 资产 Excel 导入导出闭环

开发内容：

- 保留模板下载、解析预览、确认导入。
- 新增资产与交易记录 Excel 导出。
- 空资产状态引导用户下载模板或导入 Excel。

验收标准：

- 后端提供 `/api/v1/assets/export?userId=default`。
- 导出 workbook 包含 `current_positions`、`trade_records`、`field_guide`。
- 前端资产页有导入、模板、导出三个明确入口。

### UX-F7-4 审计与合同测试

开发内容：

- 新增 `test:ux-f7-visual-system`。
- 新增 `test:asset-excel-flow`。
- 新增 `test:dashboard-visual-density`。
- 继续执行交易边界文案审计。

验收标准：

- 审计 JSON 明确记录视觉系统、Excel 闭环、总览视觉密度。
- 测试不得把研究/草案误写成正式交易。
- 如果验收不通过，打回开发。

## 验收命令

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:ux-f7-visual-system
npm run test:asset-excel-flow
npm run test:dashboard-visual-density
npm run test:frontend-ux-consistency
npm run test:chatbox-trade-boundary-wording
npm run test:trade-action-readiness

cd frontend
npm run build
```

## 出门结论口径

可以声明：

- `frontendVisualSystemReady=true`
- `assetExcelImportExportReady=true`
- `dashboardVisualDensityImproved=true`
- `expertModuleTabsPreserved=true`

不能声明：

- `formalTradingUnlocked=true`
- `autoTradeUnlocked=true`
- `canCreateOrder=true`
- `orderCreateAllowed=true`
