import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '../../db/prisma.js'
import { operationService } from '../operation/operationService.js'

const NAME = 'industry_crowding_backfill'
const OWNER = `industry-crowding-backfill:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
const LEASE_MS = 10 * 60 * 1000

const enabled = (value: string | undefined, fallback: boolean) => value === undefined
  ? fallback
  : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: value('weekday'),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  }
}

export function resolveIndustryCrowdingBackfillSlot(date: Date, timezone = 'Asia/Shanghai') {
  const local = localParts(date, timezone)
  if (['Sat', 'Sun'].includes(local.weekday)) return { ...local, slot: null }
  if (local.hour === 16 && local.minute === 10) return { ...local, slot: '16:10' }
  if (local.hour === 16 && local.minute === 40) return { ...local, slot: '16:40' }
  return { ...local, slot: null }
}

class IndustryCrowdingBackfillScheduler {
  private task: ScheduledTask | null = null
  private running = false

  getConfig() {
    return {
      // One-time remediation: keep the date explicit so this does not silently
      // become a permanent daily full-universe crawl after tomorrow.
      enabled: enabled(process.env.FAMS_INDUSTRY_CROWDING_BACKFILL_ENABLED, true),
      targetDate: process.env.FAMS_INDUSTRY_CROWDING_BACKFILL_DATE || '2026-09-11',
      cronExpression: process.env.FAMS_INDUSTRY_CROWDING_BACKFILL_CRON || '10,40 16 * * 1-5',
      timezone: process.env.FAMS_INDUSTRY_CROWDING_BACKFILL_TIMEZONE || 'Asia/Shanghai',
      userId: process.env.FAMS_INDUSTRY_CROWDING_BACKFILL_USER_ID || 'default',
      slots: ['16:10', '16:40'],
      batchSize: 6,
      concurrency: 2,
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

  private async release(result: unknown, now = new Date()) {
    await prisma.schedulerLease.updateMany({
      where: { name: NAME, leaseOwner: OWNER },
      data: { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: now, lastRunAt: now, lastResultJson: JSON.stringify(result) },
    })
  }

  async runOnce(reason = 'manual', now = new Date()) {
    const config = this.getConfig()
    if (!config.enabled && reason !== 'manual') return { submitted: false, skipped: true, reason: 'disabled', config }
    if (this.running) return { submitted: false, skipped: true, reason: 'scheduler_already_running', config }
    const local = resolveIndustryCrowdingBackfillSlot(now, config.timezone)
    if (reason !== 'manual' && !local.slot) return { submitted: false, skipped: true, reason: 'outside_backfill_slot', config, local }
    if (reason !== 'manual' && local.date !== config.targetDate) return { submitted: false, skipped: true, reason: 'outside_target_date', config, local }
    const slot = local.slot || 'manual'
    if (!(await this.acquire(now))) return { submitted: false, skipped: true, reason: 'lease_not_acquired', config }
    this.running = true
    try {
      const active = await prisma.operation.findFirst({
        where: { userId: config.userId, type: 'industry_crowding_backfill', status: { in: ['queued', 'running'] }, cancelRequested: false },
        select: { id: true, status: true },
        orderBy: { requestedAt: 'desc' },
      })
      if (active) {
        const summary = { submitted: false, skipped: true, reason: 'active_backfill_operation', activeOperationId: active.id, slot, localDate: local.date }
        await this.release(summary, now)
        return summary
      }
      const operation = await operationService.startIndustryCrowdingBackfillOperation({
        userId: config.userId,
        year: Number(local.date.slice(0, 4)),
        slot,
        executionMode: 'inline',
        createdBy: 'scheduler',
        idempotencyKey: `${NAME}:${config.userId}:${local.date}:${slot}`,
      })
      const summary = { submitted: true, skipped: false, operationId: operation.id || operation.operationId || null, slot, localDate: local.date, targetDate: config.targetDate }
      await this.release(summary, now)
      return summary
    } catch (error) {
      const summary = { submitted: false, skipped: false, error: error instanceof Error ? error.message : String(error), slot, localDate: local.date }
      await this.release(summary, now)
      throw error
    } finally {
      this.running = false
    }
  }

  async getStatus() {
    const lease = await prisma.schedulerLease.findUnique({ where: { name: NAME } })
    let lastResult: unknown = {}
    try { lastResult = JSON.parse(lease?.lastResultJson || '{}') } catch { /* leave empty */ }
    return { name: NAME, config: this.getConfig(), runtime: { localRunning: this.running, taskStarted: Boolean(this.task) }, lease, lastResult }
  }

  start(logger: { info: (...args: any[]) => void; error: (...args: any[]) => void } = console) {
    const config = this.getConfig()
    if (!config.enabled) return { started: false, reason: 'disabled', config }
    if (this.task) return { started: false, reason: 'already_started', config }
    this.task = cron.schedule(config.cronExpression, () => {
      void this.runOnce('cron').catch((error) => logger.error({ error }, 'Industry crowding backfill scheduler failed'))
    }, { timezone: config.timezone })
    logger.info({ scheduler: NAME, config }, 'Industry crowding backfill scheduler started')
    return { started: true, reason: 'started', config }
  }

  stop() {
    this.task?.stop()
    this.task = null
  }
}

export const industryCrowdingBackfillScheduler = new IndustryCrowdingBackfillScheduler()
