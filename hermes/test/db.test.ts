import { describe, expect, it } from 'vitest'
import { toJsonValue } from '../src/db'

describe('db JSON conversion', () => {
  it('converts bigints and Dates without losing timestamps', () => {
    const value = {
      amount: 5_000_000n,
      createdAt: new Date('2026-10-22T21:00:00.000Z'),
      nested: [{ block: 27_350_000n, at: new Date('2026-10-22T21:01:00.000Z') }],
    }

    expect(toJsonValue(value)).toEqual({
      amount: '5000000',
      createdAt: '2026-10-22T21:00:00.000Z',
      nested: [{ block: '27350000', at: '2026-10-22T21:01:00.000Z' }],
    })
  })
})
