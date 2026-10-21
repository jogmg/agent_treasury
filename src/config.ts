/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig } from 'wagmi'
import { fallback, http } from 'viem'
import { mainnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_CHAIN, ARC_RPC_URLS } from './lib/contracts'
import { CCTP_DESTINATION_CHAINS } from './lib/cctp'

// Pre-register the chain RPC URL so trace events show the correct chain name immediately.
registerChain(ARC_CHAIN.id, ARC_CHAIN.rpcUrls.default.http[0])

// CCTP destination chains. The app switches to one of these only when it is
// time to submit a destination mint (withdrawals) or a source burn (deposits).
// Ethereum mainnet is always included for ENS resolution.
const destinationChains = Array.from(
  new Map([...CCTP_DESTINATION_CHAINS, mainnet].map((chain) => [chain.id, chain])).values(),
)

const destinationTransports = Object.fromEntries(
  destinationChains.map((chain) => [chain.id, http()]),
)

const chains = [ARC_CHAIN, ...destinationChains] as const

export const config = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    ...destinationTransports,
    [ARC_CHAIN.id]: fallback(ARC_RPC_URLS.map((url) => http(url))),
  },
})
