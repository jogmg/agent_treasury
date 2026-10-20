// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICCTPReceiver
/// @notice Interface for the CCTP v2 hook receiver that bridges inbound USDC to AgentTreasury.
interface ICCTPReceiver {
    // ── CCTP v2 hook interface ────────────────────────────────────────────────
    /// @notice Called by MessageTransmitterV2 when a message with this contract as mintRecipient
    ///         is received and the USDC has been minted.
    ///         Ref: Circle CCTP v2 hook / IMessageHandlerV2 pattern.
    /// @param sourceDomain  The CCTP domain of the originating chain.
    /// @param sender        The address on the source chain that initiated the burn.
    /// @param messageBody   ABI-encoded body from the CCTP message.
    /// @return              Must return `true` to acknowledge the hook.
    function handleReceiveMessage(
        uint32  sourceDomain,
        bytes32 sender,
        bytes   calldata messageBody
    ) external returns (bool);

    // ── Admin ────────────────────────────────────────────────────────────────
    function setTreasury(address treasury) external;
    function setDefaultBeneficiary(address beneficiary) external;
    function setTrustedTransmitter(address transmitter) external;
}
