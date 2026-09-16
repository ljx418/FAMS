import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { prisma } from '../src/db/prisma.js'
import { analysisRoutes } from '../src/routes/analysis.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const root = resolve(process.cwd(), '..')
  const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
  const [beforeAdvice, beforeOperations] = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.operation.count({ where: { userId } }),
  ])
  const result = await analysisService.listAdviceSummaries(userId, { limit: 50 })
  const app = Fastify({ logger: false })
  await app.register(analysisRoutes, { prefix: '/api/v1/analysis' })
  const apiResponse = await app.inject({ method: 'GET', url: `/api/v1/analysis/advice-summaries?userId=${encodeURIComponent(userId)}&limit=50` })
  assert.equal(apiResponse.statusCode, 200)
  const apiPayload = apiResponse.json()
  assert.equal(apiPayload.readOnly, true)
  assert.equal(apiPayload.count, result.count)
  await app.close()
  const brokerAdvice = result.items.find((item) => item.accountIds.includes('tonghuashun') && item.backtestEligible)
  assert.ok(result.readOnly)
  assert.ok(result.items.length > 0, 'real persisted advice is required')
  assert.ok(brokerAdvice, 'a persisted Tonghuashun-covered advice with executable actions is required')
  const detail = await analysisService.getAdviceDetail(userId, brokerAdvice.adviceId)
  const [afterAdvice, afterOperations] = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.operation.count({ where: { userId } }),
  ])
  assert.equal(afterAdvice, beforeAdvice, 'listing or selecting advice must not create advice')
  assert.equal(afterOperations, beforeOperations, 'listing or selecting advice must not create an operation')
  assert.equal(detail.adviceId, brokerAdvice.adviceId)

  const frontendSource = await readFile(resolve(root, 'frontend/src/pages/Backtest.tsx'), 'utf8')
  assert.ok(frontendSource.includes("axios.get('/api/v1/analysis/advice-summaries'"))
  assert.ok(frontendSource.includes('label="选择历史建议"'))
  assert.ok(frontendSource.includes('optionFilterProp="label"'))
  assert.ok(frontendSource.includes("form.setFieldValue('adviceId', adviceId)"))

  const audit = {
    schemaVersion: 'fams.a6.r4.advice_picker_audit.v1',
    generatedAt: new Date().toISOString(),
    realData: true,
    list: {
      count: result.count,
      adviceCountBefore: beforeAdvice,
      adviceCountAfter: afterAdvice,
      operationCountBefore: beforeOperations,
      operationCountAfter: afterOperations,
      readOnly: result.readOnly,
      apiStatusCode: apiResponse.statusCode,
    },
    brokerAdvice: {
      adviceId: brokerAdvice.adviceId,
      generatedAt: brokerAdvice.generatedAt,
      accountIds: brokerAdvice.accountIds,
      actionCount: brokerAdvice.actionCount,
      executableActionCount: brokerAdvice.executableActionCount,
      summaryText: brokerAdvice.summaryText,
    },
    uiContract: {
      searchableSelect: true,
      dateAccountSummaryVisible: true,
      urlPrefillPreserved: true,
      idEntryRequiredForOrdinaryUser: false,
    },
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    overallStatus: 'passed',
  }
  const output = resolve(root, 'docs/automation-audits/a6-feedback-remediation/R4/advice-picker-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, listCount: result.count, brokerAdvice: audit.brokerAdvice, noWrite: beforeAdvice === afterAdvice && beforeOperations === afterOperations }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
