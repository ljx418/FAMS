import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const verificationDir = path.join(root, '.verification')
const backendUrl = process.env.FAMS_BACKEND_URL || 'http://localhost:4000'

const managed = []

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${url}\n${text}`)
  }
  return res.json()
}

async function waitForBackend() {
  for (let i = 0; i < 40; i += 1) {
    try {
      await fetchJson(`${backendUrl}/api/v1/positions?userId=default&status=open&limit=1`)
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error('backend not ready')
}

async function ensureBackend() {
  try {
    await fetchJson(`${backendUrl}/api/v1/positions?userId=default&status=open&limit=1`)
    return
  } catch {
    const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
      cwd: path.join(root, 'backend'),
      stdio: 'ignore',
      shell: false,
      env: { ...process.env, PORT: '4000' },
    })
    managed.push(child)
    await waitForBackend()
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hasFivdRRef(refs) {
  return Array.isArray(refs) && refs.some((ref) => typeof ref === 'string' && ref.includes('fivd-r'))
}

async function main() {
  await fs.mkdir(verificationDir, { recursive: true })
  await ensureBackend()

  const positions = await fetchJson(`${backendUrl}/api/v1/positions?userId=default&status=open&limit=1000`)
  const position = positions.data?.find((item) => item.asset?.type !== 'cash')
  assert(position, 'no non-cash real position found')

  const positionId = position.id
  const refreshed = await fetchJson(`${backendUrl}/api/v1/analysis/position-advice/${positionId}?forceRefresh=true&deep=false`)
  const factSetImpact = refreshed.factSet?.fivdRImpact
  const adviceImpact = refreshed.advice?.fivdRImpact
  const blockedReasons = refreshed.advice?.blockedReasons || []

  assert(factSetImpact?.schemaVersion === 'fivd.r.position_advice_adapter.v1', 'missing fivd-r adapter on factSet')
  assert(adviceImpact?.schemaVersion === 'fivd.r.position_advice_adapter.v1', 'missing fivd-r adapter on advice')
  assert(typeof factSetImpact.valuationMultiplier === 'number', 'valuationMultiplier missing')
  assert(typeof factSetImpact.riskPenaltyMultiplier === 'number', 'riskPenaltyMultiplier missing')
  assert(typeof factSetImpact.evidenceConfidenceMultiplier === 'number', 'evidenceConfidenceMultiplier missing')
  assert(typeof factSetImpact.validationGateMultiplier === 'number', 'validationGateMultiplier missing')
  assert(typeof factSetImpact.combinedMultiplier === 'number', 'combinedMultiplier missing')
  assert(hasFivdRRef(refreshed.factSet?.evidenceRefs), 'factSet evidenceRefs do not include fivd-r ref')
  assert(hasFivdRRef(refreshed.advice?.evidenceRefs), 'advice evidenceRefs do not include fivd-r ref')

  if (blockedReasons.includes('validation_evidence')) {
    assert(factSetImpact.validationGateMultiplier === 0, 'validation gate multiplier must be 0 when validation_evidence is blocked')
    assert(!['ADD', 'REDUCE'].includes(refreshed.advice?.action), 'ADD/REDUCE must be blocked when validation_evidence is present')
  }

  const audit = {
    schemaVersion: 'fivd.r.phase6.position_advice_adapter_acceptance.v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    checked: {
      positionId,
      symbol: refreshed.factSet.position.symbol,
      name: refreshed.factSet.position.name,
      assetType: refreshed.factSet.position.assetType,
      action: refreshed.advice.action,
      targetWeightRange: refreshed.advice.targetWeightRange,
      fivdRImpact: factSetImpact,
      blockedReasons,
      evidenceRefs: refreshed.advice.evidenceRefs.filter((ref) => String(ref).includes('fivd-r')),
    },
  }
  const auditPath = path.join(verificationDir, 'fivd-r-phase6-position-advice-adapter-audit.json')
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2))
  console.log(JSON.stringify({ ok: true, auditPath, checked: audit.checked }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const child of managed) child.kill('SIGTERM')
  })
