/**
 * Complete a CCTP v2 transfer on Ethereum Sepolia.
 *
 * The AgentTreasury burns USDC on Arc and emits a CCTP message. Circle Iris
 * attests it; this script fetches that attestation and calls receiveMessage()
 * on Sepolia's MessageTransmitterV2.
 *
 * Usage:
 *   npx tsx scripts/complete-cctp.ts <sourceTxHash>              # dry run
 *   SEPOLIA_RPC_URL=... PRIVATE_KEY=... npx tsx scripts/complete-cctp.ts <sourceTxHash> --send
 *
 * Never commit or paste the private key into a file. This script only reads it
 * from the environment. Sending requires an explicit --send flag; a dry run
 * prints the calldata so a browser wallet can submit it manually.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

interface IrisMessageBody {
  mintRecipient?: string
  amount?: string
}

interface IrisMessage {
  message: `0x${string}`
  attestation?: `0x${string}` | 'PENDING'
  status?: string
  cctpVersion?: number
  decodedMessage?: {
    destinationDomain?: string
    nonce?: string
    decodedMessageBody?: IrisMessageBody
  }
}

interface IrisResponse {
  messages?: IrisMessage[]
}

const sourceTx = process.argv[2]
if (!sourceTx || !/^0x[0-9a-fA-F]{64}$/.test(sourceTx)) {
  console.error('Usage: bun scripts/complete-cctp.ts <sourceTxHash>')
  process.exit(1)
}

const SOURCE_DOMAIN = 26 // Arc
const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const
const IRIS = `https://iris-api-sandbox.circle.com/v2/messages/${SOURCE_DOMAIN}?transactionHash=${sourceTx}`

const abi = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
])

const res = await fetch(IRIS)
if (!res.ok) {
  console.error(`Iris HTTP ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const json = (await res.json()) as IrisResponse
const entry = json.messages?.find(
  (m) => m.decodedMessage?.destinationDomain === '0' && m.cctpVersion === 2,
)
if (!entry) {
  console.error('No destination-domain-0 message in the Iris response.')
  process.exit(1)
}
const attestation = entry.attestation
if (entry.status !== 'complete' || !attestation || attestation === 'PENDING') {
  console.log(`Attestation status: ${entry.status ?? 'pending'}. Try again shortly.`)
  process.exit(2)
}

console.log('sourceTx        ', sourceTx)
console.log('destination     ', 'Ethereum Sepolia (domain 0)')
console.log('mintRecipient   ', entry.decodedMessage?.decodedMessageBody?.mintRecipient)
console.log('amount (6 dec)  ', entry.decodedMessage?.decodedMessageBody?.amount)
console.log('nonce           ', entry.decodedMessage?.nonce)
console.log('message bytes   ', (entry.message.length - 2) / 2)
console.log('attestation     ', (attestation.length - 2) / 2, 'bytes')

const data = encodeFunctionData({
  abi,
  functionName: 'receiveMessage',
  args: [entry.message, attestation],
})

console.log('\nSepolia MessageTransmitterV2:', MESSAGE_TRANSMITTER_V2)
console.log('calldata:\n', data)

const shouldSend = process.argv.includes('--send')
if (!shouldSend) {
  console.log('\nDry run only. To submit, add --send and a funded Sepolia key in PRIVATE_KEY.')
  process.exit(0)
}

const key = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
if (!key) {
  console.error('\nNo PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) set. Cannot send.')
  process.exit(1)
}

const normalizedKey = key.startsWith('0x') ? key : `0x${key}`
const account = privateKeyToAccount(normalizedKey as `0x${string}`)
const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpc) })

const balance = await publicClient.getBalance({ address: account.address })
console.log('\nSender          ', account.address)
console.log('Sepolia ETH     ', formatEther(balance))
if (balance === 0n) {
  console.error('Sender has no Sepolia ETH. Fund it with testnet gas first.')
  process.exit(1)
}

console.log('Sending receiveMessage...')
const hash = await walletClient.sendTransaction({
  to: MESSAGE_TRANSMITTER_V2,
  data,
})
console.log('tx              ', hash)

const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log('status          ', receipt.status)
console.log('block           ', Number(receipt.blockNumber))
if (receipt.status !== 'success') {
  console.error('receiveMessage reverted. The attestation may be expired; use POST /v2/reattest with the nonce.')
  process.exit(1)
}
console.log('Destination mint complete.')
