import { browser } from 'wxt/browser'
import type { CommandResult, IntentRoute, OperationCommand } from '../contracts/types'
import { createOperationPollMessage, wrapRuntimeMessage } from '../contracts/factories'
import type { BackgroundCommandResponse } from '../adapters/fams/types'

export async function sendRoute(route: IntentRoute): Promise<CommandResult> {
  return browser.runtime.sendMessage(wrapRuntimeMessage(route)) as Promise<CommandResult>
}

export async function sendCommand(command: OperationCommand): Promise<CommandResult> {
  const response = await sendCommandDetailed(command)
  return response.commandResult
}

export async function sendCommandDetailed(command: OperationCommand): Promise<BackgroundCommandResponse> {
  return browser.runtime.sendMessage(wrapRuntimeMessage(command)) as Promise<BackgroundCommandResponse>
}

export async function startOperationPolling(workspaceId: string, operationId: string): Promise<CommandResult> {
  return browser.runtime.sendMessage(createOperationPollMessage(workspaceId, operationId)) as Promise<CommandResult>
}
