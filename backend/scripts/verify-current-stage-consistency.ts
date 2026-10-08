import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const paths = {
  state: resolve(repoRoot, 'docs/current-stage-state.json'),
  prd: resolve(repoRoot, 'docs/DAILY_PORTFOLIO_REVIEW_PRD.md'),
  matrix: resolve(repoRoot, 'docs/DAILY_PORTFOLIO_REVIEW_TRACEABILITY_MATRIX.md'),
  investmentPlan: resolve(repoRoot, 'docs/INVESTMENT_WORKFLOW_DEVELOPMENT_ACCEPTANCE_PLAN.md'),
  architecture: resolve(repoRoot, 'docs/ARCHITECTURE_CURRENT_TARGET.md'),
  targetGap: resolve(repoRoot, 'docs/TARGET_ARCHITECTURE_GAP.md'),
  drawioOutput: resolve(repoRoot, 'docs/read-drawio-output.txt'),
  pointInTimeAudit: resolve(repoRoot, 'docs/audits/2026-10-08-point-in-time-simulation/ACCEPTANCE_AUDIT.md'),
}

const [stateSource, prd, matrix, investmentPlan, architecture, targetGap, drawioOutput, pointInTimeAudit] = await Promise.all([
  readFile(paths.state, 'utf8'),
  readFile(paths.prd, 'utf8'),
  readFile(paths.matrix, 'utf8'),
  readFile(paths.investmentPlan, 'utf8'),
  readFile(paths.architecture, 'utf8'),
  readFile(paths.targetGap, 'utf8'),
  readFile(paths.drawioOutput, 'utf8'),
  readFile(paths.pointInTimeAudit, 'utf8'),
])
const state = JSON.parse(stateSource)
const requirementIds = (source: string) => [...source.matchAll(/^\| (DPR-\d{3}) \|/gm)].map((match) => match[1])
const prdIds = requirementIds(prd)
const matrixIds = requirementIds(matrix)
assert.ok(prdIds.length > 0, '每日复盘 PRD 必须至少包含一项 DPR 需求')
const expectedIds = Array.from({ length: prdIds.length }, (_, index) => `DPR-${String(index + 1).padStart(3, '0')}`)
const expectedCoverage = `${expectedIds.length}/${expectedIds.length}`
const dailyTrack = state.featureTracks?.dailyPortfolioReview
const investmentTrack = state.featureTracks?.investmentWorkflow

assert.deepEqual(prdIds, expectedIds, `每日复盘 PRD 的需求编号必须连续覆盖 DPR-001～${expectedIds.at(-1)}`)
assert.deepEqual(matrixIds, expectedIds, `每日复盘追踪矩阵必须逐项覆盖 DPR-001～${expectedIds.at(-1)}`)
assert.equal(dailyTrack?.requirementCoverage, expectedCoverage, `中央状态的每日复盘覆盖率必须为 ${expectedCoverage}`)
assert.equal(dailyTrack?.productizedWorkflowUiStatus, 'implemented')
assert.equal(dailyTrack?.automatedFunctionalAcceptanceStatus, 'passed')
assert.equal(dailyTrack?.browserAcceptanceStatus, 'passed_existing_playwright_and_chrome_cdp_evidence_human_pending')
assert.equal(dailyTrack?.humanAcceptanceStatus, 'not_performed')
assert.equal(state.statuses?.dailyPortfolioReviewHumanAcceptancePassed, false)

for (const lock of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) {
  assert.equal(dailyTrack?.[lock], false, `featureTracks.dailyPortfolioReview.${lock} 必须为 false`)
  assert.equal(state.statuses?.[lock], false, `statuses.${lock} 必须为 false`)
}

assert.match(prd, /人工验收未执行/)
assert.match(matrix, new RegExp('需求追踪覆盖 `' + expectedCoverage.replace('/', '\\/') + '`'))

assert.equal(investmentTrack?.automatedImplementationScope, 'WF-0_through_WF-8')
assert.equal(investmentTrack?.automatedPassedRequirementCount, 19)
assert.equal(investmentTrack?.humanPendingRequirementCount, 1)
assert.equal(investmentTrack?.controlledBlockedRequirementCount, 0)
assert.equal(investmentTrack?.prdFullyComplete, false)
assert.equal(investmentTrack?.pointInTimeDynamicRecomputeReady, true)
assert.equal(investmentTrack?.defaultAccountConfirmedStrategyAssignmentCount, 16)
assert.equal(investmentTrack?.defaultAccountPendingStrategyAssignmentCount, 0)
assert.equal(investmentTrack?.remainingHumanRequirement, 'verify_confirmed_assignment_correctness_screenshot_corrections_curve_semantics_and_mobile_experience')
assert.equal(investmentTrack?.humanAcceptanceStatus, 'pending_batch_review')
for (const source of [investmentPlan, architecture, targetGap, drawioOutput]) {
  assert.match(source, /19\/20/, '投资工作流当前文档必须统一声明 19/20')
  assert.doesNotMatch(source, /PRD 18\/20|18\/20 通过|动态模拟待补|动态 point_in_time_simulation 尚未实现/)
}
assert.match(pointInTimeAudit, /automatedAcceptance=PASS/)
assert.match(pointInTimeAudit, /concentratedHumanAcceptance=PENDING/)
assert.match(pointInTimeAudit, /future_append_invariance_passed|未来数据不变性/)

console.log(JSON.stringify({
  status: 'PASS',
  requirements: expectedIds.length,
  coverage: dailyTrack.requirementCoverage,
  browserAcceptanceStatus: dailyTrack.browserAcceptanceStatus,
  humanAcceptanceStatus: dailyTrack.humanAcceptanceStatus,
  investmentWorkflow: {
    automatedScope: investmentTrack.automatedImplementationScope,
    passedRequirements: investmentTrack.automatedPassedRequirementCount,
    humanPendingRequirements: investmentTrack.humanPendingRequirementCount,
    pointInTimeDynamicRecomputeReady: investmentTrack.pointInTimeDynamicRecomputeReady,
    prdFullyComplete: investmentTrack.prdFullyComplete,
  },
  tradingLocks: {
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  },
}, null, 2))
