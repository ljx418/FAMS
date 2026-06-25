import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')

async function main() {
  const files = {
    layout: resolve(repoRoot, 'frontend/src/components/layout/AppLayout.tsx'),
    analysis: resolve(repoRoot, 'frontend/src/pages/Analysis.tsx'),
    operations: resolve(repoRoot, 'frontend/src/pages/Operations.tsx'),
    backtest: resolve(repoRoot, 'frontend/src/pages/Backtest.tsx'),
    dividendLowVol: resolve(repoRoot, 'frontend/src/pages/DividendLowVol.tsx'),
  }
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
  )) as Record<keyof typeof files, string>

  const touchedSources = Object.values(sources).join('\n')
  const checks = {
    layoutHasMobileDrawerNavigation: sources.layout.includes('Drawer')
      && sources.layout.includes('MenuOutlined')
      && sources.layout.includes('打开导航菜单')
      && sources.layout.includes('currentLabel'),
    analysisSectionSwitcherVisibleAcrossBreakpoints: sources.analysis.includes('分区视图')
      && sources.analysis.includes('lg:flex-row')
      && !sources.analysis.includes('hidden lg:flex items-center justify-between gap-4 rounded-2xl border border-[rgba(37,99,235,0.28)]'),
    operationsActionBarGroupsMaintenanceTasks: sources.operations.includes('maintenanceMenuItems')
      && sources.operations.includes('更多维护任务')
      && sources.operations.includes('Dropdown'),
    backtestShowsDataCutoffAndRecommendedStrategies: sources.backtest.includes('数据可用截止日')
      && sources.backtest.includes('RECOMMENDED_PORTFOLIO_STRATEGY_IDS')
      && sources.backtest.includes('推荐 3 组'),
    dividendLowVolShowsLockedTop3Workflow: sources.dividendLowVol.includes('activeTop3Selection')
      && sources.dividendLowVol.includes('本次工作台输入')
      && sources.dividendLowVol.includes('本次区间/滚动回测输入标的'),
    touchedFilesUseValidSurfaceBorderToken: !touchedSources.includes('border-[surface-border]'),
    touchedFilesUseValidSemanticTextTokens: !touchedSources.includes('text-[success]') && !touchedSources.includes('text-[danger]'),
  }

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `Frontend UX consistency contract failed: ${name}`)
  }

  console.log(JSON.stringify({
    ok: true,
    schemaVersion: 'frontend.ux_consistency_contract.v1',
    checks,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
