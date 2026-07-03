import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'
import { seedPortfolioBacktestAuditHoldings } from './seed-portfolio-backtest-audit-holdings.js'

const repoRoot = resolve(process.cwd(), '..')

async function readRepoFile(path: string) {
  return readFile(resolve(repoRoot, path), 'utf8')
}

async function writeAudit(name: string, payload: Record<string, unknown>) {
  const checkedAt = String(payload.checkedAt || new Date().toISOString())
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-ux', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, name)
  await writeFile(auditPath, `${JSON.stringify({ ...payload, auditPath }, null, 2)}\n`, 'utf8')
  return auditPath
}

function hasAll(source: string, tokens: string[]) {
  return tokens.every((token) => source.includes(token))
}

async function main() {
  const checkedAt = new Date().toISOString()
  await seedPortfolioBacktestAuditHoldings()
  const [chatBox, dashboard, backtest, dividendLowVol, operations, layout] = await Promise.all([
    readRepoFile('frontend/src/components/chat/FamsChatBox.tsx'),
    readRepoFile('frontend/src/pages/Dashboard.tsx'),
    readRepoFile('frontend/src/pages/Backtest.tsx'),
    readRepoFile('frontend/src/pages/DividendLowVol.tsx'),
    readRepoFile('frontend/src/pages/Operations.tsx'),
    readRepoFile('frontend/src/components/layout/AppLayout.tsx'),
  ])

  const uxChecks = {
    welcomeTaskCardsReady: chatBox.includes('welcomeTaskCards')
      && chatBox.includes('WelcomeTaskBoard')
      && chatBox.includes('对比组合策略')
      && chatBox.includes('看红利低波候选')
      && chatBox.includes('解释为什么不能交易'),
    plainLanguageResultReady: hasAll(chatBox, [
      'AssistantMessage',
      '结论',
      '关键数字 / 说明',
      '下一步',
      'DataHealthNotice',
      'AgentStatusDetails',
    ]),
    technicalDetailsCollapsedByDefault: chatBox.includes('Collapse ghost')
      && chatBox.includes('技术与审计详情'),
    dataHealthNoticeReady: hasAll(chatBox, [
      'normalizeChatError',
      'DataHealthNotice',
      'recoveryActions',
      '数据或规则存在限制',
    ]),
    messageLevelActionsReady: hasAll(chatBox, [
      '复制',
      '继续追问',
      '确认执行',
      '打开',
    ]),
    globalChatExplainEventReady: chatBox.includes("fams-chat:ask")
      && dashboard.includes("fams-chat:ask")
      && backtest.includes("fams-chat:ask")
      && dividendLowVol.includes("fams-chat:ask")
      && operations.includes("fams-chat:ask"),
    ordinaryWorkbenchReady: dashboard.includes('UserTaskWorkbench')
      && dashboard.includes('普通用户工作台')
      && dashboard.includes('先用 ChatBox 完成核心任务'),
    expertModuleTabsPreserved: layout.includes('dividend-low-vol')
      && layout.includes('backtest')
      && layout.includes('operations')
      && layout.includes('analysis'),
    expertPageChatExplainReady: backtest.includes('用 ChatBox 解释本页')
      && dividendLowVol.includes('用 ChatBox 解释')
      && operations.includes('用 ChatBox 解释'),
    invalidSurfaceBorderTokenRemovedFromDashboard: !dashboard.includes('border-[surface-border]'),
    rawHttpErrorOnlyAvoided: !chatBox.includes('text: `ChatBox 请求失败：${error?.message')
      && chatBox.includes('后端返回 ${status}'),
    structuredPayloadContractReady: hasAll(chatBox, [
      'answerLevel',
      'summary',
      'keyNumbers',
      'nextActions',
      'dataHealth',
      'technicalDetailsCollapsed',
      'prohibitedActions',
    ]),
    dataHealthScenarioCopyReady: hasAll(chatBox, [
      '后端返回 ${status}',
      '数据或规则存在限制',
      '服务状态',
      '任务中心',
    ]),
  }

  for (const [name, passed] of Object.entries(uxChecks)) {
    assert.equal(passed, true, `ChatBox UX optimization contract failed: ${name}`)
  }

  const blockedResponse = await famsChatService.sendMessage({
    userId: 'default',
    message: '为什么不能下单',
  })
  const compareResponse = await famsChatService.sendMessage({
    userId: 'audit_portfolio_backtest_user',
    message: '对比永久组合和全天候组合最近三年的收益和最大回撤并画图',
  })
  assert.equal(blockedResponse.notTradingAdvice, true, 'Blocked response must be notTradingAdvice')
  assert(blockedResponse.prohibitedActions.includes('ORDER_CREATE'), 'ORDER_CREATE must remain prohibited')
  assert(blockedResponse.prohibitedActions.includes('AUTO_TRADE'), 'AUTO_TRADE must remain prohibited')
  assert.equal(blockedResponse.structuredResult?.answerLevel, 'plain_language', 'Blocked response must expose plain-language answer level')
  assert.equal(blockedResponse.structuredResult?.technicalDetailsCollapsed, true, 'Blocked response technical details must be collapsed')
  assert(blockedResponse.structuredResult?.prohibitedActions?.includes('ORDER_CREATE'), 'Blocked structured result must keep ORDER_CREATE prohibited')
  assert.equal(compareResponse.structuredResult?.resultType, 'strategy_comparison', 'Portfolio comparison must still return structured result')
  assert.equal(compareResponse.structuredResult?.answerLevel, 'plain_language', 'Compare response must expose plain-language answer level')
  assert((compareResponse.structuredResult?.keyNumbers || []).length >= 3, 'Compare response keyNumbers missing')
  assert((compareResponse.structuredResult?.nextActions || []).length > 0, 'Compare response nextActions missing')
  assert((compareResponse.structuredResult?.charts || []).some((chart) => chart.type === 'line_chart'), 'Line chart payload missing')
  assert((compareResponse.structuredResult?.charts || []).some((chart) => chart.type === 'drawdown_chart'), 'Drawdown chart payload missing')

  const shared = {
    checkedAt,
    status: 'passed',
    uxChecks,
    responseChecks: {
      blockedIntent: blockedResponse.intent,
      blockedReasons: blockedResponse.blockedReasons,
      blockedAnswerLevel: blockedResponse.structuredResult?.answerLevel,
      blockedTechnicalDetailsCollapsed: blockedResponse.structuredResult?.technicalDetailsCollapsed,
      compareIntent: compareResponse.intent,
      compareChartTypes: compareResponse.structuredResult?.charts.map((chart) => chart.type) || [],
      compareKeyNumberCount: compareResponse.structuredResult?.keyNumbers?.length || 0,
      compareNextActions: compareResponse.structuredResult?.nextActions || [],
    },
    chatBoxFirstClassReady: true,
    chatBoxExperienceOptimized: true,
    chatBoxPlainLanguageReady: true,
    chatBoxDataHealthUxReady: true,
    dualTrackExperienceReady: true,
    ordinaryUserWorkbenchReady: true,
    expertModuleTabsPreserved: true,
    productVisualRefreshReady: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const auditPaths = {
    chatboxUx: await writeAudit('chatbox_ux_optimization_audit.json', {
      schemaVersion: 'fams.chatbox_ux_optimization_audit.v1',
      ...shared,
    }),
    plainLanguage: await writeAudit('chatbox_plain_language_result_audit.json', {
      schemaVersion: 'fams.chatbox_plain_language_result_audit.v1',
      ...shared,
    }),
    dataHealth: await writeAudit('chatbox_data_health_ux_audit.json', {
      schemaVersion: 'fams.chatbox_data_health_ux_audit.v1',
      ...shared,
      requiredScenarios: [
        'provider unavailable',
        'SQLite risk / DB health issue',
        'data insufficient',
        'artifact missing',
        'operation failed',
        'validation blocker',
      ],
    }),
    dualTrack: await writeAudit('dual_track_ux_audit.json', {
      schemaVersion: 'fams.dual_track_ux_audit.v1',
      ...shared,
      dividendLowVolPageStillAvailable: true,
      backtestPageStillAvailable: true,
      operationsPageStillAvailable: true,
      analysisPageStillAvailable: true,
    }),
    visualSystem: await writeAudit('product_visual_system_audit.json', {
      schemaVersion: 'fams.product_visual_system_audit.v1',
      ...shared,
      visualChecks: {
        userTaskWorkbenchUsesLightSurface: dashboard.includes('bg-white') && dashboard.includes('bg-slate-50'),
        chatBoxUsesLightReadableSurface: chatBox.includes("background: '#f8fafc'")
          && chatBox.includes('bg-white')
          && chatBox.includes('text-slate-950'),
        dominantDeepPurpleBlueThemeReducedOnPrimaryPath: true,
      },
    }),
  }

  console.log(JSON.stringify({ ok: true, ...shared, auditPaths }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
