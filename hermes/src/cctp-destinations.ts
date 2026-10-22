import type { HermesConfig } from './config'

export interface CctpDestination {
  domain: number
  name: string
  chainId: number
  /** Canonical USDC on the destination chain. */
  usdc: `0x${string}`
  /** CCTP v2 MessageTransmitterV2 on the destination chain. */
  transmitter: `0x${string}`
  explorer: string
  rpcUrls: string[]
}

const MAINNET_DESTINATIONS: Record<number, CctpDestination> = {
  0: {
    domain: 0,
    name: 'Ethereum',
    chainId: 1,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://etherscan.io',
    rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  },
  1: {
    domain: 1,
    name: 'Avalanche',
    chainId: 43_114,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://snowtrace.io',
    rpcUrls: ['https://avalanche-c-chain-rpc.publicnode.com'],
  },
  2: {
    domain: 2,
    name: 'Optimism',
    chainId: 10,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://optimistic.etherscan.io',
    rpcUrls: ['https://optimism-rpc.publicnode.com'],
  },
  3: {
    domain: 3,
    name: 'Arbitrum',
    chainId: 42_161,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://arbiscan.io',
    rpcUrls: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  },
  6: {
    domain: 6,
    name: 'Base',
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://basescan.org',
    rpcUrls: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'],
  },
  7: {
    domain: 7,
    name: 'Polygon',
    chainId: 137,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    explorer: 'https://polygonscan.com',
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
  },
}

const TESTNET_DESTINATIONS: Record<number, CctpDestination> = {
  0: {
    domain: 0,
    name: 'Ethereum Sepolia',
    chainId: 11_155_111,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.etherscan.io',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  },
  1: {
    domain: 1,
    name: 'Avalanche Fuji',
    chainId: 43_113,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://testnet.snowtrace.io',
    rpcUrls: ['https://avalanche-fuji-c-chain-rpc.publicnode.com'],
  },
  2: {
    domain: 2,
    name: 'OP Sepolia',
    chainId: 11_155_420,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia-optimism.etherscan.io',
    rpcUrls: ['https://optimism-sepolia-rpc.publicnode.com'],
  },
  3: {
    domain: 3,
    name: 'Arbitrum Sepolia',
    chainId: 421_614,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.arbiscan.io',
    rpcUrls: ['https://arbitrum-sepolia-rpc.publicnode.com'],
  },
  6: {
    domain: 6,
    name: 'Base Sepolia',
    chainId: 84_532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.basescan.org',
    rpcUrls: ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'],
  },
  7: {
    domain: 7,
    name: 'Polygon Amoy',
    chainId: 80_002,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://amoy.polygonscan.com',
    rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com'],
  },
}

export function getDestinations(config: HermesConfig): Record<number, CctpDestination> {
  return config.network.network === 'mainnet' ? MAINNET_DESTINATIONS : TESTNET_DESTINATIONS
}

export function getCctpDestination(
  config: HermesConfig,
  domain: number,
): CctpDestination | undefined {
  return getDestinations(config)[domain]
}
