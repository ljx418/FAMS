import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const paths = {
  state: resolve(repoRoot, 'docs/current-stage-state.json'),
  prd: resolve(repoRoot, 'docs/DAILY_PORTFOLIO_REVIEW_PRD.md'),
  matrix: resolve(repoRoot, 'docs/DAILY_PORTFOLIO_REVIEW_TRACEABILITY_MATRIX.md'),
}

const [stateSource, prd, matrix] = await Promise.all([
  readFile(paths.state, 'utf8'),
  readFile(paths.prd, 'utf8'),
  readFile(paths.matrix, 'utf8'),
])
const state = JSON.parse(stateSource)
const requirementIds = (source: string) => [...source.matchAll(/^\| (DPR-\d{3}) \|/gm)].map((match) => match[1])
const expectedIds = Array.from({ length: 19 }, (_, index) => `DPR-${String(index + 1).padStart(3, '0')}`)
const prdIds = requirementIds(prd)
const matrixIds = requirementIds(matrix)
const dailyTrack = state.featureTracks?.dailyPortfolioReview

assert.deepEqual(prdIds, expectedIds, '每日复盘 PRD 的需求编号必须连续覆盖 DPR-001～DPR-019')
assert.deepEqual(matrixIds, expectedIds, '每日复盘追踪矩阵必须逐项覆盖 DPR-001～DPR-019')
assert.equal(dailyTrack?.requirementCoverage, '19/19', '中央状态的每日复盘覆盖率必须为 19/19')
assert.equal(dailyTrack?.productizedWorkflowUiStatus, 'implemented')
assert.equal(dailyTrack?.automatedFunctionalAcceptanceStatus, 'passed')
assert.equal(dailyTrack?.browserAcceptanceStatus, 'passed_playwright_four_viewports_and_chrome_cdp_spot_check')
assert.equal(dailyTrack?.humanAcceptanceStatus, 'not_performed')
assert.equal(state.statuses?.dailyPortfolioReviewHumanAcceptancePassed, false)

for (const lock of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) {
  assert.equal(dailyTrack?.[lock], false, `featureTracks.dailyPortfolioReview.${lock} 必须为 false`)
  assert.equal(state.statuses?.[lock], false, `statuses.${lock} 必须为 false`)
}

const combinedDailySources = `${stateSource}\n${prd}\n${matrix}`
assert.equal(combinedDailySources.includes('10/10'), false, '每日复盘文档仍包含过期的 10/10 覆盖率')
assert.match(prd, /人工验收未执行/)
assert.match(matrix, /需求追踪覆盖 `19\/19`/)

console.log(JSON.stringify({
  status: 'PASS',
  requirements: expectedIds.length,
  coverage: dailyTrack.requirementCoverage,
  browserAcceptanceStatus: dailyTrack.browserAcceptanceStatus,
  humanAcceptanceStatus: dailyTrack.humanAcceptanceStatus,
  tradingLocks: {
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  },
}, null, 2))
