import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import {
  relativeRotationUniverseService,
  type RotationMarket,
  type RotationResearchBenchmarkInput,
  type RotationResearchBenchmarkMode,
  type RotationResearchTargetInput,
  type RotationResearchTargetKind,
} from './relativeRotationUniverseService.js'

export interface ResearchStudyPeriodInput {
  mode: 'rolling' | 'fixed'
  rollingWeeks?: number
  startDate?: string
  endDate?: string
}

export interface ResearchStudyInput {
  name: string
  market: RotationMarket
  frequency: 'weekly' | 'daily'
  historyYears?: number
  benchmark?: RotationResearchBenchmarkInput
  period: ResearchStudyPeriodInput
  targets: RotationResearchTargetInput[]
  comparisonTargetKeys?: string[]
}

export interface ResearchTimelineRequest {
  studyId?: string
  study?: ResearchStudyInput
}

type NormalizedStudyConfig = Omit<ResearchStudyInput, 'targets' | 'comparisonTargetKeys'> & {
  historyYears: number
  benchmark: { mode: RotationResearchBenchmarkMode; targetKeys: string[] }
  targets: Array<{
    code: string
    name: string
    kind: RotationResearchTargetKind
    targetKey: string
  }>
  comparisonTargetKeys: string[]
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

const parseJsonArray = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

class RelativeRotationResearchStudyService {
  private validatePeriod(input: ResearchStudyPeriodInput | undefined): ResearchStudyPeriodInput {
    const mode = input?.mode === 'fixed' ? 'fixed' : 'rolling'
    if (mode === 'rolling') {
      const rollingWeeks = Math.max(4, Math.min(520, Math.floor(Number(input?.rollingWeeks || 52))))
      return { mode, rollingWeeks }
    }
    const startDate = String(input?.startDate || '')
    const endDate = String(input?.endDate || '')
    if (!isoDatePattern.test(startDate) || !isoDatePattern.test(endDate) || startDate > endDate) {
      throw new Error('RRG_RESEARCH_PERIOD_INVALID: 固定观察区间须提供合法且顺序正确的起止日期')
    }
    return { mode, startDate, endDate }
  }

  private normalizeConfig(input: ResearchStudyInput): NormalizedStudyConfig {
    const name = String(input?.name || '').trim()
    if (!name || name.length > 80) throw new Error('RRG_RESEARCH_NAME_INVALID: 研究名称需为1至80个字符')
    const market = String(input?.market || '').trim().toUpperCase() as RotationMarket
    if (!['CN', 'HK', 'US'].includes(market)) throw new Error('RRG_RESEARCH_MARKET_INVALID: market must be CN, HK or US')
    const frequency = input?.frequency === 'daily' ? 'daily' : 'weekly'
    const period = this.validatePeriod(input?.period)
    const normalizedTargets = relativeRotationUniverseService.normalizeResearchTargets(market, Array.isArray(input?.targets) ? input.targets : [])
    const targets = normalizedTargets
      .map((target) => ({
        code: target.symbol,
        name: target.name,
        kind: target.kind,
        targetKey: target.targetKey,
      }))
    const historyYears = Math.max(1, Math.min(10, Math.floor(Number(input?.historyYears || 8))))
    const benchmark = relativeRotationUniverseService.normalizeResearchBenchmark(
      normalizedTargets,
      input?.benchmark,
    )
    const comparisonTargetKeys = Array.isArray(input?.comparisonTargetKeys)
      ? input.comparisonTargetKeys.map(String).filter(Boolean)
      : []
    if (comparisonTargetKeys.length !== 0 && comparisonTargetKeys.length !== 2) {
      throw new Error('RRG_RESEARCH_COMPARISON_INVALID: 关联对照须选择恰好两个标的')
    }
    const validTargetKeys = new Set(targets.map((target) => target.targetKey))
    if (comparisonTargetKeys.some((key) => !validTargetKeys.has(key)) || new Set(comparisonTargetKeys).size !== comparisonTargetKeys.length) {
      throw new Error('RRG_RESEARCH_COMPARISON_INVALID: 关联对照包含不存在或重复的标的')
    }
    return { name, market, frequency, historyYears, benchmark, period, targets, comparisonTargetKeys }
  }

  private serializeStudy(study: {
    id: string
    name: string
    market: string
    frequency: string
    historyYears: number
    benchmarkMode: string
    benchmarkTargetKeysJson: string
    periodMode: string
    rollingWeeks: number
    startDate: Date | null
    endDate: Date | null
    comparisonTargetKeysJson: string
    createdAt: Date
    updatedAt: Date
    targets: Array<{ targetKey: string; symbol: string; name: string; kind: string; sortOrder: number }>
  }) {
    return {
      id: study.id,
      name: study.name,
      market: study.market as RotationMarket,
      frequency: study.frequency === 'daily' ? 'daily' as const : 'weekly' as const,
      historyYears: Math.max(1, Math.min(10, study.historyYears || 8)),
      benchmark: {
        mode: study.benchmarkMode === 'equal_weight_targets' ? 'equal_weight_targets' as const : 'market_default' as const,
        targetKeys: parseJsonArray(study.benchmarkTargetKeysJson),
      },
      period: study.periodMode === 'fixed'
        ? {
            mode: 'fixed' as const,
            startDate: study.startDate?.toISOString().slice(0, 10) || '',
            endDate: study.endDate?.toISOString().slice(0, 10) || '',
          }
        : { mode: 'rolling' as const, rollingWeeks: study.rollingWeeks },
      comparisonTargetKeys: parseJsonArray(study.comparisonTargetKeysJson),
      targets: [...study.targets]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((target) => ({
          targetKey: target.targetKey,
          code: target.symbol,
          name: target.name,
          kind: target.kind === 'index' ? 'index' as const : 'equity' as const,
        })),
      createdAt: study.createdAt.toISOString(),
      updatedAt: study.updatedAt.toISOString(),
    }
  }

  private async findStudy(userId: string, studyId: string) {
    const study = await prisma.relativeRotationResearchStudy.findFirst({
      where: { id: studyId, userId },
      include: { targets: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!study) throw new Error('RRG_RESEARCH_STUDY_NOT_FOUND: 研究清单不存在或不属于当前用户')
    return study
  }

  private toTimelineInput(config: NormalizedStudyConfig) {
    return {
      market: config.market,
      frequency: config.frequency,
      years: config.historyYears,
      targets: config.targets.map((target) => ({ code: target.code, name: target.name, kind: target.kind })),
      benchmark: config.benchmark,
      ...(config.period.mode === 'fixed'
        ? { window: { startDate: config.period.startDate, endDate: config.period.endDate } }
        : { rollingWeeks: config.period.rollingWeeks }),
    }
  }

  private configFromStudy(study: Awaited<ReturnType<RelativeRotationResearchStudyService['findStudy']>>): NormalizedStudyConfig {
    const serialized = this.serializeStudy(study)
    return this.normalizeConfig(serialized)
  }

  async listStudies(userId: string) {
    await ensureUser(prisma, userId)
    const studies = await prisma.relativeRotationResearchStudy.findMany({
      where: { userId },
      include: { targets: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    })
    return {
      schemaVersion: 'fams.relative_rotation.research_studies.v1',
      generatedAt: new Date().toISOString(),
      studies: studies.map((study) => this.serializeStudy(study)),
    }
  }

  async createStudy(userId: string, input: ResearchStudyInput) {
    await ensureUser(prisma, userId)
    const config = this.normalizeConfig(input)
    const study = await prisma.relativeRotationResearchStudy.create({
      data: {
        userId,
        name: config.name,
        market: config.market,
        frequency: config.frequency,
        historyYears: config.historyYears,
        benchmarkMode: config.benchmark.mode,
        benchmarkTargetKeysJson: JSON.stringify(config.benchmark.targetKeys),
        periodMode: config.period.mode,
        rollingWeeks: config.period.mode === 'rolling' ? config.period.rollingWeeks || 52 : 52,
        startDate: config.period.mode === 'fixed' ? new Date(`${config.period.startDate}T00:00:00.000Z`) : null,
        endDate: config.period.mode === 'fixed' ? new Date(`${config.period.endDate}T00:00:00.000Z`) : null,
        comparisonTargetKeysJson: JSON.stringify(config.comparisonTargetKeys),
        targets: {
          create: config.targets.map((target, sortOrder) => ({
            targetKey: target.targetKey,
            symbol: target.code,
            name: target.name,
            kind: target.kind,
            sortOrder,
          })),
        },
      },
      include: { targets: { orderBy: { sortOrder: 'asc' } } },
    })
    return this.serializeStudy(study)
  }

  async updateStudy(userId: string, studyId: string, input: ResearchStudyInput) {
    await ensureUser(prisma, userId)
    await this.findStudy(userId, studyId)
    const config = this.normalizeConfig(input)
    const study = await prisma.$transaction(async (tx) => {
      await tx.relativeRotationResearchStudyTarget.deleteMany({ where: { studyId } })
      return tx.relativeRotationResearchStudy.update({
        where: { id: studyId },
        data: {
          name: config.name,
          market: config.market,
          frequency: config.frequency,
          historyYears: config.historyYears,
          benchmarkMode: config.benchmark.mode,
          benchmarkTargetKeysJson: JSON.stringify(config.benchmark.targetKeys),
          periodMode: config.period.mode,
          rollingWeeks: config.period.mode === 'rolling' ? config.period.rollingWeeks || 52 : 52,
          startDate: config.period.mode === 'fixed' ? new Date(`${config.period.startDate}T00:00:00.000Z`) : null,
          endDate: config.period.mode === 'fixed' ? new Date(`${config.period.endDate}T00:00:00.000Z`) : null,
          comparisonTargetKeysJson: JSON.stringify(config.comparisonTargetKeys),
          targets: {
            create: config.targets.map((target, sortOrder) => ({
              targetKey: target.targetKey,
              symbol: target.code,
              name: target.name,
              kind: target.kind,
              sortOrder,
            })),
          },
        },
        include: { targets: { orderBy: { sortOrder: 'asc' } } },
      })
    })
    return this.serializeStudy(study)
  }

  async deleteStudy(userId: string, studyId: string) {
    await ensureUser(prisma, userId)
    await this.findStudy(userId, studyId)
    await prisma.relativeRotationResearchStudy.delete({ where: { id: studyId } })
    return { deleted: true, studyId }
  }

  private async requestConfig(userId: string, request: ResearchTimelineRequest) {
    if (request.studyId) {
      const study = await this.findStudy(userId, request.studyId)
      return { config: this.configFromStudy(study), study: this.serializeStudy(study) }
    }
    if (!request.study) throw new Error('RRG_RESEARCH_STUDY_REQUIRED: 请提供保存的研究或完整研究配置')
    return { config: this.normalizeConfig(request.study), study: null }
  }

  async getTimeline(userId: string, request: ResearchTimelineRequest) {
    await ensureUser(prisma, userId)
    const { config, study } = await this.requestConfig(userId, request)
    const timeline = await relativeRotationUniverseService.getResearchTimeline(userId, this.toTimelineInput(config))
    return {
      ...timeline,
      study,
      comparisonTargetKeys: config.comparisonTargetKeys,
    }
  }

  async refreshTimeline(userId: string, request: ResearchTimelineRequest) {
    await ensureUser(prisma, userId)
    const { config, study } = await this.requestConfig(userId, request)
    const refresh = await relativeRotationUniverseService.refreshResearchTimeline(userId, this.toTimelineInput(config))
    return {
      ...refresh,
      study,
      comparisonTargetKeys: config.comparisonTargetKeys,
    }
  }
}

export const relativeRotationResearchStudyService = new RelativeRotationResearchStudyService()
