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

    // ── CCTP v2 Contracts (Arc — same on testnet and mainnet) ────────────────────
    address constant ARC_TOKEN_MESSENGER_V2     = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address constant ARC_MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    // ── CCTP Fast Transfer parameters ────────────────────────────────────────────
    uint32  constant FAST_FINALITY_THRESHOLD     = 1_000; // soft finality (Fast Transfer)
    uint32  constant STANDARD_FINALITY_THRESHOLD = 2_000; // hard finality (standard)

    // ── Morpho Earn Kit — USDC Vaults (Arc) ──────────────────────────────────────
    //
    // Testnet vault (confirmed, ~4.2% APY as of Oct 2026):
    address constant VAULT_TESTNET_CONSERVATIVE = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    //
    // Mainnet vault addresses: NOT YET RESOLVED.
    // TODO_RESOLVE: once Morpho deploys vaults on Arc mainnet, fill these in.
    // Source: https://app.morpho.org (filter by Arc network) or Arc Earn Kit docs.
    // Mainnet vaults are intentionally left blank to prevent accidental use.
    address constant VAULT_MAINNET_CONSERVATIVE = address(0); // TODO_RESOLVE
    address constant VAULT_MAINNET_BALANCED     = address(0); // TODO_RESOLVE
    address constant VAULT_MAINNET_AGGRESSIVE   = address(0); // TODO_RESOLVE

    // ── Default treasury parameters ──────────────────────────────────────────────
    uint256 constant DEFAULT_MAX_WITHDRAWAL_DELAY_HOURS = 24;
    uint256 constant DEFAULT_MAX_FEE_BPS                = 1;  // 1 bps fast-transfer fee cap
    uint256 constant DEFAULT_VAULT_ID                   = 1;  // conservative vault

    // ── Minimum deposits per vault tier ──────────────────────────────────────────
    // In USDC ERC-20 units (6 decimals).
    uint256 constant MIN_DEPOSIT_CONSERVATIVE  = 10e6;   // 10 USDC
    uint256 constant MIN_DEPOSIT_BALANCED      = 100e6;  // 100 USDC
    uint256 constant MIN_DEPOSIT_AGGRESSIVE    = 500e6;  // 500 USDC
}
