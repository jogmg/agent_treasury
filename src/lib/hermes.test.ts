import { describe, expect, it } from 'vitest'
import {
  MAX_CHAT_CONTENT,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL,
  intentReviewTab,
  trimChatMessages,
  type ChatMessage,
} from './hermes'

describe('Hermes chat client helpers', () => {
  it('drops blank messages and keeps the most recent bounded context', () => {
    const messages: ChatMessage[] = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index}`,
    }))
    messages.splice(2, 0, { role: 'user', content: '   ' })

    const trimmed = trimChatMessages(messages)
    expect(trimmed).toHaveLength(MAX_CHAT_MESSAGES)
    expect(trimmed[0]?.content).toBe('message 5')
    expect(trimmed[trimmed.length - 1]?.content).toBe(`message ${MAX_CHAT_MESSAGES + 4}`)
    expect(trimmed.some((message) => message.content.trim() === '')).toBe(false)
  })

  it('truncates a message to the server-side per-message limit', () => {
    const trimmed = trimChatMessages([
      { role: 'user', content: 'x'.repeat(MAX_CHAT_CONTENT + 42) },
    ])
    expect(trimmed).toHaveLength(1)
    expect(trimmed[0]?.content).toHaveLength(MAX_CHAT_CONTENT)
  })

  it('keeps the newest turns under the total context cap', () => {
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, index) => ({
      role: 'user',
      content: `${index}:${'x'.repeat(MAX_CHAT_CONTENT - 2)}`,
    }))
    const trimmed = trimChatMessages(messages)
    expect(trimmed.length).toBeLessThan(messages.length)
    expect(trimmed.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(
      MAX_CHAT_TOTAL,
    )
    expect(trimmed[trimmed.length - 1]?.content.startsWith('5:')).toBe(true)
  })

  it('preserves roles and an empty conversation', () => {
    expect(trimChatMessages([])).toEqual([])
    expect(
      trimChatMessages([
        { role: 'user', content: 'balance?' },
        { role: 'assistant', content: 'zero' },
      ]),
    ).toEqual([
      { role: 'user', content: 'balance?' },
      { role: 'assistant', content: 'zero' },
    ])
  })

  it('sends only role and content, never draft metadata', () => {
    const trimmed = trimChatMessages([
      {
        role: 'assistant',
        content: 'Ready to review.',
        actionError: 'not forwarded',
        intent: {
          id: 'int_x',
          wallet: '0x0000000000000000000000000000000000000000',
          kind: 'deposit',
          chainId: 5042,
          to: '0x0000000000000000000000000000000000000000',
          data: '0x',
          value: '0',
          amount: '5000000',
          isMax: false,
          destinationDomain: null,
          mintRecipient: null,
          status: 'draft',
          simulation: { ok: true },
          txHash: null,
          expiresAt: '2026-10-24T00:00:00.000Z',
          createdAt: '2026-10-24T00:00:00.000Z',
          updatedAt: '2026-10-24T00:00:00.000Z',
          submittedAt: null,
        },
      },
    ])
    expect(trimmed).toEqual([{ role: 'assistant', content: 'Ready to review.' }])
  })

  it('routes draft kinds to the existing review tabs', () => {
    expect(intentReviewTab('deposit')).toBe('deposit')
    expect(intentReviewTab('withdrawLocal')).toBe('withdraw')
    expect(intentReviewTab('cctpWithdraw')).toBe('withdraw')
  })
})
