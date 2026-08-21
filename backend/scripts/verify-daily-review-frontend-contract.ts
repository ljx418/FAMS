import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const [page, app, layout, chat, capturePanel, service, workflowService] = await Promise.all([
  readFile(resolve(repoRoot, 'frontend/src/pages/DailyReviews.tsx'), 'utf8'),
  readFile(resolve(repoRoot, 'frontend/src/App.tsx'), 'utf8'),
  readFile(resolve(repoRoot, 'frontend/src/components/layout/AppLayout.tsx'), 'utf8'),
  readFile(resolve(repoRoot, 'frontend/src/components/chat/FamsChatBox.tsx'), 'utf8'),
  readFile(resolve(repoRoot, 'frontend/src/components/capture/ScreenshotCapturePanel.tsx'), 'utf8'),
  readFile(resolve(repoRoot, 'backend/src/services/chat/famsChatService.ts'), 'utf8'),
  readFile(resolve(repoRoot, 'backend/src/services/review/dailyReviewWorkflowService.ts'), 'utf8'),
])

for (const route of ['daily-reviews', 'daily-reviews/:reviewId']) assert.match(app, new RegExp(`path="${route.replace('/', '\\/')}"`))
assert.match(layout, /key: 'daily-reviews'.*label: '每日复盘'/)
assert.match(chat, /打开十节点工作台/)
assert.match(service, /打开复盘工作台/)
assert.match(chat, /<ScreenshotCapturePanel/)
assert.match(page, /<ScreenshotCapturePanel/)
for (const text of ['仅私有保存', '同意并识别，先看预览', '确认写入可用行', '绝不自动减仓或平仓']) assert.match(capturePanel, new RegExp(text))
assert.match(capturePanel, /consentGranted: true/)
assert.match(capturePanel, /setConsent\(false\)/)
assert.match(capturePanel, /MAX_FILE_SIZE = 10 \* 1024 \* 1024/)
assert.doesNotMatch(capturePanel, /storagePath/)
assert.match(page, /NODE_REVIEW_STORAGE_PREFIX/)
assert.match(page, /localNodeReviewsAreFormalSignoff: false/)

for (const node of ['触发评审', '持仓快照', '行情采集', '均线计算', '基本面与消息', '策略评估', '关注标的', '系统网格', '历史比较', '执行边界']) {
  assert.match(workflowService, new RegExp(node))
}
for (const text of ['30 日均线', 'MA5', 'MA10', 'MA30', '需要关注的标的', '波动交易网格草案', '公开审计工作台', '不展示模型私密思维链']) assert.match(page, new RegExp(text))
for (const boundary of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.match(page, new RegExp(boundary))
assert.match(page, /\/api\/v1\/daily-reviews\/\$\{encodeURIComponent\(id\)\}\/workflow/)
assert.doesNotMatch(page, /2026-08-20T10:55|manualDraft|REVIEW_V1_DATA|prototype_fixture/)
assert.match(page, /executionMode: 'inline'/)
assert.match(page, /idempotencyKey:/)

console.log(JSON.stringify({
  ok: true,
  routes: 2,
  nodeDataSource: 'workflow_api',
  chartSeries: ['close', 'MA5', 'MA10', 'MA30'],
  tradingActionsPresent: false,
  prototypeFixturePresent: false,
  sharedScreenshotCapturePanel: true,
  localNodeReviewAnnotations: true,
}, null, 2))
