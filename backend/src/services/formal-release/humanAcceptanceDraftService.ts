import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const HUMAN_ACCEPTANCE_REVIEW_TYPES = [
  'daily_user_experience',
  'v2_px_experience',
  'data',
  'benchmark',
  'model',
  'risk',
  'compliance',
  'final_release',
] as const

export type HumanAcceptanceReviewType = typeof HUMAN_ACCEPTANCE_REVIEW_TYPES[number]
export type HumanAcceptanceDraftStatus = 'not_run' | 'passed' | 'failed' | 'needs_remediation'
export type HumanAcceptanceSeverity = 'none' | 'minor' | 'major' | 'fatal'

export interface HumanAcceptanceDraftItem {
  reviewType: HumanAcceptanceReviewType
  status: HumanAcceptanceDraftStatus
  severity: HumanAcceptanceSeverity
  actualResult: string
  expectedDifference: string
  reproductionSteps: string
  remediationSuggestion: string
  evidenceRefs: string[]
}

export interface HumanAcceptanceDraft {
  schemaVersion: 'fams.formal_release.human_acceptance_draft.v1'
  packageId: string
  sourceManifestSha256: string
  revision: number
  createdAt: string
  updatedAt: string
  overallStatus: 'in_progress' | 'needs_remediation' | 'ready_for_authorized_signoff'
  humanReviewOnly: true
  items: HumanAcceptanceDraftItem[]
  tradeBoundary: {
    productionAdapterEnabled: false
    formalTradingUnlocked: false
    autoTradeUnlocked: false
    canCreateOrder: false
    orderCreateAllowed: false
  }
}

type ReviewGuideItem = {
  reviewType: HumanAcceptanceReviewType
  title: string
  purpose: string
  architecture: string[]
  prerequisites: string[]
  steps: string[]
  expected: string[]
  rollbackStage: string
  artifactRefs: string[]
  artifactHashes: string[]
}

type ProvisionalManifest = {
  schemaVersion: string
  packageId: string
  generatedAt: string
  sourceManifest: { path: string; sha256: string }
  reviewQueue: { path: string; sha256: string; itemCount: number; pendingCount: number; approvedCount: number }
  packageChecks: Record<string, boolean>
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
}

type DeferredQueue = {
  items: Array<{
    reviewType: HumanAcceptanceReviewType
    rollbackStage: string
    artifactRefs: string[]
    artifactHashes: string[]
  }>
}

const TRADE_BOUNDARY = {
  productionAdapterEnabled: false,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
} as const

const GUIDE: Record<HumanAcceptanceReviewType, Omit<ReviewGuideItem, 'reviewType' | 'rollbackStage' | 'artifactRefs' | 'artifactHashes'>> = {
  daily_user_experience: {
    title: '普通用户完整体验',
    purpose: '验证普通用户无需金融或系统背景，也能从真实资产进入复盘、对话解释、工作台和证据追踪。',
    architecture: ['Assets Excel import/export', 'Dashboard + FamsChatBox', 'UserTaskWorkbench', 'Backtest / Operations'],
    prerequisites: ['后端与前端服务已启动', '使用真实且已确认的本地资产数据', '不得为了通过验收修改账户事实'],
    steps: ['导入或打开真实资产并核对数量与日期', '从 Dashboard 使用 ChatBox 发起组合比较', '进入普通用户工作台查看结论、关键数字和数据健康', '打开专家页与 Operations，确认能回到同一证据链'],
    expected: ['普通用户能在主路径理解结论和下一步', '错误与数据不足以普通中文显示', '专家多页仍可访问', '没有下单或自动交易入口'],
  },
  v2_px_experience: {
    title: 'V2-PX 双容器体验',
    purpose: '验证 Side Panel、Workspace Page 与 Host App 三入口在真实 Chrome 中保持路由、状态和证据一致。',
    architecture: ['WXT Side Panel', 'Background intent router', 'Workspace Page', 'FAMS host bridge + lifecycle audit'],
    prerequisites: [
      '后端运行于 http://127.0.0.1:4000，前端运行于 http://127.0.0.1:3000',
      '在 packages/fams-v2-px-extension 执行 npm install && npm run build',
      '使用真实 Chrome profile；不得用普通扩展标签页冒充原生 Side Panel',
    ],
    steps: [
      '打开 chrome://extensions，启用开发者模式，点击“加载已解压的扩展程序”，选择 packages/fams-v2-px-extension/.output/chrome-mv3',
      '固定“FAMS External Brain”扩展图标，点击后打开原生 Side Panel；点击“连接本地 FAMS”并确认状态为已连接',
      '从 Side Panel 打开完整工作台，再从 http://127.0.0.1:3000 的外部大脑按钮发起 Host App 路由；核对三个入口的独立 dispatch 与同一规范任务',
      '在 Workspace 依次验证来源库、来源详情、问答、追踪、图谱以及刷新、关闭重开、断连恢复，并保存真实 Chrome 截图与 trace',
    ],
    expected: ['PX6-02 达到 10/10', '没有 mock 截图、权限越界或状态丢失', '窄侧栏保持轻入口，完整工作区不退化', '三入口关联到同一规范任务但 dispatch 可区分'],
  },
  data: {
    title: '真实数据与字段证据',
    purpose: '独立复核公开来源使用依据、point-in-time 数据、freshness、coverage 和字段证据是否真实可追溯。',
    architecture: ['FormalDataProviderService', 'FreePointInTimeSnapshotService', 'FieldEvidenceValidator', 'FormalDataSnapshot'],
    prerequisites: ['读取 A0 冻结的来源条款和用途声明', '读取当前 FTR-1 artifact', '不得在 A6 补签或替换来源授权'],
    steps: ['核对来源条款、用途范围、端点和原始哈希', '抽查价格、分红、可交易性、基本面、行业和成本字段', '核对 5216/5216 与六个冻结时点 6/6 ready', '确认 secret 与账户明细未进入公开证据'],
    expected: ['使用依据和哈希与 A0 一致', '关键字段无 unknown、stale 或 blocked', '覆盖率达到冻结门槛', '不把公开来源描述成商业授权'],
  },
  benchmark: {
    title: 'Benchmark 资格与重放',
    purpose: '确认 H00300 trusted total-return 的来源、版本、日期范围和重放结果足以支撑当前评审。',
    architecture: ['FormalBenchmarkService', 'Benchmark artifact store', 'qualificationAudit', 'benchmark replay'],
    prerequisites: ['读取 A0/FTR-2 来源依据', '使用冻结的 H00300 版本', '不得临时更换 benchmark 获得更好结果'],
    steps: ['核对 benchmark 类型与来源条款', '核对 735 个有效观测及日期连续性', '重放并比较曲线哈希与 qualification audit', '确认页面没有把 price index 或 proxy 写成 official total-return'],
    expected: ['类型为 trusted_total_return', '来源、版本、哈希与 replay 一致', '覆盖完整验证区间', '许可描述不超出本机个人非商业用途'],
  },
  model: {
    title: '模型与回测可信度',
    purpose: '确认冻结 candidate、OOS、walk-forward、参数敏感性和分组稳定性符合 PRD，失败窗口未隐藏。',
    architecture: ['ReleaseCandidateSet', 'FormalValidationProfileSet', 'PortfolioBacktestEngine', 'FormalValidationService'],
    prerequisites: ['使用当前 point-in-time v2 candidate', '保持冻结阈值不变', '读取 FTR-3 全部 replay artifact'],
    steps: ['核对唯一产品候选和其他对象的 applicability', '检查 6 个 walk-forward 窗口和 53 条动态路径', '复核 5 组参数及行业、市场、流动性分组', '定位 wf-04 失败并确认报告未删除或弱化'],
    expected: ['结果保持 5/6 且通过率不低于 0.6', '路径数不少于 30，样本和回撤等门槛不降低', 'wf-04 明确可见', 'not_applicable 不冒充 passed'],
  },
  risk: {
    title: '执行隔离与交易阻断',
    purpose: '验证研究、草案和 paper/sandbox 路径不能修改真实持仓、创建订单或启用生产适配器。',
    architecture: ['ExecutionIsolationService', 'ChatBox permission gate', 'API trade gate', 'production adapter approval record'],
    prerequisites: ['记录验收前 Position、Transaction 和订单摘要', '生产适配器保持 disabled', '仅使用 paper/sandbox 操作'],
    steps: ['分别尝试 ADD、REDUCE、ORDER_CREATE、AUTO_TRADE', '从 ChatBox、专家页和 API 检查阻断反馈', '核对 paper intent 不含真实 notional 或目标权重', '再次核对账户与订单摘要'],
    expected: ['四类动作全部 blocked', '账户事实前后一致且订单写入为零', 'production adapter disabled', '四项交易锁全部为 false'],
  },
  compliance: {
    title: '合规、隐私与审计边界',
    purpose: '确认来源、责任、非投资建议、隐私脱敏和 artifact 链满足本机受控评审要求。',
    architecture: ['provider authorization evidence', 'privacy sanitizer', 'FTR source manifest', 'audit package'],
    prerequisites: ['打开 provider、benchmark、隐私和 manifest 证据', '使用脱敏后的公开审计包', '不在反馈中填写密钥或账户敏感信息'],
    steps: ['核对来源责任和用途限制', '搜索 token、cookie、账户原图和完整敏感正文', '从 manifest 抽查 artifact 路径与 SHA-256', '确认所有报告保留非投资建议和交易锁边界'],
    expected: ['来源和责任可追溯', '公开包无 secret、cookie 或账户原图', 'artifact 哈希可复核', '没有正式交易或商业授权误导'],
  },
  final_release: {
    title: '最终 release 人工决策',
    purpose: '在前七项完成后审核 FTR-6 provisional 包，决定是否允许按同一哈希生成 A7 最终评审包。',
    architecture: ['DeferredHumanReviewQueue', 'FTR-6 provisional package', 'ReleaseGateService', 'A7 final package builder'],
    prerequisites: ['前七项均为 passed', '打开当前 provisional HTML、manifest 与 SUMMARY', '确认全部反馈绑定同一 source manifest hash'],
    steps: ['从 provisional HTML 逐项进入原始 evidence', '核对前七项反馈与 artifact hash', '确认已知 blocker、失败归属和回滚阶段', '决定允许生成 A7 或打回对应责任阶段'],
    expected: ['前七项全部通过且哈希一致', '当前失败窗口和限制仍可见', '结论只允许生成 A7，不解锁交易', '任何重大或致命问题都必须打回'],
  },
}

function emptyDraftItem(reviewType: HumanAcceptanceReviewType): HumanAcceptanceDraftItem {
  return {
    reviewType,
    status: 'not_run',
    severity: 'none',
    actualResult: '',
    expectedDifference: '',
    reproductionSteps: '',
    remediationSuggestion: '',
    evidenceRefs: [],
  }
}

function hasSensitiveContent(value: string) {
  return /Bearer\s+[A-Za-z0-9._-]{16,}/i.test(value)
    || /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    || /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s]{8,}/i.test(value)
}

function validateText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') throw Object.assign(new Error(`${field}_must_be_string`), { statusCode: 400 })
  const normalized = value.trim()
  if (normalized.length > maxLength) throw Object.assign(new Error(`${field}_too_long`), { statusCode: 400 })
  if (hasSensitiveContent(normalized)) throw Object.assign(new Error(`${field}_sensitive_content_detected`), { statusCode: 400 })
  return normalized
}

export class HumanAcceptanceDraftService {
  constructor(
    private readonly repoRoot = resolve(process.cwd(), '..'),
    private readonly draftRoot = resolve(repoRoot, '.verification', 'private', 'formal-release', 'A6'),
    private readonly packageRoot = resolve(repoRoot, 'backend', 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-6'),
  ) {}

  async context() {
    const { manifest, queue } = await this.currentPackage()
    const draft = await this.readDraft(manifest.packageId, manifest.sourceManifest.sha256)
    const queueByType = new Map(queue.items.map((item) => [item.reviewType, item]))
    const reviewItems: ReviewGuideItem[] = HUMAN_ACCEPTANCE_REVIEW_TYPES.map((reviewType) => {
      const queueItem = queueByType.get(reviewType)
      if (!queueItem) throw new Error(`human_review_queue_item_missing:${reviewType}`)
      return {
        reviewType,
        ...GUIDE[reviewType],
        rollbackStage: queueItem.rollbackStage,
        artifactRefs: queueItem.artifactRefs,
        artifactHashes: queueItem.artifactHashes,
      }
    })
    return {
      schemaVersion: 'fams.formal_release.human_acceptance_draft_context.v1' as const,
      package: {
        packageId: manifest.packageId,
        generatedAt: manifest.generatedAt,
        sourceManifestSha256: manifest.sourceManifest.sha256,
        reviewQueueSha256: manifest.reviewQueue.sha256,
        packageChecks: manifest.packageChecks,
      },
      reviewItems,
      v2PxEntryGuide: {
        schemaVersion: 'fams.v2_px.human_entry_guide.v1' as const,
        extensionName: 'FAMS External Brain',
        buildCommand: 'cd packages/fams-v2-px-extension && npm install && npm run build',
        unpackedDirectory: 'packages/fams-v2-px-extension/.output/chrome-mv3',
        chromeExtensionsUrl: 'chrome://extensions',
        backendUrl: 'http://127.0.0.1:4000',
        hostAppUrl: 'http://127.0.0.1:3000',
        sidePanelPath: 'sidepanel.html',
        workspacePath: 'workspace.html',
        nativeSidePanelHumanEvidenceRequired: true as const,
      },
      draft,
      draftPath: this.relativeDraftPath(manifest.packageId),
      officialSignoffCreated: false as const,
      humanAcceptanceStatus: 'pending_batch_review' as const,
      tradeBoundary: TRADE_BOUNDARY,
    }
  }

  async save(input: { packageId?: unknown; sourceManifestSha256?: unknown; expectedRevision?: unknown; items?: unknown }) {
    const { manifest } = await this.currentPackage()
    if (input.packageId !== manifest.packageId) throw Object.assign(new Error('human_review_package_not_current'), { statusCode: 409 })
    if (input.sourceManifestSha256 !== manifest.sourceManifest.sha256) throw Object.assign(new Error('human_review_source_manifest_hash_not_current'), { statusCode: 409 })
    if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) {
      throw Object.assign(new Error('human_review_expected_revision_invalid'), { statusCode: 400 })
    }
    const current = await this.readDraft(manifest.packageId, manifest.sourceManifest.sha256)
    if (input.expectedRevision !== current.revision) throw Object.assign(new Error('human_review_draft_revision_conflict'), { statusCode: 409 })
    const items = this.validateItems(input.items)
    const previousItemsPassed = items.slice(0, -1).every((item) => item.status === 'passed')
    if (items.at(-1)?.status === 'passed' && !previousItemsPassed) {
      throw Object.assign(new Error('final_release_review_requires_previous_reviews_passed'), { statusCode: 409 })
    }
    const updatedAt = new Date().toISOString()
    const draft: HumanAcceptanceDraft = {
      schemaVersion: 'fams.formal_release.human_acceptance_draft.v1',
      packageId: manifest.packageId,
      sourceManifestSha256: manifest.sourceManifest.sha256,
      revision: current.revision + 1,
      createdAt: current.revision === 0 ? updatedAt : current.createdAt,
      updatedAt,
      overallStatus: items.every((item) => item.status === 'passed')
        ? 'ready_for_authorized_signoff'
        : items.some((item) => item.status === 'failed' || item.status === 'needs_remediation')
          ? 'needs_remediation'
          : 'in_progress',
      humanReviewOnly: true,
      items,
      tradeBoundary: TRADE_BOUNDARY,
    }
    const directory = resolve(this.draftRoot, manifest.packageId)
    const target = resolve(directory, 'human-feedback-draft.json')
    const temporary = resolve(directory, `.human-feedback-draft.${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
    return {
      schemaVersion: 'fams.formal_release.human_acceptance_draft_save.v1' as const,
      draft,
      draftPath: this.relativeDraftPath(manifest.packageId),
      officialSignoffCreated: false as const,
      humanAcceptanceStatus: 'pending_batch_review' as const,
      tradeBoundary: TRADE_BOUNDARY,
    }
  }

  private validateItems(value: unknown) {
    if (!Array.isArray(value) || value.length !== HUMAN_ACCEPTANCE_REVIEW_TYPES.length) {
      throw Object.assign(new Error('human_review_items_must_contain_eight_types'), { statusCode: 400 })
    }
    const inputByType = new Map<string, Record<string, unknown>>()
    for (const raw of value) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('human_review_item_invalid'), { statusCode: 400 })
      const item = raw as Record<string, unknown>
      const allowedKeys = new Set(['reviewType', 'status', 'severity', 'actualResult', 'expectedDifference', 'reproductionSteps', 'remediationSuggestion', 'evidenceRefs'])
      if (Object.keys(item).some((key) => !allowedKeys.has(key))) throw Object.assign(new Error('human_review_item_unknown_field'), { statusCode: 400 })
      if (!HUMAN_ACCEPTANCE_REVIEW_TYPES.includes(item.reviewType as HumanAcceptanceReviewType)) throw Object.assign(new Error('human_review_type_invalid'), { statusCode: 400 })
      if (inputByType.has(String(item.reviewType))) throw Object.assign(new Error('human_review_type_duplicated'), { statusCode: 400 })
      inputByType.set(String(item.reviewType), item)
    }
    return HUMAN_ACCEPTANCE_REVIEW_TYPES.map((reviewType): HumanAcceptanceDraftItem => {
      const item = inputByType.get(reviewType)
      if (!item) throw Object.assign(new Error(`human_review_type_missing:${reviewType}`), { statusCode: 400 })
      if (!['not_run', 'passed', 'failed', 'needs_remediation'].includes(String(item.status))) throw Object.assign(new Error('human_review_status_invalid'), { statusCode: 400 })
      if (!['none', 'minor', 'major', 'fatal'].includes(String(item.severity))) throw Object.assign(new Error('human_review_severity_invalid'), { statusCode: 400 })
      const status = item.status as HumanAcceptanceDraftStatus
      const severity = item.severity as HumanAcceptanceSeverity
      if ((status === 'failed' || status === 'needs_remediation') && severity === 'none') {
        throw Object.assign(new Error('human_review_failure_severity_required'), { statusCode: 400 })
      }
      const evidenceRefs = Array.isArray(item.evidenceRefs)
        ? item.evidenceRefs.map((entry, index) => validateText(entry, `evidence_refs_${index}`, 500)).filter(Boolean)
        : (() => { throw Object.assign(new Error('human_review_evidence_refs_invalid'), { statusCode: 400 }) })()
      if (evidenceRefs.length > 20 || new Set(evidenceRefs).size !== evidenceRefs.length) throw Object.assign(new Error('human_review_evidence_refs_invalid'), { statusCode: 400 })
      if (evidenceRefs.some((entry) => entry.startsWith('/') || entry.includes('..') || entry.includes('\\'))) {
        throw Object.assign(new Error('human_review_evidence_ref_unsafe'), { statusCode: 400 })
      }
      return {
        reviewType,
        status,
        severity,
        actualResult: validateText(item.actualResult, 'actual_result', 4000),
        expectedDifference: validateText(item.expectedDifference, 'expected_difference', 3000),
        reproductionSteps: validateText(item.reproductionSteps, 'reproduction_steps', 3000),
        remediationSuggestion: validateText(item.remediationSuggestion, 'remediation_suggestion', 3000),
        evidenceRefs,
      }
    })
  }

  private async currentPackage() {
    const entries = await readdir(this.packageRoot, { withFileTypes: true })
    const candidates: Array<{ manifest: ProvisionalManifest; queue: DeferredQueue }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const directory = resolve(this.packageRoot, entry.name)
        const manifest = JSON.parse(await readFile(resolve(directory, 'formal_release_review_manifest.json'), 'utf8')) as ProvisionalManifest
        if (manifest.schemaVersion !== 'fams.formal_release.provisional_review_manifest.v2') continue
        if (!Object.values(manifest.packageChecks).every(Boolean)) continue
        if (manifest.formalTradingUnlocked || manifest.autoTradeUnlocked || manifest.canCreateOrder || manifest.orderCreateAllowed) continue
        const queuePath = resolve(this.repoRoot, manifest.reviewQueue.path)
        const queue = JSON.parse(await readFile(queuePath, 'utf8')) as DeferredQueue
        candidates.push({ manifest, queue })
      } catch {
        // Invalidated or incomplete evidence directories are deliberately ignored.
      }
    }
    candidates.sort((left, right) => right.manifest.generatedAt.localeCompare(left.manifest.generatedAt))
    if (!candidates[0]) throw Object.assign(new Error('human_review_current_provisional_package_not_found'), { statusCode: 503 })
    return candidates[0]
  }

  private async readDraft(packageId: string, sourceManifestSha256: string): Promise<HumanAcceptanceDraft> {
    try {
      const parsed = JSON.parse(await readFile(resolve(this.draftRoot, packageId, 'human-feedback-draft.json'), 'utf8')) as HumanAcceptanceDraft
      if (parsed.packageId !== packageId || parsed.sourceManifestSha256 !== sourceManifestSha256) throw new Error('draft_binding_mismatch')
      return parsed
    } catch {
      const now = new Date().toISOString()
      return {
        schemaVersion: 'fams.formal_release.human_acceptance_draft.v1',
        packageId,
        sourceManifestSha256,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        overallStatus: 'in_progress',
        humanReviewOnly: true,
        items: HUMAN_ACCEPTANCE_REVIEW_TYPES.map(emptyDraftItem),
        tradeBoundary: TRADE_BOUNDARY,
      }
    }
  }

  private relativeDraftPath(packageId: string) {
    return `.verification/private/formal-release/A6/${packageId}/human-feedback-draft.json`
  }
}

export const humanAcceptanceDraftService = new HumanAcceptanceDraftService()
