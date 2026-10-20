// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAgentTreasury
/// @notice Public interface for the AgentTreasury contract.
///
/// @dev Two withdrawal paths:
///      - CCTP cross-chain: requestWithdrawal() burns USDC on Arc, mints on destination chain.
///      - Arc-local MVP fast path: deposit() / withdrawLocal() move USDC on Arc directly,
///        no bridging, no CCTP involved.
interface IAgentTreasury {
    struct WithdrawalRequest {
        uint256 id;
        address agent;
        uint256 amount;
        uint32  destinationDomain;
        bytes32 mintRecipient;
        uint256 requestTime;
        uint256 burnedShares;
        bytes   message;      // CCTP message bytes (from MessageSent event)
        bytes32 messageHash;  // for Iris attestation lookup
        bool    executed;
        bool    cancelled;
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// @notice Record an inbound CCTP deposit. USDC already minted to this contract.
    ///         Called by CCTPReceiver (gatewayReceiver) or owner.
    function recordDeposit(address agent, uint256 amount, uint32 sourceDomain) external;

    /// @notice Arc-local fast path: pull `amount` USDC from msg.sender and credit
    ///         it as an Arc deposit. No CCTP, no bridging.
    function deposit(uint256 amount) external;

    // ── Balance queries ────────────────────────────────────────────────────────
    /// @dev getTotalBalance must never revert even when the vault is paused (try/catch).
    function getTotalBalance(address agent) external view returns (uint256);
    function getPrincipal(address agent) external view returns (uint256);
    function getVaultShares(address agent) external view returns (uint256);
    function getDepositsByChain(address agent, uint32 domain) external view returns (uint256);

    // ── Yield management ──────────────────────────────────────────────────────
    function setYieldStrategy(address agent, uint256 vaultId) external;
    function getActiveVault(address agent) external view returns (uint256);
    function rebalance(address agent) external;
    function claimYield(address agent) external;

    // ── Withdrawal: CCTP cross-chain ──────────────────────────────────────────

    /// @notice Burn USDC on Arc via CCTP; mint on destinationDomain.
    ///         Pass type(uint256).max for `amount` to withdraw everything.
    ///         destinationDomain must not equal ARC_DOMAIN.
    function requestWithdrawal(
        address agent,
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient
    ) external returns (uint256 withdrawalId);

    function executeWithdrawal(uint256 withdrawalId) external;
    function cancelWithdrawal(uint256 withdrawalId) external;
    function getWithdrawal(uint256 withdrawalId) external view returns (WithdrawalRequest memory);

    // ── Withdrawal: Arc-local fast path ───────────────────────────────────────

    /// @notice Redeem USDC to msg.sender's wallet on Arc. No CCTP.
    ///         Pass type(uint256).max for `amount` to withdraw everything.
    ///         Spending limits apply.
    function withdrawLocal(uint256 amount) external;

    // ── Admin / safety ────────────────────────────────────────────────────────
    function pause() external;
    function unpause() external;
    function setMorphoAdapter(address adapter) external;
    function setGatewayReceiver(address receiver) external;
    function setMaxWithdrawalDelay(uint256 delayHours) external;
    function setSpendingLimit(address agent, uint256 dailyLimit, uint256 weeklyLimit) external;
    function setKeeper(address keeper) external;
}
