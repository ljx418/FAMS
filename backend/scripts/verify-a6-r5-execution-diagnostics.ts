import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const root = resolve(process.cwd(), '..')
  const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
  const summaries = await analysisService.listAdviceSummaries(userId, { limit: 50 })
  const selected = summaries.items.find((item) => item.accountIds.includes('tonghuashun') && item.backtestEligible)
  assert.ok(selected, 'real broker-covered advice is required')
  const before = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.adviceAction.count({ where: { advice: { userId } } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.position.count({ where: { userId, status: 'open' } }),
  ])
  const detail = await analysisService.getAdviceDetail(userId, selected.adviceId) as any
  const diagnostics = detail.executionDiagnostics
  assert.equal(diagnostics.schemaVersion, 'fams.advice.execution_diagnostics.v1')
  assert.equal(diagnostics.executableActionCount, selected.executableActionCount)
  assert.equal(diagnostics.actionDiagnostics.length, diagnostics.executableActionCount)
  assert.equal(
    diagnostics.acceptedExecutionRate,
    diagnostics.humanAcceptedCount > 0 ? Number((diagnostics.executionRecordedCount / diagnostics.humanAcceptedCount).toFixed(4)) : null,
  )
  diagnostics.actionDiagnostics.forEach((item: any) => {
    assert.ok(item.reasonCodes.length > 0)
    if (item.observedPricePointCount === 0) assert.equal(item.marketTouched, null)
  })
  const after = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.adviceAction.count({ where: { advice: { userId } } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.position.count({ where: { userId, status: 'open' } }),
  ])
  assert.deepEqual(after, before, 'execution diagnostics must be read-only')

  const frontendSource = await readFile(resolve(root, 'frontend/src/pages/Backtest.tsx'), 'utf8')
  assert.ok(frontendSource.includes('执行证据不足，暂不计算执行率'))
  assert.ok(frontendSource.includes('为什么建议尚未执行'))
  assert.ok(frontendSource.includes('不会为了提高执行率自动调整低波动策略参数'))

  const audit = {
    schemaVersion: 'fams.a6.r5.execution_diagnostics_audit.v1',
    generatedAt: new Date().toISOString(),
    realData: true,
    adviceId: selected.adviceId,
    adviceGeneratedAt: selected.generatedAt,
    diagnostics,
    protectedCountsBefore: { advice: before[0], adviceAction: before[1], transaction: before[2], openPosition: before[3] },
    protectedCountsAfter: { advice: after[0], adviceAction: after[1], transaction: after[2], openPosition: after[3] },
    strategyParametersChanged: false,
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    overallStatus: 'passed',
  }
  const output = resolve(root, 'docs/automation-audits/a6-feedback-remediation/R5/execution-diagnostics-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, adviceId: audit.adviceId, evidenceSufficiency: diagnostics.evidenceSufficiency, acceptedExecutionRate: diagnostics.acceptedExecutionRate, reasonBreakdown: diagnostics.reasonBreakdown }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
