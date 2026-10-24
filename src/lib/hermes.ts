/**
 * Browser client for the private Hermes BFF.
 *
 * The BFF owns the SIWE session cookie and the Hermes User API key. This file
 * must never contain a secret: everything here is shipped in the client bundle.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface HermesSession {
  authenticated: boolean
  wallet?: `0x${string}`
  expiresAt?: string
}

export interface SiweChallenge {
  message: string
  nonce: string
  expiresAt: string
}

export interface ChatResponse {
  reply: string
  model: string | null
  usage: Record<string, unknown> | null
}

export class HermesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HermesApiError'
  }
}

const configuredBase = (import.meta.env.VITE_BFF_URL as string | undefined)?.trim()
export const BFF_BASE_URL = configuredBase ? configuredBase.replace(/\/+$/, '') : ''

export const MAX_CHAT_MESSAGES = 20
export const MAX_CHAT_CONTENT = 4_000
export const MAX_CHAT_TOTAL = 12_000

function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('x-hermes-client', 'web')
  if (init.body !== undefined) headers.set('content-type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${BFF_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new HermesApiError(
      0,
      'network_error',
      'Could not reach the Hermes service. Check your connection and try again.',
    )
  }

  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }

  if (!response.ok) {
    const error = data && typeof data === 'object'
      ? (data as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
    throw new HermesApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'request_failed',
      typeof error?.message === 'string'
        ? error.message
        : `Hermes request failed (${response.status}).`,
    )
  }

  return data as T
}

/** Keep the model context bounded and never send empty turns. */
export function trimChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_CHAT_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_CHAT_CONTENT),
    }))

  // Keep the newest turns under the BFF's total-context cap. Sending the
  // per-message max on every turn would otherwise exceed the server limit.
  const kept: ChatMessage[] = []
  let total = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]
    if (!message) continue
    if (kept.length > 0 && total + message.content.length > MAX_CHAT_TOTAL) break
    kept.unshift(message)
    total += message.content.length
  }
  return kept
}

export function getHermesSession(): Promise<HermesSession> {
  return request<HermesSession>('/api/session')
}

export function requestSiweChallenge(address: `0x${string}`): Promise<SiweChallenge> {
  return request<SiweChallenge>('/auth/siwe/nonce', {
    method: 'POST',
    body: JSON.stringify({ address }),
  })
}

export function verifySiwe(
  message: string,
  signature: `0x${string}`,
): Promise<HermesSession & { authenticated: true }> {
  return request<HermesSession & { authenticated: true }>('/auth/siwe/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  })
}

export function logoutHermes(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function sendHermesChat(
  messages: ChatMessage[],
  conversationId?: string,
): Promise<ChatResponse> {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey() },
    body: JSON.stringify({
      messages: trimChatMessages(messages),
      ...(conversationId ? { conversationId } : {}),
    }),
  })
}

export function isHermesApiError(error: unknown): error is HermesApiError {
  return error instanceof HermesApiError
}
