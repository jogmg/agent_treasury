import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const here = dirname(resolve(process.argv[1]))
const out = join(here, '..', '..', 'contracts', 'out')

const contracts = {
  MorphoVaultAdapter: 'MorphoVaultAdapter.sol/MorphoVaultAdapter.json',
  CCTPReceiver: 'CCTPReceiver.sol/CCTPReceiver.json',
  AgentTreasury: 'AgentTreasury.sol/AgentTreasury.json',
}

/**
 * @typedef {{ abi: unknown[], bytecode: { object?: string } }} Artifact
 * @typedef {{ abi: unknown[], bytecode: string }} InjectedArtifact
 */

/** @type {Record<string, InjectedArtifact>} */
const artifacts = {}

for (const [key, path] of Object.entries(contracts)) {
  /** @type {Artifact} */
  const json = JSON.parse(readFileSync(join(out, path), 'utf8'))
  const bytecode = json.bytecode.object
  if (!Array.isArray(json.abi) || typeof bytecode !== 'string' || bytecode === '0x') {
    throw new Error(`Missing ABI/bytecode for ${key} — run: forge build`)
  }
  artifacts[key] = { abi: json.abi, bytecode }
  console.log(`${key}: ${json.abi.length} ABI entries, ${(bytecode.length - 2) / 2} bytes`)
}

const template = readFileSync(join(here, 'template.html'), 'utf8')
if (!template.includes('__ARTIFACTS__')) throw new Error('template.html is missing the __ARTIFACTS__ placeholder')

writeFileSync(join(here, 'index.html'), template.replace('__ARTIFACTS__', JSON.stringify(artifacts)))
console.log('Wrote scripts/mainnet-deploy/index.html')
