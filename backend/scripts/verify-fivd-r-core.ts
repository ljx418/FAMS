import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const candidate = await analysisService.getFivdRAnalysis('default', {
    positionId: '__fivd_r_contract_missing_position__',
  }) as any

  assert.equal(candidate.schemaVersion, 'fivd.r.analysis.result.v1')
  assert.equal(candidate.scope, 'candidate')
  assert.equal(candidate.orchestrationMode, 'internal_deterministic')
  assert.ok(candidate.runId.startsWith('fivd-r:default:'))
  assert.ok(candidate.evidenceGate, 'candidate result missing evidenceGate')
  assert.equal(candidate.agentTrace?.schemaVersion, 'fivd.r.agent_trace.v1')
  assert.equal(candidate.agentTrace?.status, 'blocked')
  assert.equal(candidate.agentTrace?.scope, 'candidate')
  assert.ok(Array.isArray(candidate.agentTrace?.blockedReasons), 'agentTrace missing blockedReasons')
  assert.ok(Array.isArray(candidate.agentTrace?.evidenceRefs), 'agentTrace missing evidenceRefs')
  assert.equal(candidate.agentTrace?.agents?.length, 5, 'agentTrace must contain five internal agents')
  for (const agent of candidate.agentTrace.agents) {
    assert.equal(typeof agent.sequence, 'number', `${agent.id} missing sequence`)
    assert.ok(Array.isArray(agent.inputRefs), `${agent.id} missing inputRefs`)
    assert.ok(Array.isArray(agent.evidenceRefs), `${agent.id} missing evidenceRefs`)
    assert.ok(Array.isArray(agent.blockedReasons), `${agent.id} missing blockedReasons`)
    assert.ok(Array.isArray(agent.producedArtifacts), `${agent.id} missing producedArtifacts`)
  }
  const validationAgent = candidate.agentTrace.agents.find((agent: any) => agent.id === 'validation_tournament_agent')
  assert.ok(['completed', 'insufficient'].includes(validationAgent?.status), 'validation agent status must reflect latest evidence')
  assert.ok('strategyValidation' in candidate, 'candidate result missing strategyValidation field')
  assert.ok('candidateDisposition' in candidate, 'candidate result missing candidateDisposition field')
  assert.deepEqual(candidate.summary.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])

  const samplePosition = await prisma.position.findFirst({
    where: {
      userId: 'default',
      status: 'open',
      asset: { type: { not: 'cash' } },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })

  let positionChecked = false
  if (samplePosition) {
    assert.ok(samplePosition.asset.symbol, 'sample position missing asset symbol')
    positionChecked = true
  }

  console.log(JSON.stringify({
    ok: true,
    contractStatus: candidate.summary?.status,
    contractBlockedReasons: candidate.summary?.blockedReasons || [],
    positionChecked,
    validationSource: candidate.strategyValidation?.source || null,
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
