import { useCallback, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import {
  getHermesSession,
  isHermesApiError,
  requestSiweChallenge,
  sendHermesChat,
  verifySiwe,
  type ChatMessage,
} from '../lib/hermes'

function newConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function friendlyError(error: unknown): string {
  if (isHermesApiError(error)) {
    if (error.code === 'chat_unconfigured') {
      return 'Hermes chat is not connected yet. The read-only treasury API is still available.'
    }
    if (error.code === 'rate_limited') {
      return 'You are sending messages too quickly. Try again in a moment.'
    }
    if (error.code === 'unauthorized') {
      return 'Your Hermes session expired. Send the message again to sign in.'
    }
    if (error.status === 404) {
      return 'Hermes is not available on this deployment yet.'
    }
    return error.message
  }
  const message = error instanceof Error ? error.message : ''
  if (/reject|denied|cancel/i.test(message)) {
    return 'Signature request cancelled.'
  }
  return 'Could not reach Hermes. Try again.'
}

export interface HermesChat {
  messages: ChatMessage[]
  busy: boolean
  error: string | null
  send: (content: string) => Promise<void>
  clear: () => void
}

export function useHermesChat(): HermesChat {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionWallet = useRef<string | null>(null)
  const conversationId = useRef(newConversationId())
  const busyRef = useRef(false)

  const ensureSession = useCallback(async (): Promise<`0x${string}`> => {
    if (!address) throw new Error('Connect a wallet first.')
    if (sessionWallet.current?.toLowerCase() === address.toLowerCase()) return address

    const existing = await getHermesSession()
    if (
      existing.authenticated &&
      existing.wallet?.toLowerCase() === address.toLowerCase()
    ) {
      sessionWallet.current = address
      return address
    }

    const challenge = await requestSiweChallenge(address)
    const signature = await signMessageAsync({ message: challenge.message })
    await verifySiwe(challenge.message, signature)
    sessionWallet.current = address
    return address
  }, [address, signMessageAsync])

  const send = useCallback(
    async (content: string): Promise<void> => {
      const text = content.trim()
      if (!text || busyRef.current) return
      if (!address) {
        setError('Connect a wallet to ask Hermes.')
        return
      }

      busyRef.current = true
      const userMessage: ChatMessage = { role: 'user', content: text }
      const next = [...messages, userMessage]
      setMessages(next)
      setBusy(true)
      setError(null)

      try {
        await ensureSession()
        const response = await sendHermesChat(next, conversationId.current)
        setMessages((current) => [...current, { role: 'assistant', content: response.reply }])
      } catch (cause) {
        if (isHermesApiError(cause) && cause.code === 'unauthorized') {
          sessionWallet.current = null
        }
        setError(friendlyError(cause))
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [address, ensureSession, messages],
  )

  const clear = useCallback(() => {
    setMessages([])
    setError(null)
    conversationId.current = newConversationId()
  }, [])

  return { messages, busy, error, send, clear }
}
