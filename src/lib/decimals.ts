/**
 * Decimal helpers for USDC (6 dec) and Arc native gas (18 dec).
 * Never use 18 for token math — call parseUsdc / formatUsdc instead.
 */

export const USDC_DECIMALS       = 6
export const NATIVE_GAS_DECIMALS = 18

const USDC_FACTOR = 10n ** BigInt(USDC_DECIMALS)

/** Parse a human-readable USDC string ("12.50") → raw bigint (12_500_000n).
 *  Invalid/partial input returns 0n instead of throwing during render. */
export function parseUsdc(value: string): bigint {
  if (!value) return 0n
  const clean = value.trim().replace(/,/g, '')
  // Digits only, optional single decimal point. Rejects "-", "1e3", "abc".
  if (!/^\d*(\.\d*)?$/.test(clean)) return 0n
  const [rawInt = '', fracPart = ''] = clean.split('.')
  const intPart = rawInt || '0'
  if (intPart.length > 60) return 0n
  const frac = fracPart.slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0')
  return BigInt(intPart) * USDC_FACTOR + BigInt(frac || '0')
}

/** Format a raw token amount with arbitrary decimals (e.g. 18-dec vault shares). */
export function formatShares(raw: bigint, decimals: number, dp = 2): string {
  if (decimals <= 0) return raw.toString()
  const factor = 10n ** BigInt(decimals)
  const neg = raw < 0n
  const abs = neg ? -raw : raw
  const int = abs / factor
  const frac = abs % factor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, dp)
  const result = dp > 0 ? `${int}.${fracStr}` : `${int}`
  return neg ? `-${result}` : result
}

/** Format a raw bigint USDC value → human string with `dp` decimal places */
export function formatUsdc(raw: bigint, dp = 2): string {
  const neg = raw < 0n
  const abs = neg ? -raw : raw
  const int = abs / USDC_FACTOR
  const frac = abs % USDC_FACTOR
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, dp)
  const result = dp > 0 ? `${int}.${fracStr}` : `${int}`
  return neg ? `-${result}` : result
}

/** Format with dollar sign and comma grouping */
export function formatUsdcDollar(raw: bigint, dp = 2): string {
  const str = formatUsdc(raw, dp)
  const [intPart, fracPart] = str.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dp > 0 ? `$${grouped}.${fracPart}` : `$${grouped}`
}

/** Short format: 1234567890 → "$1,234.57" */
export function formatUsdcShort(raw: bigint): string {
  return formatUsdcDollar(raw, 2)
}

/** 1e18-scaled APY → percentage string "4.20%" */
export function formatApy(raw1e18: bigint): string {
  // raw is 1e18 = 100%, so divide by 1e16 to get percent*100
  const pct = Number(raw1e18) / 1e16
  return `${pct.toFixed(2)}%`
}

/** Compound APY projection for `principal` USDC over `days` at `apy1e18` */
export function projectYield(principal: bigint, apy1e18: bigint, days: number): bigint {
  if (principal === 0n || apy1e18 === 0n || days <= 0) return principal
  const rate = Number(apy1e18) / 1e18
  const factor = Math.pow(1 + rate, days / 365)
  return BigInt(Math.floor(Number(principal) * factor))
}

/** Truncate an Ethereum address for display */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Pad a hex address to bytes32 (for CCTP mintRecipient) */
export function addrToBytes32(addr: string): `0x${string}` {
  const stripped = addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  return `0x${stripped}`
}
