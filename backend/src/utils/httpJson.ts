import axios, { AxiosRequestConfig } from 'axios'
import { execFile } from 'node:child_process'
import { URLSearchParams } from 'node:url'

export function compactHttpError(error: unknown) {
  const anyError = error as any
  return {
    name: anyError?.name || 'Error',
    message: anyError?.message || String(error),
    code: anyError?.code || null,
    status: anyError?.response?.status || anyError?.status || null,
    statusText: anyError?.response?.statusText || null,
    url: anyError?.config?.url || null,
  }
}

function buildUrl(url: string, params?: Record<string, unknown>) {
  if (!params || Object.keys(params).length === 0) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }
  return `${url}${url.includes('?') ? '&' : '?'}${search.toString().replace(/%2C/g, ',')}`
}

async function curlText(method: 'GET' | 'POST', url: string, options: AxiosRequestConfig = {}): Promise<string> {
  const timeoutSeconds = Math.max(1, Math.ceil((options.timeout || 10000) / 1000))
  // Some public market-data nodes leave a proxy socket half-open unless curl
  // has a bounded connection phase.  --max-time alone retries the same stuck
  // state and made an otherwise available alternate node look unavailable.
  const connectTimeoutSeconds = Math.max(1, Math.min(5, timeoutSeconds))
  const args = ['-sS', '-L', '--connect-timeout', String(connectTimeoutSeconds), '--max-time', String(timeoutSeconds), '-X', method]
  const headers = options.headers as Record<string, string> | undefined

  for (const [key, value] of Object.entries(headers || {})) {
    if (value !== undefined) {
      args.push('-H', `${key}: ${value}`)
    }
  }

  if (options.data !== undefined) {
    args.push('--data', typeof options.data === 'string' ? options.data : JSON.stringify(options.data))
  }

  args.push(buildUrl(url, options.params as Record<string, unknown> | undefined))

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await new Promise<string>((resolve, reject) => {
        execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.trim() || error.message))
            return
          }

          resolve(stdout)
        })
      })
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('curl request failed')
}

async function curlJson<T>(method: 'GET' | 'POST', url: string, options: AxiosRequestConfig = {}): Promise<T> {
  const payload = await curlText(method, url, options)
  try {
    return JSON.parse(payload) as T
  } catch {
    throw new Error(`HTTP JSON parse failed: ${payload.slice(0, 200)}`)
  }
}

export async function getJson<T>(url: string, options: AxiosRequestConfig = {}): Promise<T> {
  try {
    const response = await axios.get<T>(url, options)
    return response.data
  } catch (error) {
    return curlJson<T>('GET', url, options)
  }
}

export async function getJsonWithCurlOnly<T>(url: string, options: AxiosRequestConfig = {}): Promise<T> {
  return curlJson<T>('GET', url, options)
}

export async function getTextWithCurlOnly(url: string, options: AxiosRequestConfig = {}): Promise<string> {
  return curlText('GET', url, options)
}

export async function postJson<T>(url: string, data: unknown, options: AxiosRequestConfig = {}): Promise<T> {
  try {
    const response = await axios.post<T>(url, data, options)
    return response.data
  } catch (error) {
    return curlJson<T>('POST', url, { ...options, data })
  }
}
