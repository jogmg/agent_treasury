// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcConfig
/// @notice Single source of truth for resolved Arc + CCTP network constants.
///         Confirmed October 2026 from:
///           - https://docs.arc.io/arc/references/rpc-endpoints
///           - https://developers.circle.com/cctp/references/contract-addresses
///           - Arc Earn Kit docs (Morpho vault addresses)
///
/// @dev     These constants are used by Deploy.s.sol and Configure.s.sol.
///          NEVER hardcode addresses inline — import this file.
///
/// @dev     Arc-specific decimal note:
///          - USDC ERC-20 (all chains):  6 decimals
///          - Arc native gas token:      18 decimals (same underlying pool, different view)
///          Never mix these two decimal counts; use parseUnits(x, 6) for ERC-20 amounts.
library ArcConfig {

    // ── Chain IDs ────────────────────────────────────────────────────────────────
    uint256 constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 constant ARC_MAINNET_CHAIN_ID = 5_042;

    // ── CCTP Domain IDs ──────────────────────────────────────────────────────────
    // Both Arc testnet and mainnet share domain 26.
    uint32  constant ARC_CCTP_DOMAIN      = 26;

    // ── RPC Endpoints ────────────────────────────────────────────────────────────
    // Stored as string constants for off-chain scripts; not used on-chain.
    // ARC_TESTNET_RPC = "https://rpc.testnet.arc.io"
    // ARC_MAINNET_RPC = "https://rpc.mainnet.arc.io"

    // ── USDC ERC-20 (Arc) ────────────────────────────────────────────────────────
    // Same address on both testnet and mainnet.
    address constant ARC_USDC           = 0x3600000000000000000000000000000000000000;
    uint8   constant USDC_DECIMALS      = 6;   // ERC-20 view
    uint8   constant NATIVE_GAS_DECIMALS = 18; // Arc native gas view (same pool, different unit)

    // ── CCTP v2 Contracts (Arc) ─────────────────────────────────────────────────
    // The CCTP v2 addresses are NOT the same on testnet and mainnet. Verified
    // on-chain Oct 2026: the testnet addresses have no code on Arc mainnet.
    // Circle mainnet reference: developers.circle.com/cctp/references/contract-addresses
    address constant ARC_TESTNET_TOKEN_MESSENGER_V2     = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address constant ARC_TESTNET_MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    address constant ARC_MAINNET_TOKEN_MESSENGER_V2     = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address constant ARC_MAINNET_MESSAGE_TRANSMITTER_V2 = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;

    // Backwards-compatible aliases for the currently deployed (testnet) stack.
    address constant ARC_TOKEN_MESSENGER_V2     = ARC_TESTNET_TOKEN_MESSENGER_V2;
    address constant ARC_MESSAGE_TRANSMITTER_V2 = ARC_TESTNET_MESSAGE_TRANSMITTER_V2;

    // ── CCTP finality parameters ────────────────────────────────────────────────
    uint32  constant FAST_FINALITY_THRESHOLD     = 1_000; // soft finality (Fast Transfer)
    uint32  constant STANDARD_FINALITY_THRESHOLD = 2_000; // hard finality (standard)

    // ── Morpho Earn Kit — USDC Vaults (Arc) ──────────────────────────────────────
    //
    // Testnet vault (confirmed, ~4.2% APY as of Oct 2026):
    address constant VAULT_TESTNET_CONSERVATIVE = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;

    // Arc mainnet vaults (verified on-chain Oct 21, 2026; both ERC-4626,
    // asset() == Arc USDC, 18-decimal shares):
    //   Galaxy USDC          2.65% net APY, 89.86M TVL, ~12.24M instant liquidity
    //   Steakhouse Prime USDC 1.97% net APY, 5.11M TVL, ~5.11M instant liquidity
    // Both allocate to the same avatar cirBTC/USDC market (86% LLTV), so the
    // credit risk is effectively identical; Galaxy is the primary vault for
    // deeper liquidity and higher yield.
    address constant VAULT_MAINNET_GALAXY_USDC      = 0x8E357432CC12ff425c36432F312968aEb16112AF;
    address constant VAULT_MAINNET_STEAKHOUSE_USDC  = 0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298;
    address constant VAULT_MAINNET_CONSERVATIVE     = VAULT_MAINNET_GALAXY_USDC;
    address constant VAULT_MAINNET_BALANCED         = VAULT_MAINNET_STEAKHOUSE_USDC;
    address constant VAULT_MAINNET_AGGRESSIVE       = address(0); // not used

    // ── Default treasury parameters ──────────────────────────────────────────────
    uint256 constant DEFAULT_MAX_WITHDRAWAL_DELAY_HOURS = 24;
    uint256 constant DEFAULT_MAX_FEE_BPS                = 1;  // 1 bps fast-transfer fee cap
    uint256 constant DEFAULT_VAULT_ID                   = 1;  // conservative vault

    // ── Minimum deposits per vault tier ──────────────────────────────────────────
    // In USDC ERC-20 units (6 decimals).
    uint256 constant MIN_DEPOSIT_CONSERVATIVE  = 10e6;   // 10 USDC (testnet deployment)
    uint256 constant MIN_DEPOSIT_BALANCED      = 100e6;  // 100 USDC
    uint256 constant MIN_DEPOSIT_AGGRESSIVE    = 500e6;  // 500 USDC

    // Mainnet policy: derive the floor from share price + unit economics, not a
    // hardcoded demo value. At ~1.0007 USDC/share and 2.65% APY, 5 USDC still
    // mints ~4.996e18 shares and earns ~0.13 USDC/year, well above gas. The
    // deploy script also enforces minDeposit >= vault.previewMint(1).
    uint256 constant MIN_DEPOSIT_MAINNET       = 5e6;    // 5 USDC
}
