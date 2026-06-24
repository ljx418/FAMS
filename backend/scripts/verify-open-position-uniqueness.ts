import { prisma } from '../src/db/prisma.js'
import { transactionService } from '../src/services/transaction/transactionService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function backfillOpenKeys() {
  const duplicateGroups = await prisma.position.groupBy({
    by: ['userId', 'assetId'],
    where: { status: 'open' },
    _count: { _all: true },
    having: {
      id: {
        _count: {
          gt: 1,
        },
      },
    } as any,
  })
  if (duplicateGroups.length > 0) {
    throw new Error(`发现重复开放持仓，需先人工合并：${JSON.stringify(duplicateGroups)}`)
  }

  const openPositions = await prisma.position.findMany({
    where: { status: 'open' },
    select: { id: true, userId: true, assetId: true, openKey: true },
  })
  for (const position of openPositions) {
    const expected = `${position.userId}:${position.assetId}`
    if (position.openKey !== expected) {
      await prisma.position.update({
        where: { id: position.id },
        data: { openKey: expected },
      })
    }
  }
}

async function verifyTransactionMerge() {
  const userId = `verify-open-key-${Date.now()}`
  const symbol = `VERIFY${Date.now()}`
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@local.fams`,
      passwordHash: 'verification',
      name: userId,
    },
  })
  const asset = await prisma.asset.create({
    data: {
      symbol,
      name: '开放持仓唯一性验证资产',
      type: 'fund',
      currency: 'CNY',
    },
  })

  try {
    await transactionService.createTransaction({
      userId,
      assetId: asset.id,
      type: 'buy',
      quantity: 100,
      price: 1,
      fee: 0,
    })
    await transactionService.createTransaction({
      userId,
      assetId: asset.id,
      type: 'buy',
      quantity: 50,
      price: 2,
      fee: 0,
    })

    const positions = await prisma.position.findMany({
      where: { userId, assetId: asset.id, status: 'open' },
    })
    if (positions.length !== 1) {
      throw new Error(`Expected one open position, got ${positions.length}`)
    }
    const position = positions[0]
    if (position.openKey !== `${userId}:${asset.id}`) {
      throw new Error(`Unexpected openKey ${position.openKey}`)
    }
    if (position.quantity !== 150 || position.costBasis !== 200) {
      throw new Error(`Unexpected merged position quantity/cost: ${position.quantity}/${position.costBasis}`)
    }
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.asset.deleteMany({ where: { id: asset.id } })
  }
}

async function verifyUserBoundary() {
  await ensureUser(prisma, 'default')
  try {
    await ensureUser(prisma, `unexpected-${Date.now()}`)
    throw new Error('Expected non-default dynamic user creation to be blocked')
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) {
      throw error
    }
  }
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-open-position-uniqueness')
  await backfillOpenKeys()
  await verifyTransactionMerge()
  await verifyUserBoundary()

  const openCount = await prisma.position.count({ where: { status: 'open' } })
  const missingOpenKey = await prisma.position.count({
    where: {
      status: 'open',
      openKey: null,
    },
  })

  console.log(JSON.stringify({
    ok: true,
    openCount,
    missingOpenKey,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
