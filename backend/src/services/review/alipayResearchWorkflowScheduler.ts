import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '../../db/prisma.js'
import { alipayOneClickReviewService } from './alipayOneClickReviewService.js'
import { ALIPAY_RESEARCH_WORKFLOW_KEY, alipayResearchWorkflowService } from './alipayResearchWorkflowService.js'

const OWNER = `alipay-research:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
const LEASE_MS = 20 * 60 * 1000
const CATCH_UP_MINUTES = 15

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((item) => item.type === type)?.value || ''
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  }
}

function slotMinute(slot: string) {
  const [hour, minute] = slot.split(':').map(Number)
  return hour * 60 + minute
}

class AlipayResearchWorkflowScheduler {
  private task: ScheduledTask | null = null
  private running = false

  private async acquire(name: string, now: Date) {
    await prisma.schedulerLease.upsert({ where: { name }, create: { name }, update: {} })
    const result = await prisma.schedulerLease.updateMany({
      where: { name, OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: OWNER }] },
      data: { leaseOwner: OWNER, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), heartbeatAt: now },
    })
    return result.count > 0
  }

  private async release(name: string, result: unknown) {
    await prisma.schedulerLease.updateMany({
      where: { name, leaseOwner: OWNER },
      data: { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: new Date(), lastRunAt: new Date(), lastResultJson: JSON.stringify(result) },
    })
  }

  async runDue(now = new Date()) {
    if (this.running) return { submitted: false, skipped: true, reason: 'scheduler_already_running', results: [] }
    this.running = true
    try {
      const profiles = await prisma.analysisWorkflowProfile.findMany({
        where: { workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY, isActive: true, schedulerEnabled: true },
      })
      const results: any[] = []
      for (const profile of profiles) {
        const local = localParts(now, profile.timezone)
        if (local.weekday === 'Sat' || local.weekday === 'Sun') {
          results.push({ userId: profile.userId, submitted: false, skipped: true, reason: 'non_trading_weekday' })
          continue
        }
        let slots: string[] = []
        try { slots = JSON.parse(profile.scheduleSlotsJson) } catch { slots = [] }
        const dueSlot = slots.find((slot) => {
          const start = slotMinute(slot)
          return local.minuteOfDay >= start && local.minuteOfDay <= start + CATCH_UP_MINUTES
        })
        if (!dueSlot) continue
        const idempotencyKey = `${profile.userId}:${profile.profileVersion}:${local.date}:${dueSlot}`
        const existing = await prisma.operation.findUnique({
          where: { type_idempotencyKey: { type: 'daily_portfolio_review', idempotencyKey } },
          include: { dailyReviewRun: { select: { id: true } } },
        })
        if (existing) {
          results.push({
            userId: profile.userId,
            slot: dueSlot,
            submitted: false,
            skipped: true,
            reason: 'scheduler_slot_already_processed',
            operationId: existing.id,
            reviewId: existing.dailyReviewRun?.id || null,
          })
          continue
        }
        const authorization = await alipayResearchWorkflowService.checkSnapshotAuthorization(profile.userId, now, profile)
        if (!authorization.valid) {
          results.push({ userId: profile.userId, slot: dueSlot, submitted: false, skipped: true, reason: 'snapshot_authorization_blocked', blockers: authorization.blockers })
          continue
        }
        const leaseName = `${ALIPAY_RESEARCH_WORKFLOW_KEY}:${profile.userId}`
        if (!(await this.acquire(leaseName, now))) {
          results.push({ userId: profile.userId, slot: dueSlot, submitted: false, skipped: true, reason: 'scheduler_lease_not_acquired' })
          continue
        }
        try {
          const sessionType = slotMinute(dueSlot) < 12 * 60 ? 'open' : 'pre_close'
          const result = await alipayOneClickReviewService.start({
            userId: profile.userId,
            sessionType,
            portfolioChangedSinceLastCapture: false,
            idempotencyKey,
            triggerSource: 'scheduler',
          })
          const summary = {
            userId: profile.userId,
            slot: dueSlot,
            submitted: result.started,
            skipped: !result.started,
            reason: result.started ? null : 'workflow_preflight_blocked',
            operationId: result.started ? result.operation?.id || null : null,
            reviewId: result.started ? result.review?.id || null : null,
          }
          await this.release(leaseName, summary)
          results.push(summary)
        } catch (error) {
          const failure = { userId: profile.userId, slot: dueSlot, submitted: false, skipped: false, reason: error instanceof Error ? error.message : String(error) }
          await this.release(leaseName, failure)
          results.push(failure)
        }
      }
      return { submitted: results.some((item) => item.submitted), skipped: results.every((item) => item.skipped), results }
    } finally {
      this.running = false
    }
  }

  async getStatus(userId = 'default') {
    const config = await alipayResearchWorkflowService.getConfig(userId)
    const lease = await prisma.schedulerLease.findUnique({ where: { name: `${ALIPAY_RESEARCH_WORKFLOW_KEY}:${userId}` } })
    let lastResult: unknown = null
    try { lastResult = JSON.parse(lease?.lastResultJson || 'null') } catch { lastResult = null }
    return {
      schemaVersion: 'fams.alipay-research-workflow-scheduler.v1',
      runtime: { taskStarted: Boolean(this.task), localRunning: this.running },
      config: config.scheduler,
      snapshotAuthorization: config.snapshotAuthorization,
      lease,
      lastResult,
    }
  }

  start(logger: { info: (...args: any[]) => void; error: (...args: any[]) => void } = console) {
    if (this.task) return { started: false, reason: 'already_started' }
    this.task = cron.schedule('* * * * 1-5', () => {
      void this.runDue().catch((error) => logger.error({ error }, 'Alipay research workflow scheduler failed'))
    }, { timezone: 'Asia/Shanghai' })
    logger.info({ scheduler: ALIPAY_RESEARCH_WORKFLOW_KEY, poll: '* * * * 1-5', catchUpMinutes: CATCH_UP_MINUTES }, 'Alipay research workflow scheduler started')
    return { started: true, reason: 'started' }
  }

  stop() {
    this.task?.stop()
    this.task = null
  }
}

export const alipayResearchWorkflowScheduler = new AlipayResearchWorkflowScheduler()
