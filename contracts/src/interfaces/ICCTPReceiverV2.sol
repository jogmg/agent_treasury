// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICCTPReceiverV2
/// @notice Interface for the atomic CCTP v2 inbound receiver on Arc.
///
/// @dev The receiver is the `mintRecipient` and `destinationCaller` for new
///      inbound burns. `receiveAndProcess` is permissionless: it validates the
///      attested message, calls MessageTransmitterV2.receiveMessage, then
///      forwards the minted USDC to AgentTreasury and credits the source domain.
interface ICCTPReceiverV2 {
    /// @notice Deliver an attested CCTP message and credit the agent named in
    ///         the hook data. The receiver must be the mintRecipient.
    /// @return agent  The agent credited by the treasury.
    /// @return amount The USDC amount credited (raw 6-decimal units).
    function receiveAndProcess(bytes calldata message, bytes calldata attestation)
        external
        returns (address agent, uint256 amount);

    /// @notice Owner-only recovery for a message that a relayer already
    ///         delivered to this receiver without processing it. The USDC must
    ///         already be in this contract.
    function processDeliveredMessage(bytes calldata message)
        external
        returns (address agent, uint256 amount);

    /// @notice Owner-only rescue for a message whose hook data is malformed.
    ///         Delivers the message and sends the minted USDC to `to` instead
    ///         of the treasury. Use only when normal processing cannot succeed.
    function receiveAndRescue(bytes calldata message, bytes calldata attestation, address to)
        external
        returns (uint256 amount);

    /// @notice Owner-only rescue of USDC sitting in this contract.
    function rescueUSDC(address to, uint256 amount) external;

    function setTreasury(address newTreasury) external;
    function setTrustedTransmitter(address newTransmitter) external;
    function pause() external;
    function unpause() external;

    /// @notice True once a message hash has been credited or rescued.
    function processedMessages(bytes32 messageHash) external view returns (bool);
}
