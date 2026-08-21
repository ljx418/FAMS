import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '../../db/prisma.js'
import { dailyReviewService, type DailyReviewSession } from './dailyReviewService.js'

const NAME = 'daily_portfolio_review'
const OWNER = `daily-review:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
const LEASE_MS = 20 * 60 * 1000

const enabled = (value: string | undefined, fallback: boolean) => value === undefined
  ? fallback
  : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())

function parts(date: Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => formatted.find((item) => item.type === type)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) }
}

export function resolveDailyReviewScheduleSlot(date: Date, timezone = 'Asia/Shanghai') {
  const local = parts(date, timezone)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return { ...local, sessionType: null, slot: null }
  const sessionType: DailyReviewSession = local.hour < 12 ? 'open' : 'pre_close'
  return { ...local, sessionType, slot: sessionType === 'open' ? '09:30' : '14:30' }
}

class DailyReviewScheduler {
  private task: ScheduledTask | null = null
  private running = false

  getConfig() {
    return {
      enabled: enabled(process.env.FAMS_DAILY_REVIEW_SCHEDULER_ENABLED, false),
      cronExpression: process.env.FAMS_DAILY_REVIEW_SCHEDULER_CRON || '30 9,14 * * 1-5',
      timezone: process.env.FAMS_DAILY_REVIEW_SCHEDULER_TIMEZONE || 'Asia/Shanghai',
      userId: process.env.FAMS_DAILY_REVIEW_SCHEDULER_USER_ID || 'default',
      openTime: '09:30',
      preCloseTime: '14:30',
    }
  }

  private async acquire(now: Date) {
    await prisma.schedulerLease.upsert({ where: { name: NAME }, create: { name: NAME }, update: {} })
    const result = await prisma.schedulerLease.updateMany({
      where: { name: NAME, OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: OWNER }] },
      data: { leaseOwner: OWNER, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), heartbeatAt: now },
    })
    return result.count > 0
  }

  private async release(result: unknown) {
    await prisma.schedulerLease.updateMany({
      where: { name: NAME, leaseOwner: OWNER },
      data: { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: new Date(), lastRunAt: new Date(), lastResultJson: JSON.stringify(result) },
    })
  }

  async runOnce(reason = 'manual', now = new Date()) {
    const config = this.getConfig()
    if (!config.enabled && reason !== 'manual') return { submitted: false, skipped: true, reason: 'disabled', config }
    if (this.running) return { submitted: false, skipped: true, reason: 'scheduler_already_running', config }
    const local = resolveDailyReviewScheduleSlot(now, config.timezone)
    if (reason !== 'manual' && (local.weekday === 'Sat' || local.weekday === 'Sun')) return { submitted: false, skipped: true, reason: 'non_trading_weekday', config }
    const sessionType: DailyReviewSession = local.sessionType || (local.hour < 12 ? 'open' : 'pre_close')
    if (!(await this.acquire(now))) return { submitted: false, skipped: true, reason: 'lease_not_acquired', config }
    this.running = true
    try {
      const slot = local.slot || (sessionType === 'open' ? '09:30' : '14:30')
      const result = await dailyReviewService.startReview({
        userId: config.userId,
        sessionType,
        triggerSource: 'scheduler',
        scheduledFor: now,
        idempotencyKey: `${config.userId}:${local.date}:${slot}`,
        executionMode: 'queued',
      })
      const summary = { submitted: true, skipped: false, sessionType, localDate: local.date, operationId: result.operation?.id, reviewId: result.review?.id, reused: result.reused }
      await this.release(summary)
      return summary
    } catch (error) {
      const summary = { submitted: false, skipped: false, error: error instanceof Error ? error.message : String(error) }
      await this.release(summary)
      throw error
    } finally {
      this.running = false
    }
  }

  async getStatus() {
    const lease = await prisma.schedulerLease.findUnique({ where: { name: NAME } })
    let lastResult: unknown = {}
    try { lastResult = JSON.parse(lease?.lastResultJson || '{}') } catch { /* retain empty result */ }
    return { name: NAME, config: this.getConfig(), runtime: { localRunning: this.running, taskStarted: Boolean(this.task) }, lease, lastResult }
  }

  start(logger: { info: (...args: any[]) => void; error: (...args: any[]) => void } = console) {
    const config = this.getConfig()
    if (!config.enabled) return { started: false, reason: 'disabled', config }
    if (this.task) return { started: false, reason: 'already_started', config }
    this.task = cron.schedule(config.cronExpression, () => {
      void this.runOnce('cron').catch((error) => logger.error({ error }, 'Daily review scheduler failed'))
    }, { timezone: config.timezone })
    logger.info({ scheduler: NAME, config }, 'Daily portfolio review scheduler started')
    return { started: true, reason: 'started', config }
  }

  stop() {
    this.task?.stop()
    this.task = null
  }
}

export const dailyReviewScheduler = new DailyReviewScheduler()
