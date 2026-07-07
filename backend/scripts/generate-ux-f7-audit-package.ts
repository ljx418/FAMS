import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

async function findLatestFile(root: string, filename: string) {
  if (!existsSync(root)) return null
  const entries = await readdir(root, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'latest')
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const directory of directories) {
    const candidate = resolve(root, directory, filename)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function readJsonIfExists(path: string | null) {
  if (!path) return null
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const generatedAt = new Date().toISOString()
  const uxRoot = resolve(process.cwd(), 'data', 'gpt-audit', 'ux-f7')
  const chatboxRoot = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore')
  const latestDir = resolve(uxRoot, 'latest')
  await mkdir(latestDir, { recursive: true })

  const sourceFiles = {
    frontendVisualSystem: await findLatestFile(uxRoot, 'frontend_visual_system_audit.json'),
    assetExcelFlow: await findLatestFile(uxRoot, 'asset_excel_flow_audit.json'),
    dashboardVisualDensity: await findLatestFile(uxRoot, 'dashboard_visual_density_audit.json'),
    frontendRuntimeVisualAcceptance: await findLatestFile(uxRoot, 'frontend_runtime_visual_acceptance.json'),
    tradeBoundaryWording: await findLatestFile(chatboxRoot, 'trade_boundary_wording_audit.json'),
  }

  for (const sourcePath of Object.values(sourceFiles)) {
    if (sourcePath) {
      await copyFile(sourcePath, resolve(latestDir, basename(sourcePath)))
    }
  }

  const [frontendVisualSystem, assetExcelFlow, dashboardVisualDensity, frontendRuntimeVisualAcceptance, tradeBoundaryWording] = await Promise.all([
    readJsonIfExists(sourceFiles.frontendVisualSystem),
    readJsonIfExists(sourceFiles.assetExcelFlow),
    readJsonIfExists(sourceFiles.dashboardVisualDensity),
    readJsonIfExists(sourceFiles.frontendRuntimeVisualAcceptance),
    readJsonIfExists(sourceFiles.tradeBoundaryWording),
  ])

  const allPassed = [frontendVisualSystem, assetExcelFlow, dashboardVisualDensity, frontendRuntimeVisualAcceptance, tradeBoundaryWording]
    .every((audit) => audit?.status === 'passed')

  const developmentTracker = {
    schemaVersion: 'fams.ux_f7.development_tracker.v1',
    generatedAt,
    status: allPassed ? 'passed' : 'blocked',
    completedItems: {
      lightFirstVisualSystem: frontendVisualSystem?.status === 'passed',
      cardPressFeedback: frontendVisualSystem?.checks?.unifiedCardAndPressableClassesDefined === true,
      dashboardSemanticIconsAndDensity: dashboardVisualDensity?.status === 'passed',
      assetExcelImportExport: assetExcelFlow?.status === 'passed',
      visualScreenshotEvidence: frontendRuntimeVisualAcceptance?.status === 'passed',
      expertModuleTabsPreserved: frontendVisualSystem?.expertModuleTabsPreserved === true
        && dashboardVisualDensity?.userExperience?.expertModuleTabsPreserved === true,
      tradeBoundaryPreserved: tradeBoundaryWording?.status === 'passed',
    },
    knownLimits: [
      '当前 default 用户本地资产数据库为空；Excel 导出已在真实数据库空台账上验证，导入真实持仓仍需用户提供 Excel 后复验。',
      '本阶段不声明正式交易 release，只改善 UX、资产导入导出和审计可见性。',
    ],
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  await writeFile(resolve(latestDir, 'development_tracker.json'), `${JSON.stringify(developmentTracker, null, 2)}\n`, 'utf8')

  const summary = `# UX-F7 前端体验与资产 Excel 闭环审计摘要

生成时间：${generatedAt}

## 结论

- 本阶段状态：${allPassed ? '通过自动化合同验收' : '未通过，需回到开发阶段'}
- Light-first 视觉系统：${frontendVisualSystem?.status || 'missing'}
- 资产 Excel 导入/导出闭环：${assetExcelFlow?.status || 'missing'}
- 总览视觉密度与图标：${dashboardVisualDensity?.status || 'missing'}
- 1440/768/390 截图验收：${frontendRuntimeVisualAcceptance?.status || 'missing'}
- 交易边界文案：${tradeBoundaryWording?.status || 'missing'}

## 已完成

- 总览页和资产页切换为统一 light-first 设计 token。
- 卡片增加 hover / active / focus-visible 反馈。
- 总览页增加语义图标、普通用户工作台、空资产导入入口。
- 资产管理页保留模板下载、解析预览、确认导入，并新增 Excel 导出。
- 后端新增 /api/v1/assets/export，导出 current_positions / trade_records / field_guide。
- 左侧专家模块入口保留，包括红利低波策略、策略回测、任务中心、分析建议。
- Headless Chromium 已生成 Dashboard 与资产页在 1440px、768px、390px 的截图证据。

## 重要边界

- 资产页“记账”仅保存本地流水，不创建外部订单。
- 本阶段仍不是正式交易 release。
- formalTradingUnlocked=false
- autoTradeUnlocked=false
- canCreateOrder=false
- orderCreateAllowed=false
- prohibitedActions=ADD / REDUCE / ORDER_CREATE / AUTO_TRADE

## 数据真实性说明

- Excel 导出测试实际读取当前 SQLite 数据库的 default 用户持仓与交易记录。
- 当前 default 用户持仓数：${assetExcelFlow?.exportSummary?.positionsCount ?? 'unknown'}
- 当前 default 用户交易记录数：${assetExcelFlow?.exportSummary?.transactionsCount ?? 'unknown'}
- 如果用户导入真实 Excel，需重新运行 test:asset-excel-flow 与前端 E2E 截图验收。

## 可视化验收报告

- HTML 报告：backend/data/gpt-audit/ux-f7/latest/acceptance-report.html
- 截图目录：backend/data/gpt-audit/ux-f7/latest/screenshots/
`

  await writeFile(resolve(latestDir, 'SUMMARY_FOR_GPT.md'), summary, 'utf8')
  console.log(JSON.stringify({
    ok: allPassed,
    latestDir,
    sourceFiles,
    developmentTracker,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
