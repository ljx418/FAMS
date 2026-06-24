import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '../../db/prisma.js'
import { operationService } from './operationService.js'

const SCHEDULER_NAME = 'factset_refresh'
const SCHEDULER_LEASE_MS = 10 * 60 * 1000
const SCHEDULER_OWNER = `fams-scheduler:${process.pid}:${Math.random().toString(36).slice(2, 10)}`

interface FactsetRefreshSchedulerConfig {
  enabled: boolean
  cronExpression: string
  timezone: string
  userId: string
  horizonMinutes: number
  limit: number
  allowTradingHours: boolean
  dividendLowVolDailyScanEnabled: boolean
  dividendLowVolDailyScanLimit: number
  dividendLowVolDailyScanAfterMinutes: number
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

const parseNumberEnv = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const getTimeParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return {
    weekday: part('weekday'),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  }
}

const isAshareTradingWindow = (date: Date, timezone: string) => {
  const { weekday, hour, minute } = getTimeParts(date, timezone)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const minutes = hour * 60 + minute
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30
}

const isAshareWeekday = (date: Date, timezone: string) => {
  const { weekday } = getTimeParts(date, timezone)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

const localDateKey = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const localMinutes = (date: Date, timezone: string) => {
  const { hour, minute } = getTimeParts(date, timezone)
  return hour * 60 + minute
}

class FactsetRefreshScheduler {
  private task: ScheduledTask | null = null
  private running = false

  private getLeaseExpiry(now = new Date()) {
    return new Date(now.getTime() + SCHEDULER_LEASE_MS)
  }

  private async hasActiveFivdRRefresh() {
    const active = await prisma.operation.findFirst({
      where: {
        type: 'fivd_r_portfolio_refresh',
        status: { in: ['queued', 'running'] },
        cancelRequested: false,
      },
      select: { id: true, status: true, requestedAt: true },
      orderBy: { requestedAt: 'desc' },
    })
    return active
  }

  async acquireLease(now = new Date()) {
    await prisma.schedulerLease.upsert({
      where: { name: SCHEDULER_NAME },
      create: {
        name: SCHEDULER_NAME,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
      update: {},
    })

    const result = await prisma.schedulerLease.updateMany({
      where: {
        name: SCHEDULER_NAME,
        OR: [
          { leaseOwner: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
          { leaseOwner: SCHEDULER_OWNER },
        ],
      },
      data: {
        leaseOwner: SCHEDULER_OWNER,
        leaseExpiresAt: this.getLeaseExpiry(now),
        heartbeatAt: now,
      },
    })

    return result.count > 0
  }

  async releaseLease(result: Record<string, unknown> = {}) {
    await prisma.schedulerLease.updateMany({
      where: {
        name: SCHEDULER_NAME,
        leaseOwner: SCHEDULER_OWNER,
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        lastRunAt: new Date(),
        lastResultJson: JSON.stringify(result),
      },
    })
  }

  async getStatus(now = new Date()) {
    const config = this.getConfig()
    const lease = await prisma.schedulerLease.findUnique({ where: { name: SCHEDULER_NAME } })
    const lastResult = (() => {
      if (!lease?.lastResultJson) return {}
      try {
        return JSON.parse(lease.lastResultJson)
      } catch {
        return {}
      }
    })()

    return {
      name: SCHEDULER_NAME,
      config,
      runtime: {
        localRunning: this.running,
        taskStarted: Boolean(this.task),
      },
      lease: lease ? {
        leaseOwner: lease.leaseOwner,
        leaseExpiresAt: lease.leaseExpiresAt,
        heartbeatAt: lease.heartbeatAt,
        locked: Boolean(lease.leaseOwner && lease.leaseExpiresAt && lease.leaseExpiresAt > now),
        expired: Boolean(lease.leaseExpiresAt && lease.leaseExpiresAt <= now),
      } : null,
      lastRunAt: lease?.lastRunAt || null,
      lastResult,
    }
  }

  getConfig(): FactsetRefreshSchedulerConfig {
    return {
      enabled: parseBooleanEnv(process.env.FAMS_FACTSET_SCHEDULER_ENABLED, true),
      cronExpression: process.env.FAMS_FACTSET_SCHEDULER_CRON || '*/15 * * * *',
      timezone: process.env.FAMS_FACTSET_SCHEDULER_TIMEZONE || 'Asia/Shanghai',
      userId: process.env.FAMS_FACTSET_SCHEDULER_USER_ID || 'default',
      horizonMinutes: parseNumberEnv(process.env.FAMS_FACTSET_SCHEDULER_HORIZON_MINUTES, 60),
      limit: Math.max(1, parseNumberEnv(process.env.FAMS_FACTSET_SCHEDULER_LIMIT, 20)),
      allowTradingHours: parseBooleanEnv(process.env.FAMS_FACTSET_SCHEDULER_ALLOW_TRADING_HOURS, false),
      dividendLowVolDailyScanEnabled: parseBooleanEnv(process.env.FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_ENABLED, true),
      dividendLowVolDailyScanLimit: Math.max(1, parseNumberEnv(process.env.FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_LIMIT, 6000)),
      dividendLowVolDailyScanAfterMinutes: Math.max(15 * 60 + 31, parseNumberEnv(process.env.FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_AFTER_MINUTES, 16 * 60)),
    }
  }

  start(logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void } = console) {
    const config = this.getConfig()
    if (!config.enabled) {
      logger.info({ scheduler: 'factset_refresh' }, 'Factset refresh scheduler disabled')
      return { started: false, reason: 'disabled', config }
    }
    if (this.task) {
      return { started: false, reason: 'already_started', config }
    }

    this.task = cron.schedule(
      config.cronExpression,
      () => {
        void this.runOnce('cron_tick', logger)
      },
      { timezone: config.timezone }
    )
    logger.info({ scheduler: 'factset_refresh', config }, 'Factset refresh scheduler started')
    return { started: true, reason: 'started', config }
  }

  stop() {
    if (!this.task) return
    this.task.stop()
    this.task = null
  }

  async runOnce(
    reason = 'manual',
    logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void } = console,
    now = new Date()
  ): Promise<any> {
    const config = this.getConfig()
    if (!config.enabled && reason !== 'manual') {
      return { submitted: false, skipped: true, reason: 'disabled', config }
    }
    if (this.running) {
      return { submitted: false, skipped: true, reason: 'scheduler_already_running', config }
    }
    if (!config.allowTradingHours && isAshareTradingWindow(now, config.timezone)) {
      logger.info({ scheduler: 'factset_refresh', reason, now: now.toISOString() }, 'Factset refresh scheduler skipped during trading window')
      return { submitted: false, skipped: true, reason: 'trading_window', config }
    }
    const activeFivdR = await this.hasActiveFivdRRefresh()
    if (activeFivdR) {
      logger.info({
        scheduler: 'factset_refresh',
        reason,
        activeOperationId: activeFivdR.id,
        activeStatus: activeFivdR.status,
      }, 'Factset refresh scheduler skipped while FIVD-R refresh is active')
      return {
        submitted: false,
        skipped: true,
        reason: 'fivd_r_refresh_active',
        activeOperationId: activeFivdR.id,
        config,
      }
    }
    const leaseAcquired = await this.acquireLease(now)
    if (!leaseAcquired) {
      return { submitted: false, skipped: true, reason: 'scheduler_lease_not_acquired', config }
    }

    this.running = true
    let tickResult: Record<string, unknown> = { reason: 'unknown' }
    try {
      const result = await operationService.scheduleDueFactsetRefresh({
        userId: config.userId,
        scope: 'all',
        horizonMinutes: config.horizonMinutes,
        limit: config.limit,
      })
      logger.info({
        scheduler: 'factset_refresh',
        reason,
        submitted: result.submitted,
        resultReason: result.reason,
        operationId: result.operation?.id || null,
        due: result.due,
      }, 'Factset refresh scheduler tick completed')
      tickResult = {
        submitted: result.submitted,
        reason: result.reason,
        operationId: result.operation?.id || null,
        dueCount: result.due.dueCount,
      }
      const dividendLowVolDailyScan = await this.maybeScheduleDividendLowVolDailyScan(config, now)
      tickResult = {
        ...tickResult,
        dividendLowVolDailyScan,
      }
      return { ...result, dividendLowVolDailyScan, skipped: false, schedulerReason: reason, config }
    } catch (error) {
      tickResult = { reason: 'failed', error: error instanceof Error ? error.message : String(error) }
      logger.error({
        scheduler: 'factset_refresh',
        reason,
        error: error instanceof Error ? error.message : String(error),
      }, 'Factset refresh scheduler tick failed')
      throw error
    } finally {
      await this.releaseLease(tickResult).catch(() => undefined)
      this.running = false
    }
  }

  private async maybeScheduleDividendLowVolDailyScan(config: FactsetRefreshSchedulerConfig, now: Date) {
    if (!config.dividendLowVolDailyScanEnabled) {
      return { submitted: false, skipped: true, reason: 'disabled' }
    }
    if (!isAshareWeekday(now, config.timezone)) {
      return { submitted: false, skipped: true, reason: 'non_trading_day' }
    }
    if (localMinutes(now, config.timezone) < config.dividendLowVolDailyScanAfterMinutes) {
      return { submitted: false, skipped: true, reason: 'before_after_close_window' }
    }
    const tradeDate = localDateKey(now, config.timezone)
    const idempotencyKey = `dividend-low-vol-daily-scan:${config.userId}:${tradeDate}:all_a`
    const operation = await operationService.startDividendLowVolDailyScanOperation({
      userId: config.userId,
      universe: 'all_a',
      limit: config.dividendLowVolDailyScanLimit,
      executionMode: 'queued',
      createdBy: 'scheduler',
      idempotencyKey,
    })
    return {
      submitted: true,
      skipped: false,
      reason: 'submitted_or_existing',
      tradeDate,
      operationId: operation?.id || operation?.operationId || null,
      idempotencyKey,
      limit: config.dividendLowVolDailyScanLimit,
    }
  }
}

export const factsetRefreshScheduler = new FactsetRefreshScheduler()
export { isAshareTradingWindow, localDateKey }
