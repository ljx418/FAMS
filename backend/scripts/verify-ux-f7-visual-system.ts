import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'ux-f7', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const files = {
    css: resolve(repoRoot, 'frontend/src/index.css'),
    layout: resolve(repoRoot, 'frontend/src/components/layout/AppLayout.tsx'),
    dashboard: resolve(repoRoot, 'frontend/src/pages/Dashboard.tsx'),
    assets: resolve(repoRoot, 'frontend/src/pages/Assets.tsx'),
  }
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
  )) as Record<keyof typeof files, string>
  const primaryUxSources = `${sources.layout}\n${sources.dashboard}\n${sources.assets}`

  const checks = {
    lightFirstTokensDefined: sources.css.includes('--bg-primary: #f4f7fb')
      && sources.css.includes('--bg-card: #ffffff')
      && sources.css.includes('--text-primary: #0f172a'),
    unifiedCardAndPressableClassesDefined: sources.css.includes('.fams-card')
      && sources.css.includes('.fams-stat-card')
      && sources.css.includes('.fams-pressable:hover')
      && sources.css.includes('.fams-pressable:active')
      && sources.css.includes(':focus-visible'),
    emptyStateAndIconShellDefined: sources.css.includes('.fams-empty-state')
      && sources.css.includes('.fams-stat-icon'),
    layoutUsesLightShell: sources.layout.includes('bg-[#f4f7fb]')
      && sources.layout.includes('theme="light"')
      && !sources.layout.includes('theme="dark"'),
    dashboardUsesUnifiedSurfaces: sources.dashboard.includes('DashboardStatCard')
      && sources.dashboard.includes('fams-card')
      && sources.dashboard.includes('fams-stat-card')
      && sources.dashboard.includes('fams-empty-state'),
    assetsUsesUnifiedSurfaces: sources.assets.includes('fams-page-title')
      && sources.assets.includes('fams-stat-card')
      && sources.assets.includes('fams-empty-state')
      && sources.assets.includes('fams-card'),
    noInvalidSemanticTailwindTokens: !primaryUxSources.includes('text-[success]')
      && !primaryUxSources.includes('text-[danger]')
      && !primaryUxSources.includes('border-[surface-border]'),
    noHardcodedDarkCardsInPrimaryUxPages: !primaryUxSources.includes('bg-[#1a1a2e]')
      && !primaryUxSources.includes('bg-[#0f0f23]'),
    reducedMotionSupported: sources.css.includes('@media (prefers-reduced-motion: reduce)'),
    expertModuleTabsPreserved: sources.layout.includes("key: 'dividend-low-vol'")
      && sources.layout.includes("key: 'backtest'")
      && sources.layout.includes("key: 'operations'")
      && sources.layout.includes("key: 'analysis'"),
  }

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `UX-F7 visual system contract failed: ${name}`)
  }

  const audit = {
    schemaVersion: 'fams.ux_f7.visual_system_audit.v1',
    status: 'passed',
    checkedAt,
    checks,
    designSystem: {
      lightFirst: true,
      unifiedCards: true,
      pressFeedback: true,
      focusVisible: true,
      reducedMotion: true,
      dominantDeepPurpleBlueThemeRemovedFromPrimaryUxPages: true,
    },
    expertModuleTabsPreserved: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, 'frontend_visual_system_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
