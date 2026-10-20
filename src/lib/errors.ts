export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string; shortMessage?: string })?.shortMessage
    || (error as { message?: string })?.message
    || ''
  const lower = msg.toLowerCase()

  if (lower.includes('user rejected') || lower.includes('user denied') || (error as { code?: number })?.code === 4001)
    return 'Transaction cancelled.'
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance'))
    return 'Insufficient balance for gas. Please add funds.'
  if (lower.includes('limitexceeded') || lower.includes('limit exceeded'))
    return 'Spending limit exceeded. Check your daily/weekly cap in Settings.'
  if (lower.includes('baddomain'))
    return 'Cannot withdraw to Arc domain — use the local withdraw instead.'
  if (lower.includes('insufficientbalance') || lower.includes('insufficient balance'))
    return 'Insufficient treasury balance for this withdrawal.'
  if (lower.includes('agentnotfound'))
    return 'No treasury account found. Make a deposit first.'
  if (lower.includes('belowmindeposit'))
    return 'Amount is below the vault minimum deposit (10 USDC).'
  if (lower.includes('reverted'))
    return `Transaction reverted${msg.includes(':') ? ': ' + msg.split(':').pop()?.trim() : '.'}`
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('fetch'))
    return 'Network error. Check your connection and retry.'

  return msg ? msg.slice(0, 120) : 'Something went wrong. Please try again.'
}
