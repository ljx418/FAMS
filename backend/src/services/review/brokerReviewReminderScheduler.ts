import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '../../db/prisma.js'
import { alertService } from '../alert/alertService.js'

const NAME = 'broker_daily_review_reminder'
const OWNER = `broker-review-reminder:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
const LEASE_MS = 5 * 60 * 1000

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

export function resolveBrokerReviewReminderSlot(date: Date, timezone = 'Asia/Shanghai') {
  const local = localParts(date, timezone)
  if (['Sat', 'Sun'].includes(local.weekday)) return { ...local, slot: null, sessionType: null }
  if (local.hour === 9 && local.minute === 40) return { ...local, slot: '09:40', sessionType: 'open' as const }
  if (local.hour === 14 && local.minute === 40) return { ...local, slot: '14:40', sessionType: 'pre_close' as const }
  return { ...local, slot: null, sessionType: null }
}

class BrokerReviewReminderScheduler {
  private task: ScheduledTask | null = null
  private running = false

  getConfig() {
    return {
      enabled: enabled(process.env.FAMS_BROKER_REVIEW_REMINDER_ENABLED, true),
      cronExpression: process.env.FAMS_BROKER_REVIEW_REMINDER_CRON || '40 9,14 * * 1-5',
      timezone: process.env.FAMS_BROKER_REVIEW_REMINDER_TIMEZONE || 'Asia/Shanghai',
      userId: process.env.FAMS_BROKER_REVIEW_REMINDER_USER_ID || 'default',
      slots: ['09:40', '14:40'],
      action: 'reminder_only',
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
    if (!config.enabled && reason !== 'manual') return { created: false, skipped: true, reason: 'disabled', config }
    if (this.running) return { created: false, skipped: true, reason: 'scheduler_already_running', config }
    const local = resolveBrokerReviewReminderSlot(now, config.timezone)
    if (reason !== 'manual' && !local.slot) return { created: false, skipped: true, reason: 'outside_review_slot', config, local }
    const slot = local.slot || (local.hour < 12 ? '09:40' : '14:40')
    const sessionType = local.sessionType || (local.hour < 12 ? 'open' : 'pre_close')
    if (!(await this.acquire(now))) return { created: false, skipped: true, reason: 'lease_not_acquired', config }
    this.running = true
    try {
      const title = `[券商复盘提醒][${local.date}][${slot}]`
      const alert = await alertService.createAlert({
        userId: config.userId,
        type: 'market',
        severity: 'info',
        title,
        message: `${sessionType === 'open' ? '开盘后' : '收盘前'}复盘时间：请上传并确认最新资金持仓及新成交；普通委托、条件单可选但缺失时新增单会要求人工查重。打开 ChatBox 说“现在生成持仓复盘”或进入每日复盘。`,
      })
      const summary = { created: true, skipped: false, alertId: alert.id, title, sessionType, localDate: local.date, slot, action: 'reminder_only' }
      await this.release(summary, now)
      return summary
    } catch (error) {
      const summary = { created: false, skipped: false, error: error instanceof Error ? error.message : String(error) }
      await this.release(summary, now)
      throw error
    } finally {
      this.running = false
    }
  }

  async getStatus() {
    const lease = await prisma.schedulerLease.findUnique({ where: { name: NAME } })
    let lastResult: unknown = {}
    try { lastResult = JSON.parse(lease?.lastResultJson || '{}') } catch { /* keep empty */ }
    return { name: NAME, config: this.getConfig(), runtime: { localRunning: this.running, taskStarted: Boolean(this.task) }, lease, lastResult }
  }

  start(logger: { info: (...args: any[]) => void; error: (...args: any[]) => void } = console) {
    const config = this.getConfig()
    if (!config.enabled) return { started: false, reason: 'disabled', config }
    if (this.task) return { started: false, reason: 'already_started', config }
    this.task = cron.schedule(config.cronExpression, () => {
      void this.runOnce('cron').catch((error) => logger.error({ error }, 'Broker review reminder failed'))
    }, { timezone: config.timezone })
    logger.info({ scheduler: NAME, config }, 'Broker daily review reminder started')
    return { started: true, reason: 'started', config }
  }

  stop() {
    this.task?.stop()
    this.task = null
  }
}

export const brokerReviewReminderScheduler = new BrokerReviewReminderScheduler()
