/**
 * Off-chain status for outbound CCTP withdrawals.
 *
 * Source of truth:
 *   1. Arc `WithdrawalRequested` tx hash (from treasury logs)
 *   2. Circle Iris message + attestation for that burn
 *   3. Destination MessageTransmitterV2.usedNonces (raw nonce)
 *   4. Destination `MessageReceived` log for the mint tx link
 *
 * AgentTreasury's legacy `executed` flag is deliberately ignored: the app does
 * not call executeWithdrawal, and that flag does not prove delivery.
 */
import { useQuery } from '@tanstack/react-query'
import { resolveCctpWithdrawal, type CctpWithdrawalStatus } from '../lib/cctp'

export function useCctpWithdrawalStatuses(burnTxs: string[]) {
  const unique = [...new Set(burnTxs.filter((hash) => Boolean(hash)))].sort()
  const query = useQuery({
    queryKey: ['cctp-withdrawals', ...unique],
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map(async (burnTx) => {
          try {
            const status = await resolveCctpWithdrawal(burnTx)
            return [burnTx.toLowerCase(), status] as const
          } catch (error) {
            const fallback: CctpWithdrawalStatus = {
              burnTx,
              sourceDomain: 26,
              destinationDomain: 0,
              phase: 'error',
              attestationComplete: false,
              delivered: false,
              error: error instanceof Error ? error.message : 'Could not resolve this withdrawal.',
            }
            return [burnTx.toLowerCase(), fallback] as const
          }
        }),
      )
      return Object.fromEntries(entries)
    },
    enabled: unique.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  return {
    statuses: query.data ?? {},
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}
