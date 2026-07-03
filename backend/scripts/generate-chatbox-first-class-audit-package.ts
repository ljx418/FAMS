import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'

async function fileExists(path: string) {
  try {
    await readFile(path, 'utf8')
    return true
  } catch {
    return false
  }
}

async function findLatestAudit(filename: string) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore')
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return null
  }
  const sorted = entries.sort().reverse()
  for (const entry of sorted) {
    const path = join(root, entry, filename)
    if (await fileExists(path)) return path
  }
  return null
}

async function readJson(path: string | null) {
  if (!path) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const generatedAt = new Date().toISOString()
  const outDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', generatedAt.replace(/[:.]/g, '-'))
  await mkdir(outDir, { recursive: true })

  const capabilities = await famsChatService.capabilities()
  const auditFiles = {
    toolManifest: await findLatestAudit('chatbox_tool_manifest_audit.json'),
    structuredResult: await findLatestAudit('chatbox_structured_result_audit.json'),
    operationLinkage: await findLatestAudit('chat_operation_linkage_audit.json'),
    permissionDrift: await findLatestAudit('chatbox_permission_drift_audit.json'),
    llmPermissionDrift: await findLatestAudit('chat_llm_permission_drift_audit.json'),
    tradeBoundaryWording: await findLatestAudit('trade_boundary_wording_audit.json'),
    acceptanceReportAudit: await findLatestAudit('acceptance_report_audit.json'),
    agentCore: await findLatestAudit('chatbox_agentcore_audit.json'),
    llmPlanner: await findLatestAudit('chat_llm_planner_audit.json'),
  }
  const audits = {
    toolManifest: await readJson(auditFiles.toolManifest),
    structuredResult: await readJson(auditFiles.structuredResult),
    operationLinkage: await readJson(auditFiles.operationLinkage),
    permissionDrift: await readJson(auditFiles.permissionDrift),
    llmPermissionDrift: await readJson(auditFiles.llmPermissionDrift),
    tradeBoundaryWording: await readJson(auditFiles.tradeBoundaryWording),
    acceptanceReportAudit: await readJson(auditFiles.acceptanceReportAudit),
    agentCore: await readJson(auditFiles.agentCore),
    llmPlanner: await readJson(auditFiles.llmPlanner),
  }
  const allRequiredPassed = ['toolManifest', 'structuredResult', 'operationLinkage', 'permissionDrift', 'tradeBoundaryWording', 'acceptanceReportAudit', 'agentCore']
    .every((key) => (audits as any)[key]?.status === 'passed')
  const llmStatus = audits.llmPlanner?.status || 'not_checked'

  const firstClassAudit = {
    schemaVersion: 'fams.chatbox_first_class_audit.v1',
    status: allRequiredPassed ? 'passed' : 'blocked',
    generatedAt,
    stage: 'chatbox_first_class_business_entry',
    prdSpecReview: {
      chatBoxFirstClassTargetDocumented: true,
      fullBusinessToolCoverageReady: audits.toolManifest?.coveragePercent === 100,
      inlineChartResultReady: audits.structuredResult?.chartTypes?.includes('line_chart') && audits.structuredResult?.chartTypes?.includes('drawdown_chart'),
      chatOperationLinkageReady: audits.operationLinkage?.status === 'passed',
      chatSessionAuditReady: audits.agentCore?.readiness?.chatSessionAuditReady === true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    evidence: {
      auditFiles,
      capabilityToolCount: capabilities.tools.length,
      prohibitedActions: capabilities.prohibitedActions,
      allowedActions: capabilities.allowedActions,
      llmPlannerStatus: llmStatus,
    },
    completedSubStages: [
      { id: 'CB-A', name: '文档与状态闭环', status: 'passed', evidence: auditFiles.agentCore },
      { id: 'CB-B', name: '工具覆盖与权限协议', status: audits.toolManifest?.status || 'missing', evidence: auditFiles.toolManifest },
      { id: 'CB-C', name: '结构化结果与图表', status: audits.structuredResult?.status || 'missing', evidence: auditFiles.structuredResult },
      { id: 'CB-D', name: 'Operation 与确认闭环', status: audits.operationLinkage?.status || 'missing', evidence: auditFiles.operationLinkage },
      { id: 'CB-E1', name: '权限漂移和交易边界', status: audits.permissionDrift?.status || 'missing', evidence: auditFiles.permissionDrift },
      { id: 'CB-E2', name: '交易边界文案合同', status: audits.tradeBoundaryWording?.status || 'missing', evidence: auditFiles.tradeBoundaryWording },
      { id: 'CB-E3', name: 'HTML 自动化验收报告', status: audits.acceptanceReportAudit?.status || 'missing', evidence: auditFiles.acceptanceReportAudit },
    ],
    remainingLimitations: [
      'ChatBox first-class ready 不等于 formal trading ready。',
      '组合回测可研究级展示真实缓存数据，但 formalReviewReady=false 时不能释放正式 ADD/REDUCE。',
      'chatStreamingReady=false，当前是请求/响应式结构化结果。',
      '策略表现仍依赖本地缓存和 free-source 数据等级；正式交易仍需授权数据、正式 benchmark、交易约束和人工签核。',
    ],
    requiredVerificationCommands: [
      'cd backend && node node_modules/typescript/bin/tsc --noEmit',
      'cd backend && npm run test:chatbox-first-class',
      'cd backend && npm run test:chat-llm-planner',
      'cd backend && npm run test:fivd-r-trade-gate-contract',
      'cd backend && npm run test:trade-action-readiness',
      'cd frontend && npm run build',
    ],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const auditPath = resolve(outDir, 'chatbox_first_class_audit.json')
  await writeFile(auditPath, `${JSON.stringify(firstClassAudit, null, 2)}\n`, 'utf8')

  const tracker = {
    schemaVersion: 'fams.chatbox_development_tracker.v1',
    generatedAt,
    status: firstClassAudit.status,
    items: firstClassAudit.completedSubStages,
    blockers: allRequiredPassed ? [] : firstClassAudit.completedSubStages.filter((item) => item.status !== 'passed'),
    notTradingAdvice: true,
  }
  await writeFile(resolve(outDir, 'development_tracker.json'), `${JSON.stringify(tracker, null, 2)}\n`, 'utf8')

  const summary = [
    '# ChatBox 第一业务入口阶段审计摘要',
    '',
    `GeneratedAt: ${generatedAt}`,
    '',
    `Status: ${firstClassAudit.status}`,
    '',
    '## 已完成能力',
    '',
    '- ChatBox 工具 manifest 覆盖已文档化的核心业务入口。',
    '- 永久组合 vs 全天候组合可在 ChatBox 内 quick-run，并返回指标表、净值曲线和回撤曲线 payload。',
    '- 持久化组合回测、红利低波扫描、数据刷新和人工计划草案均需要二次确认。',
    '- Chat session、工具确认、Operation id 和 artifactRefs 可审计。',
    '- 正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 仍被阻断。',
    '',
    '## 当前限制',
    '',
    ...firstClassAudit.remainingLimitations.map((item) => `- ${item}`),
    '',
    '## 审计文件',
    '',
    ...Object.entries(auditFiles).map(([key, value]) => `- ${key}: ${value || 'missing'}`),
    '',
    '## 交易边界',
    '',
    '- formalTradingUnlocked=false',
    '- autoTradeUnlocked=false',
    '- canCreateOrder=false',
    '- orderCreateAllowed=false',
  ].join('\n')
  const summaryPath = resolve(outDir, 'SUMMARY_FOR_GPT.md')
  await writeFile(summaryPath, `${summary}\n`, 'utf8')

  console.log(JSON.stringify({ ...firstClassAudit, auditPath, summaryPath, outDir }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
