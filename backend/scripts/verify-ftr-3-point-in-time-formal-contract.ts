import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

async function latestV2Dir() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    try {
      const audit = await readJson(resolve(root, name, '17_formal_validation_audit.json'))
      if (audit.status === 'passed' && audit.validationProfileSet?.setVersion === '2026-09-15.route-a-point-in-time-v2') return resolve(root, name)
    } catch {
      // Ignore historical and partial runs.
    }
  }
  throw new Error('ftr_3_v2_artifacts_not_found')
}

async function validator(schemaFile: string) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', schemaFile))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  return ajv.compile(schema)
}

async function main() {
  const dir = await latestV2Dir()
  const [walk, parameters, groups, trade, audit] = await Promise.all([
    readJson(resolve(dir, 'walk_forward_replay.json')),
    readJson(resolve(dir, 'parameter_replay.json')),
    readJson(resolve(dir, 'group_stability.json')),
    readJson(resolve(dir, 'tradeability_reconciliation.json')),
    readJson(resolve(dir, '17_formal_validation_audit.json')),
  ])
  const [walkSchema, parameterSchema, groupSchema, tradeSchema, auditSchema] = await Promise.all([
    validator('ftr-3-point-in-time-walk-forward.schema.json'),
    validator('ftr-3-point-in-time-parameter-replay.schema.json'),
    validator('ftr-3-point-in-time-group-stability.schema.json'),
    validator('ftr-3-point-in-time-tradeability.schema.json'),
    validator('ftr-3-formal-validation-audit.schema.json'),
  ])
  for (const [validate, value] of [[walkSchema, walk], [parameterSchema, parameters], [groupSchema, groups], [tradeSchema, trade], [auditSchema, audit]] as const) assert.equal(validate(value), true)

  const cases: Array<[string, any, any]> = []
  const wrongPassedWindows = clone(walk); wrongPassedWindows.walkForward.passedWindowCount = 6; cases.push(['failed_window_hidden', walkSchema, wrongPassedWindows])
  const tooFewParameters = clone(parameters); tooFewParameters.parameterSensitivity.testedParameterSetCount = 4; cases.push(['parameter_count_below_five', parameterSchema, tooFewParameters])
  const fakeCashAttribution = clone(parameters); fakeCashAttribution.parameterSensitivity.cashDividendVariant.countedAsTestedParameterSet = true; cases.push(['qfq_cash_attribution_claimed', parameterSchema, fakeCashAttribution])
  const tooFewPaths = clone(groups); tooFewPaths.groupStability.releaseEffectivePathCount = 52; cases.push(['effective_path_count_drift', groupSchema, tooFewPaths])
  const fixedDenominator = clone(trade); fixedDenominator.denominatorDefinition = 'frozen_candidate_component_x_frozen_validation_window'; cases.push(['dynamic_denominator_replaced', tradeSchema, fixedDenominator])
  const proxyStatus = clone(trade); proxyStatus.paths[0].historicalStatusProxyUsed = true; cases.push(['historical_status_proxy_used', tradeSchema, proxyStatus])
  const missingPath = clone(trade); missingPath.paths.pop(); missingPath.coveredPathCount = 52; cases.push(['tradeability_path_removed', tradeSchema, missingPath])
  const unlocked = clone(audit); unlocked.orderCreateAllowed = true; cases.push(['order_creation_unlocked', auditSchema, unlocked])
  for (const [name, validate, fixture] of cases) assert.equal(validate(fixture), false, `negative fixture unexpectedly passed: ${name}`)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.point_in_time_formal_contract_test.v1',
    status: 'passed', positiveSchemas: 5, negativeFixtures: cases.map(([name]) => name),
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
