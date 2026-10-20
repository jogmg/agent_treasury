/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig } from 'wagmi'
import { fallback, http } from 'viem'
import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  mainnet,
  optimismSepolia,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_RPC_URLS } from './lib/contracts'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [
    arcTestnet,
    // CCTP destination chains. The app switches to one of these only when it
    // is time to submit the destination mint.
    sepolia,
    baseSepolia,
    arbitrumSepolia,
    avalancheFuji,
    optimismSepolia,
    polygonAmoy,
    mainnet, // mainnet needed for ENS resolution
  ],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: fallback(ARC_RPC_URLS.map((url) => http(url))),
    [sepolia.id]: fallback([
      http('https://ethereum-sepolia-rpc.publicnode.com'),
      http('https://rpc.sepolia.org'),
    ]),
    [baseSepolia.id]: http('https://sepolia.base.org'),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
    [avalancheFuji.id]: http('https://api.avax-test.network/ext/bc/C/rpc'),
    [optimismSepolia.id]: http('https://sepolia.optimism.io'),
    [polygonAmoy.id]: http('https://polygon-amoy.drpc.org'),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
