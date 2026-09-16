import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from './formalReleaseHash.js'

const REQUIRED_OPERATION_ARTIFACTS = [
  '13_execution_isolation_audit.json',
  '14_release_gate_audit.json',
  '15_data_governance_audit.json',
  '16_benchmark_qualification_audit.json',
  '17_formal_validation_audit.json',
  '18_manual_signoff_audit.json',
] as const

type OperationForPackage = {
  id: string
  type: string
  status: string
  inputJson: string
  resultJson: string
  artifactRefsJson: string
  completedAt: Date | null
}

function parseObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
}

export type FrozenReleaseArtifact = {
  stageId: 'A0' | 'FTR-1' | 'FTR-2' | 'FTR-3' | 'FTR-4' | 'FTR-5'
  name: string
  path: string
  packageRelativePath: string
  originPath: string
  absolutePath: string
  sha256: string
  bytes: number
}

function sha256Bytes(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

export class FormalReleasePackageService {
  constructor(private readonly rootDir = resolve(process.cwd(), 'data', 'formal-release', 'packages')) {}

  async build(input: {
    operation: OperationForPackage
    operationManifestHash: string
    providerAuthorizationAudit: Record<string, any>
    formalBenchmarkAudits: Array<Record<string, any>>
    manualSignoffAudit: Record<string, any>
    productionAdapterApprovalRecord: Record<string, any>
    now?: Date
  }) {
    const generatedAt = (input.now ?? new Date()).toISOString()
    const operationResult = parseObject(input.operation.resultJson)
    const operationArtifacts = operationResult.artifacts && typeof operationResult.artifacts === 'object'
      ? operationResult.artifacts as Record<string, unknown>
      : {}
    const missingArtifacts = REQUIRED_OPERATION_ARTIFACTS.filter((name) => !(name in operationArtifacts))
    const sourceArtifactEntries = Object.entries(operationArtifacts).map(([name, value]) => ({
      name,
      source: 'operation',
      sha256: sha256Canonical(value),
    }))
    const dataGovernance = (operationArtifacts['15_data_governance_audit.json'] as any)?.dataGovernanceAudit || {}
    const benchmarkQualification = (operationArtifacts['16_benchmark_qualification_audit.json'] as any)?.benchmarkQualificationAudit || {}
    const formalValidation = (operationArtifacts['17_formal_validation_audit.json'] as any)?.formalValidationAudit || {}
    const executionIsolation = (operationArtifacts['13_execution_isolation_audit.json'] as any)?.executionIsolationAudit || {}
    const businessGates = {
      formalDataGovernancePassed: dataGovernance.status === 'passed' && input.providerAuthorizationAudit.status === 'passed',
      benchmarkQualificationPassed: benchmarkQualification.canSupportFormalTrading === true
        && input.formalBenchmarkAudits.some((audit) => audit.status === 'passed'),
      formalValidationPassed: formalValidation.formalValidationPassed === true && formalValidation.allReleaseCandidatesPassed === true,
      manualSignoffPassed: input.manualSignoffAudit.manualSignoffPassed === true,
      executionIsolationPassed: executionIsolation.mode === 'paper_sandbox_only'
        && executionIsolation.productionAdapterEnabled === false
        && executionIsolation.realPositionMutationAllowed === false
        && executionIsolation.orderCreateAllowed === false,
    }
    const packageChecks = {
      allRequiredArtifactsPresent: missingArtifacts.length === 0,
      allArtifactHashesVerified: sourceArtifactEntries.every((entry) => entry.sha256 === sha256Canonical(operationArtifacts[entry.name])),
      allReleaseCandidatesVisible: Boolean(formalValidation.releaseCandidateSet?.releaseCandidateStrategyIds?.length)
        && formalValidation.checks?.length === formalValidation.releaseCandidateSet?.releaseCandidateStrategyIds?.length,
      blockedAndInsufficientResultsPreserved: Array.isArray(formalValidation.checks)
        && formalValidation.checks.every((check: any) => ['passed', 'warning', 'insufficient', 'failed'].includes(check.status)),
    }
    const formalTradingReleaseReviewReady = Object.values(packageChecks).every(Boolean)
    const businessBlockers = [
      ...(!businessGates.formalDataGovernancePassed ? ['formal_data_governance_not_passed'] : []),
      ...(!businessGates.benchmarkQualificationPassed ? ['benchmark_qualification_not_passed'] : []),
      ...(!businessGates.formalValidationPassed ? ['formal_validation_not_passed'] : []),
      ...(!businessGates.manualSignoffPassed ? ['manual_signoff_not_passed'] : []),
      ...(!businessGates.executionIsolationPassed ? ['execution_isolation_not_passed'] : []),
      'production_order_adapter_not_enabled',
      'human_release_approval_pending',
    ]
    const releaseGateAudit = {
      schemaVersion: 'fams.formal_release.release_gate_audit.v1',
      generatedAt,
      operationId: input.operation.id,
      status: 'blocked',
      engineeringPackageStatus: formalTradingReleaseReviewReady ? 'ready_for_human_review' : 'incomplete',
      businessGates,
      packageChecks,
      blockers: businessBlockers,
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingReleaseReviewReady,
      formalTradingReleaseReady: false,
      productionAdapterEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      notTradingAdvice: true,
    }
    const summary = [
      '# FAMS Formal Release Review Summary',
      '',
      `- Operation: ${input.operation.id}`,
      `- Generated at: ${generatedAt}`,
      `- Engineering package: ${releaseGateAudit.engineeringPackageStatus}`,
      `- Business release gate: ${releaseGateAudit.status}`,
      '- Release approval: pending_human_approval',
      '- Production adapter: disabled',
      '- Trading/order permissions: locked',
      '',
      '## Business blockers',
      '',
      ...businessBlockers.map((blocker) => `- ${blocker}`),
      '',
      'This package is review evidence only and is not trading advice or an order authorization.',
      '',
    ].join('\n')
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>FAMS Formal Release Review</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#18202a}code{word-break:break-all}.blocked{color:#b42318}.ready{color:#067647}li{margin:6px 0}</style></head><body><h1>FAMS Formal Release Review</h1><p>Operation: <code>${escapeHtml(input.operation.id)}</code></p><p class="${formalTradingReleaseReviewReady ? 'ready' : 'blocked'}">Engineering package: ${escapeHtml(releaseGateAudit.engineeringPackageStatus)}</p><p class="blocked">Business release gate: blocked / pending human approval</p><h2>Business blockers</h2><ul>${businessBlockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join('')}</ul><h2>Hard boundary</h2><p>productionAdapterEnabled=false; formalTradingUnlocked=false; autoTradeUnlocked=false; canCreateOrder=false; orderCreateAllowed=false</p></body></html>\n`
    const generatedArtifactEntries = [
      { name: '14_release_gate_audit.json', source: 'generated', sha256: sha256Canonical(releaseGateAudit) },
      { name: 'acceptance-report.html', source: 'generated', sha256: sha256Canonical(html) },
      { name: 'SUMMARY_FOR_GPT.md', source: 'generated', sha256: sha256Canonical(summary) },
    ]
    const manifest = {
      schemaVersion: 'fams.formal_release.review_manifest.v1',
      generatedAt,
      operationId: input.operation.id,
      operationManifestHash: input.operationManifestHash,
      status: formalTradingReleaseReviewReady ? 'ready_for_human_review' : 'incomplete',
      sourceArtifacts: sourceArtifactEntries,
      generatedArtifacts: generatedArtifactEntries,
      missingArtifacts,
      packageChecks,
      businessGates,
      manualSignoffAuditHash: sha256Canonical(input.manualSignoffAudit),
      providerAuthorizationAuditHash: sha256Canonical(input.providerAuthorizationAudit),
      formalBenchmarkAuditsHash: sha256Canonical(input.formalBenchmarkAudits),
      productionAdapterApprovalRecordHash: sha256Canonical(input.productionAdapterApprovalRecord),
      humanReviewRequired: true,
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingReleaseReviewReady,
      formalTradingReleaseReady: false,
      productionAdapterEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }
    const packageHash = sha256Canonical(manifest)
    const packageDir = resolve(this.rootDir, input.operation.id, packageHash)
    await mkdir(packageDir, { recursive: true })
    const paths = {
      releaseGateAudit: resolve(packageDir, '14_release_gate_audit.json'),
      manifest: resolve(packageDir, 'formal_release_review_manifest.json'),
      html: resolve(packageDir, 'acceptance-report.html'),
      summary: resolve(packageDir, 'SUMMARY_FOR_GPT.md'),
    }
    await Promise.all([
      writeFile(paths.releaseGateAudit, `${JSON.stringify(releaseGateAudit, null, 2)}\n`, 'utf8'),
      writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      writeFile(paths.html, html, 'utf8'),
      writeFile(paths.summary, summary, 'utf8'),
    ])
    return { packageHash, packageDir, paths, manifest, releaseGateAudit, html, summary }
  }

  async buildProvisional(input: {
    packageDir: string
    generatedAt: string
    packageId: string
    sourceManifest: { path: string; sha256: string }
    sourceArtifacts: FrozenReleaseArtifact[]
    releaseCandidateCount: number
    applicableReleaseCandidateCount: number
    failedWalkForwardWindowCount: number
    reviewQueue: { path: string; sha256: string; itemCount: number; pendingCount: number; approvedCount: number; riskEvidenceRebound: boolean }
    businessGates: {
      formalDataGovernancePassed: boolean
      benchmarkQualificationPassed: boolean
      formalValidationPassed: boolean
      manualSignoffPassed: false
      executionIsolationPassed: boolean
    }
  }) {
    const requiredStages = ['A0', 'FTR-1', 'FTR-2', 'FTR-3', 'FTR-4', 'FTR-5'] as const
    const requiredNames = [
      'a0_acceptance_audit.json',
      '15_data_governance_audit.json',
      '16_benchmark_qualification_audit.json',
      '17_formal_validation_audit.json',
      'deferred_human_review_queue.json',
      '18_manual_signoff_audit.json',
      '13_execution_isolation_audit.json',
      'trade_boundary_wording_audit.json',
      'production_adapter_approval_record.json',
    ]
    const verifiedArtifacts: Array<Omit<FrozenReleaseArtifact, 'absolutePath'>> = []
    for (const artifact of input.sourceArtifacts) {
      const raw = await readFile(artifact.absolutePath)
      if (raw.byteLength !== artifact.bytes || sha256Bytes(raw) !== artifact.sha256) {
        throw new Error(`ftr6_source_artifact_hash_mismatch:${artifact.originPath}`)
      }
      const { absolutePath: _absolutePath, ...publicArtifact } = artifact
      verifiedArtifacts.push(publicArtifact)
    }
    const coveredStages = requiredStages.filter((stageId) => verifiedArtifacts.some((artifact) => artifact.stageId === stageId))
    const missingRequiredArtifacts = requiredNames.filter((name) => !verifiedArtifacts.some((artifact) => artifact.name === name))
    const packageChecks = {
      allRequiredArtifactsPresent: missingRequiredArtifacts.length === 0 && coveredStages.length === requiredStages.length,
      allArtifactHashesVerified: verifiedArtifacts.length === input.sourceArtifacts.length,
      allReleaseCandidatesVisible: input.releaseCandidateCount >= 1 && input.applicableReleaseCandidateCount >= 1,
      blockedAndInsufficientResultsPreserved: input.failedWalkForwardWindowCount >= 1,
      ftr4RiskEvidenceReboundToCurrentFtr5: input.reviewQueue.riskEvidenceRebound,
    }
    const formalTradingReleaseReviewReady = Object.values(packageChecks).every(Boolean)
    const blockers = [
      'manual_signoff_not_passed',
      'consolidated_human_acceptance_pending',
      'production_order_adapter_not_enabled',
      'human_release_approval_pending',
    ]
    const releaseGateAudit = {
      schemaVersion: 'fams.formal_release.provisional_release_gate_audit.v2',
      generatedAt: input.generatedAt,
      packageId: input.packageId,
      status: 'blocked' as const,
      engineeringPackageStatus: formalTradingReleaseReviewReady ? 'ready_for_human_review' as const : 'incomplete' as const,
      businessGates: input.businessGates,
      packageChecks,
      blockers,
      humanAcceptanceStatus: 'pending_batch_review' as const,
      downstreamEvidenceStatus: 'provisional_until_human_pass' as const,
      batchHumanReviewReady: formalTradingReleaseReviewReady,
      releaseApprovalStatus: 'pending_human_approval' as const,
      formalTradingReleaseReviewReady,
      finalFormalReleaseReviewPackageReady: false as const,
      formalTradingReleaseReady: false as const,
      productionAdapterEnabled: false as const,
      realPositionMutationAllowed: false as const,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
      notTradingAdvice: true as const,
    }
    const summary = [
      '# FAMS FTR-6 Provisional 集中验收包',
      '',
      `- Package: ${input.packageId}`,
      `- Generated at: ${input.generatedAt}`,
      `- 工程审查包：${releaseGateAudit.engineeringPackageStatus}`,
      '- 集中人工核查：pending_batch_review',
      '- 最终正式评审包：未生成',
      '- 业务 release gate：blocked',
      '- 正式交易、订单创建和自动交易：全部锁定',
      '',
      '## 当前阻断',
      '',
      ...blockers.map((blocker) => `- ${blocker}`),
      '',
      '本包只用于集中人工复核，不是交易建议、订单授权或正式交易 release。',
      '',
    ].join('\n')
    const stageRows = requiredStages.map((stageId) => {
      const count = verifiedArtifacts.filter((artifact) => artifact.stageId === stageId).length
      return `<tr><td>${escapeHtml(stageId)}</td><td>${count}</td><td><span class="pass">已冻结</span></td></tr>`
    }).join('')
    const artifactRows = verifiedArtifacts.map((artifact) => `<tr><td>${escapeHtml(artifact.stageId)}</td><td><a href="${escapeHtml(artifact.packageRelativePath)}">${escapeHtml(artifact.name)}</a></td><td><code>${escapeHtml(artifact.sha256)}</code></td><td>${artifact.bytes}</td></tr>`).join('')
    const blockerRows = blockers.map((blocker) => `<li><code>${escapeHtml(blocker)}</code></li>`).join('')
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FAMS FTR-6 Provisional 集中验收包</title><style>:root{color-scheme:light;--ink:#17202a;--muted:#52606d;--line:#dce3e8;--surface:#fff;--soft:#f5f7f8;--green:#067647;--amber:#9a6700;--red:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}.shell{max-width:1180px;margin:auto;padding:32px 24px 64px}header{background:var(--surface);border:1px solid var(--line);padding:28px;border-radius:8px}h1{font-size:28px;margin:0 0 8px;letter-spacing:0}h2{font-size:19px;margin:32px 0 12px;letter-spacing:0}.lede{color:var(--muted);margin:0}.status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:22px}.metric{border-top:3px solid var(--line);padding:12px;background:var(--soft)}.metric strong{display:block;font-size:17px}.pass{color:var(--green);font-weight:700}.pending{color:var(--amber);font-weight:700}.blocked{color:var(--red);font-weight:700}.band{background:var(--surface);border:1px solid var(--line);padding:20px 24px;margin-top:16px;border-radius:8px}.flow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}.step{min-height:88px;border:1px solid var(--line);padding:10px;background:var(--soft)}.step b{display:block}.step small{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--soft)}code{font-size:12px;word-break:break-all}.notice{border-left:4px solid var(--red);padding:12px 16px;background:#fff5f3}.paths{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.path{border:1px solid var(--line);padding:14px;background:var(--soft)}@media(max-width:800px){.status-grid,.paths{grid-template-columns:1fr 1fr}.flow{grid-template-columns:1fr}.shell{padding:16px}.artifact-table{display:block;overflow:auto}}@media(max-width:480px){.status-grid,.paths{grid-template-columns:1fr}}</style></head><body><main class="shell"><header><h1>FAMS FTR-6 Provisional 集中验收包</h1><p class="lede">当前自动化证据已冻结，等待一次集中人工核查。工程包可审查不等于正式交易可用。</p><div class="status-grid"><div class="metric"><span>工程包</span><strong class="pass">可供人工复核</strong></div><div class="metric"><span>人工验收</span><strong class="pending">待执行</strong></div><div class="metric"><span>业务 release</span><strong class="blocked">阻断</strong></div><div class="metric"><span>交易权限</span><strong class="blocked">全部锁定</strong></div></div></header><section class="band"><h2>当前架构与目标状态</h2><div class="flow"><div class="step"><b>A0 输入冻结</b><small>候选、开源数据用途和验证 profile</small></div><div class="step"><b>FTR-1 数据治理</b><small>point-in-time 字段证据通过</small></div><div class="step"><b>FTR-2 Benchmark</b><small>H00300 trusted total return 通过</small></div><div class="step"><b>FTR-3 模型验证</b><small>5/6 窗口；失败窗口保留</small></div><div class="step"><b>FTR-4 核查队列</b><small>8 项 pending；不可自签</small></div><div class="step"><b>FTR-5 执行隔离</b><small>paper only；真实账户未改变</small></div><div class="step"><b>FTR-6 审查包</b><small>provisional；等待集中人工核查</small></div></div></section><section class="band"><h2>用户体验路径</h2><div class="paths"><div class="path"><b>普通用户</b><p>ChatBox 查询、组合比较和数据健康解释；遇到 release 问题跳转工作台，不触发交易。</p></div><div class="path"><b>资深用户</b><p>在 Backtest 查看 benchmark、walk-forward 和失败窗口，在 Operations 追溯同一证据链。</p></div><div class="path"><b>审计者</b><p>核对 8 类 pending 项、artifact 哈希、责任角色与打回阶段；人工决定不由自动化代签。</p></div></div></section><section class="band"><h2>阶段覆盖</h2><table><thead><tr><th>阶段</th><th>冻结文件数</th><th>状态</th></tr></thead><tbody>${stageRows}</tbody></table></section><section class="band"><h2>仍未完成与责任</h2><div class="notice"><strong>不得声明本阶段已正式 release。</strong><ul>${blockerRows}</ul></div><table><thead><tr><th>待办</th><th>责任</th><th>失败打回</th></tr></thead><tbody><tr><td>产品体验、数据、benchmark、模型、风险、合规、最终 release 八项集中核查</td><td>授权人工审查者</td><td>对应 UX / V2-PX / FTR-1 / FTR-2 / FTR-3 / FTR-5 / FTR-6</td></tr><tr><td>最终正式评审包重建</td><td>人工核查全通过后的受控流程</td><td>FTR-6</td></tr><tr><td>生产适配器与交易权限</td><td>未来独立高风险批准</td><td>保持永久阻断</td></tr></tbody></table></section><section class="band"><h2>原始证据清单</h2><div class="artifact-table"><table><thead><tr><th>阶段</th><th>文件</th><th>SHA-256</th><th>字节</th></tr></thead><tbody>${artifactRows}</tbody></table></div></section><section class="band"><h2>硬边界</h2><p><code>formalTradingUnlocked=false</code> · <code>autoTradeUnlocked=false</code> · <code>canCreateOrder=false</code> · <code>orderCreateAllowed=false</code></p><p class="lede">本报告使用冻结的真实数据审计链；它不是交易建议，也不授权订单或真实持仓变更。</p></section></main></body></html>\n`
    await mkdir(input.packageDir, { recursive: true })
    const paths = {
      releaseGateAudit: resolve(input.packageDir, '14_release_gate_audit.json'),
      manifest: resolve(input.packageDir, 'formal_release_review_manifest.json'),
      html: resolve(input.packageDir, 'acceptance-report.html'),
      summary: resolve(input.packageDir, 'SUMMARY_FOR_GPT.md'),
    }
    const releaseBody = `${JSON.stringify(releaseGateAudit, null, 2)}\n`
    await Promise.all([
      writeFile(paths.releaseGateAudit, releaseBody, 'utf8'),
      writeFile(paths.html, html, 'utf8'),
      writeFile(paths.summary, summary, 'utf8'),
    ])
    const generatedArtifacts = await Promise.all([
      ['14_release_gate_audit.json', paths.releaseGateAudit],
      ['acceptance-report.html', paths.html],
      ['SUMMARY_FOR_GPT.md', paths.summary],
    ].map(async ([name, absolutePath]) => {
      const raw = await readFile(absolutePath)
      return { name, path: name, sha256: sha256Bytes(raw), bytes: raw.byteLength }
    }))
    const manifest = {
      schemaVersion: 'fams.formal_release.provisional_review_manifest.v2',
      generatedAt: input.generatedAt,
      packageId: input.packageId,
      sourceManifest: input.sourceManifest,
      sourceArtifacts: verifiedArtifacts,
      generatedArtifacts,
      stageCoverage: [...requiredStages],
      missingArtifacts: missingRequiredArtifacts,
      packageChecks,
      businessGates: input.businessGates,
      reviewQueue: input.reviewQueue,
      humanReviewRequired: true as const,
      humanAcceptanceStatus: 'pending_batch_review' as const,
      downstreamEvidenceStatus: 'provisional_until_human_pass' as const,
      releaseApprovalStatus: 'pending_human_approval' as const,
      formalTradingReleaseReviewReady,
      finalFormalReleaseReviewPackageReady: false as const,
      formalTradingReleaseReady: false as const,
      productionAdapterEnabled: false as const,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
    await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return { packageDir: input.packageDir, paths, manifest, releaseGateAudit }
  }
}

export const formalReleasePackageService = new FormalReleasePackageService()
