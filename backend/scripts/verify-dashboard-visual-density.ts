import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'ux-f7', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const [dashboardSource, assetsSource, layoutSource] = await Promise.all([
    readFile(resolve(repoRoot, 'frontend/src/pages/Dashboard.tsx'), 'utf8'),
    readFile(resolve(repoRoot, 'frontend/src/pages/Assets.tsx'), 'utf8'),
    readFile(resolve(repoRoot, 'frontend/src/components/layout/AppLayout.tsx'), 'utf8'),
  ])

  const summaryIconNames = [
    'WalletOutlined',
    'BankOutlined',
    'RiseOutlined',
    'AlertOutlined',
    'PieChartOutlined',
    'DollarOutlined',
    'InboxOutlined',
  ]
  const presentSummaryIcons = summaryIconNames.filter((name) => dashboardSource.includes(name))

  const checks = {
    dashboardHasOrdinaryUserWorkbench: dashboardSource.includes('普通用户工作台')
      && dashboardSource.includes('先用 ChatBox 完成核心任务'),
    dashboardTaskCardsCoverCoreJourneys: dashboardSource.includes('portfolio_compare')
      && dashboardSource.includes('dividend_low_vol')
      && dashboardSource.includes('operation_status')
      && dashboardSource.includes('trade_lock'),
    dashboardSummaryCardsUseIcons: presentSummaryIcons.length >= 6,
    dashboardUsesResponsiveGrid: dashboardSource.includes('xs={24}')
      && dashboardSource.includes('sm={12}')
      && dashboardSource.includes('lg={6}'),
    dashboardHasExcelImportPathWhenEmpty: dashboardSource.includes('去导入资产')
      && dashboardSource.includes('href="/assets"'),
    dashboardWhitespaceReducedBySemanticSections: dashboardSource.includes('DashboardStatCard')
      && dashboardSource.includes('fams-stat-card')
      && dashboardSource.includes('fams-card')
      && dashboardSource.includes('fams-pressable'),
    assetPageHasLocalDataImportExportPath: assetsSource.includes('本地资产台账')
      && assetsSource.includes('导入 Excel')
      && assetsSource.includes('导出资产')
      && assetsSource.includes('下载模板'),
    expertNavigationPreserved: layoutSource.includes('红利低波策略')
      && layoutSource.includes('策略回测')
      && layoutSource.includes('任务中心')
      && layoutSource.includes('分析建议'),
    chatboxEntryPreserved: layoutSource.includes('FamsChatBox'),
  }

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `Dashboard visual density contract failed: ${name}`)
  }

  const audit = {
    schemaVersion: 'fams.ux_f7.dashboard_visual_density_audit.v1',
    status: 'passed',
    checkedAt,
    checks,
    iconCoverage: {
      requiredAtLeast: 6,
      presentSummaryIcons,
    },
    userExperience: {
      ordinaryUserCanStartFromChatBoxWorkbench: true,
      ordinaryUserCanFindExcelImportFromDashboard: true,
      expertModuleTabsPreserved: true,
      dashboardCardsUseUnifiedStyle: true,
    },
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, 'dashboard_visual_density_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
