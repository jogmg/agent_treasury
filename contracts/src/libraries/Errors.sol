// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Errors
/// @notice Custom errors shared across the AgentTreasury system.
///         Gas-cheaper and more informative than revert strings.
library Errors {
    // ── Access control ────────────────────────────────────────────────────────
    /// @notice Caller is not authorized to perform this action.
    error Unauthorized();

    /// @notice Caller is not the trusted CCTP MessageTransmitter.
    error UntrustedCaller();

    /// @notice Caller is not the gateway receiver (CCTPReceiver) or owner.
    error NotReceiver();

    // ── Agent / account ───────────────────────────────────────────────────────
    /// @notice The referenced agent does not have an account in the treasury.
    error AgentNotFound();

    // ── Vault ────────────────────────────────────────────────────────────────
    /// @notice The referenced vaultId does not exist or is not active.
    error VaultNotActive();

    /// @notice Deposit amount is below the vault's minimum deposit.
    error BelowMinDeposit();

    /// @notice Vault ID 0 is reserved / invalid.
    error InvalidVaultId();

    /// @notice A vault with this ID already exists.
    error VaultAlreadyExists();

    // ── Withdrawal ────────────────────────────────────────────────────────────
    /// @notice The withdrawal has already been executed.
    error AlreadyExecuted();

    /// @notice The withdrawal has already been cancelled.
    error AlreadyCancelled();

    /// @notice The withdrawal is not yet executable (e.g. attestation not ready).
    error WithdrawalNotReady();

    /// @notice The withdrawal delay has not yet expired; cannot cancel yet.
    error DelayNotExpired();

    /// @notice The referenced withdrawalId does not exist.
    error WithdrawalNotFound();

    /// @notice Amount requested exceeds the agent's available balance.
    error InsufficientBalance();

    // ── CCTP / domain ─────────────────────────────────────────────────────────
    /// @notice Destination domain is the same as Arc (no-op burn rejected).
    error BadDomain();

    /// @notice The CCTP message is malformed or could not be decoded.
    error MalformedMessage();

    // ── Spending limits ───────────────────────────────────────────────────────
    /// @notice This withdrawal would exceed the agent's spending limit.
    error LimitExceeded();

    // ── Misc ─────────────────────────────────────────────────────────────────
    /// @notice A zero-address was passed where a real address is required.
    error ZeroAddress();

    /// @notice Arithmetic overflow / underflow guard (should not happen with OZ).
    error ArithmeticError();
}
