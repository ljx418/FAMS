import assert from 'node:assert/strict'
import { resolveIndustryCrowdingBackfillSlot } from '../src/services/relative-rotation/industryCrowdingBackfillScheduler.js'

const timezone = 'Asia/Shanghai'
const firstSlot = resolveIndustryCrowdingBackfillSlot(new Date('2026-09-11T08:10:00.000Z'), timezone)
const secondSlot = resolveIndustryCrowdingBackfillSlot(new Date('2026-09-11T08:40:00.000Z'), timezone)
const outsideSlot = resolveIndustryCrowdingBackfillSlot(new Date('2026-09-11T08:25:00.000Z'), timezone)
const weekend = resolveIndustryCrowdingBackfillSlot(new Date('2026-09-12T08:10:00.000Z'), timezone)

assert.equal(firstSlot.date, '2026-09-11')
assert.equal(firstSlot.slot, '16:10')
assert.equal(secondSlot.slot, '16:40')
assert.equal(outsideSlot.slot, null)
assert.equal(weekend.slot, null)

console.log(JSON.stringify({
  schemaVersion: 'fams.relative_rotation.industry_crowding_backfill_scheduler_verification.v1',
  slots: [firstSlot.slot, secondSlot.slot],
  status: 'passed',
}, null, 2))
