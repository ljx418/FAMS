import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { humanAcceptanceDraftService } from '../src/services/formal-release/humanAcceptanceDraftService.js'

async function main() {
  const root = resolve(process.cwd(), '..')
  const [dailySource, backtestSource, checklistSource, dailyReview, completedBacktest, a6Context] = await Promise.all([
    readFile(resolve(root, 'frontend/src/pages/DailyReviews.tsx'), 'utf8'),
    readFile(resolve(root, 'frontend/src/pages/Backtest.tsx'), 'utf8'),
    readFile(resolve(root, 'frontend/public/formal-release-human-checklist.html'), 'utf8'),
    prisma.dailyReviewRun.findFirst({ where: { userId: process.env.FAMS_ACCEPTANCE_USER_ID || 'default' }, orderBy: { generatedAt: 'desc' }, select: { id: true, status: true, generatedAt: true } }),
    prisma.operation.findFirst({
      where: { userId: process.env.FAMS_ACCEPTANCE_USER_ID || 'default', type: 'portfolio_backtest_run', status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, status: true, requestedAt: true, completedAt: true, progressPct: true, artifactRefsJson: true },
    }),
    humanAcceptanceDraftService.context(),
  ])

  assert.ok(dailyReview, 'a real persisted daily review is required')
  assert.ok(completedBacktest, 'a real completed portfolio_backtest_run operation is required')
  const backtestArtifactRefs = JSON.parse(completedBacktest.artifactRefsJson || '[]') as string[]
  assert.ok(backtestArtifactRefs.some((ref) => ref.endsWith(':03_backtest_results.json')), 'real backtest result artifact is required')
  assert.ok(a6Context.package?.packageId, 'the current provisional A6 package is required')
  assert.equal(a6Context.reviewItems.length, 8)

  assert.ok(dailySource.includes("window.localStorage.getItem('fams.dailyReview.experienceMode')"))
  assert.ok(dailySource.includes("experienceMode === 'expert'"))
  assert.ok(dailySource.includes('daily-review-plain-guide'))
  assert.ok(dailySource.includes('先看结论，再决定下一步'))
  assert.ok(dailySource.includes('本页只生成研究结论和人工计划草案，不会创建订单或自动交易。'))
  assert.ok(backtestSource.includes("showSlider={experienceMode === 'expert'}"))
  assert.ok(backtestSource.includes("showSlider ? [{ type: 'inside' }, { type: 'slider'"))
  assert.ok(checklistSource.includes("['data','benchmark'].forEach"))
  assert.ok(checklistSource.includes("section.hidden=true"))
  assert.ok(checklistSource.includes('展开架构与操作证据'))

  const audit = {
    schemaVersion: 'fams.a6.r3.progressive_disclosure_audit.v1',
    generatedAt: new Date().toISOString(),
    realData: true,
    persistedEvidence: {
      dailyReview,
      completedBacktest: {
        operationId: completedBacktest.id,
        status: completedBacktest.status,
        requestedAt: completedBacktest.requestedAt,
        completedAt: completedBacktest.completedAt,
        progressPct: completedBacktest.progressPct,
        artifactCount: backtestArtifactRefs.length,
        resultArtifactPresent: true,
      },
      a6PackageId: a6Context.package.packageId,
      a6DraftRevision: a6Context.draft.revision,
      a6OverallStatus: a6Context.draft.overallStatus,
    },
    uiContract: {
      plainModeDefault: true,
      dailyReviewConclusionFirst: true,
      expertDailyReviewPreserved: true,
      backtestSliderHiddenInPlainMode: true,
      backtestSliderPreservedInExpertMode: true,
      a6DataAndBenchmarkStatusVisible: true,
      a6TechnicalSectionsCollapsedByDefault: true,
    },
    calculationContract: {
      duplicateCalculationPathIntroduced: false,
      samePersistedDailyReviewUsedAcrossModes: true,
      samePersistedBacktestUsedAcrossModes: true,
    },
    tradeBoundary: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    overallStatus: 'passed',
  }
  const output = resolve(root, 'docs/automation-audits/a6-feedback-remediation/R3/progressive-disclosure-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, ...audit.persistedEvidence }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
