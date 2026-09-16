import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const evidenceDir = path.resolve(root, 'docs/automation-audits/investment-workflow/WF-7/evidence')
await mkdir(evidenceDir, { recursive: true })

const commands = [
  { id: 'backend_typecheck', cwd: 'backend', command: 'node', args: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { id: 'wf1_foundation', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-foundation'] },
  { id: 'wf2_readiness', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-readiness'] },
  { id: 'wf3_rotation', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-rotation-strategy'] },
  { id: 'wf4_portfolio_policy', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-portfolio-policy'] },
  { id: 'wf5_scenario_comparison', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-scenario-comparison'] },
  { id: 'wf6_cross_page', cwd: 'backend', command: 'npm', args: ['run', 'test:investment-workflow-cross-page'] },
  { id: 'chat_agent_core', cwd: 'backend', command: 'npm', args: ['run', 'test:chat-agent-core'] },
  { id: 'chat_llm_planner', cwd: 'backend', command: 'npm', args: ['run', 'test:chat-llm-planner'] },
  { id: 'trade_gate_contract', cwd: 'backend', command: 'npm', args: ['run', 'test:fivd-r-trade-gate-contract'] },
  { id: 'frontend_production_build', cwd: 'frontend', command: 'npm', args: ['run', 'build'] },
  {
    id: 'strict_trade_readiness',
    cwd: 'backend',
    command: 'npm',
    args: ['run', 'test:trade-action-readiness'],
    expectedBlocked: true,
  },
]

function runCommand(spec) {
  return new Promise((resolve) => {
    const startedAt = new Date()
    const child = spawn(spec.command, spec.args, {
      cwd: path.resolve(root, spec.cwd),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk, stream) => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-160_000)
      stream.write(text)
    }
    child.stdout.on('data', (chunk) => collect(chunk, process.stdout))
    child.stderr.on('data', (chunk) => collect(chunk, process.stderr))
    child.on('error', (error) => resolve({
      ...spec,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      exitCode: null,
      status: 'failed',
      outputTail: error.message,
    }))
    child.on('close', (exitCode) => {
      const strictBoundaryDisclosed = spec.expectedBlocked
        && exitCode === 1
        && /"strictTrade"\s*:\s*true/.test(output)
        && /"manualTradeDraftReady"\s*:\s*false/.test(output)
        && /"formalTradingUnlocked"\s*:\s*false/.test(output)
        && /"autoTradeUnlocked"\s*:\s*false/.test(output)
        && /"canCreateOrder"\s*:\s*false/.test(output)
        && /"orderCreateAllowed"\s*:\s*false/.test(output)
      const passed = spec.expectedBlocked ? strictBoundaryDisclosed : exitCode === 0
      resolve({
        id: spec.id,
        cwd: spec.cwd,
        command: [spec.command, ...spec.args].join(' '),
        expectedOutcome: spec.expectedBlocked ? 'exit_1_with_strict_trade_block_evidence' : 'exit_0',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        exitCode,
        status: passed ? (spec.expectedBlocked ? 'expected_blocked' : 'passed') : 'failed',
        strictBoundaryDisclosed,
        outputTail: output.slice(-12_000),
      })
    })
  })
}

const results = []
for (const command of commands) {
  process.stdout.write(`\n[WF-7] ${command.id}: ${command.command} ${command.args.join(' ')}\n`)
  const result = await runCommand(command)
  results.push(result)
  if (result.status === 'failed') break
}

const passed = results.length === commands.length && results.every((item) => item.status !== 'failed')
const audit = {
  schemaVersion: 'fams.investment-workflow.wf7-command-audit.v1',
  generatedAt: new Date().toISOString(),
  status: passed ? 'passed' : 'failed',
  resultCount: results.length,
  expectedCommandCount: commands.length,
  results,
  interpretation: {
    strictTradeReadinessMustRemainBlocked: true,
    expectedBlockedIsNotFormalTradingReadiness: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  },
}
await writeFile(path.join(evidenceDir, 'wf7-command-results.json'), JSON.stringify(audit, null, 2))
if (!passed) process.exitCode = 1
