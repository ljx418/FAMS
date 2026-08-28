import { browser } from 'wxt/browser'
import type { CommandResult, IntentRoute, OperationCommand } from '../contracts/types'
import { wrapRuntimeMessage } from '../contracts/factories'

export async function sendRoute(route: IntentRoute): Promise<CommandResult> {
  return browser.runtime.sendMessage(wrapRuntimeMessage(route)) as Promise<CommandResult>
}

export async function sendCommand(command: OperationCommand): Promise<CommandResult> {
  return browser.runtime.sendMessage(wrapRuntimeMessage(command)) as Promise<CommandResult>
}
