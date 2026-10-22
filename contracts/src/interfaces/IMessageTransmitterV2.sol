// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMessageTransmitterV2
/// @notice Minimal interface for Circle's CCTP v2 MessageTransmitterV2 contract.
///         Full ABI: https://developers.circle.com/cctp/references/contract-addresses
interface IMessageTransmitterV2 {
    /// @notice Receive a CCTP message and its attestation.
    /// @dev The transmitter calls the destination TokenMessenger, which mints
    ///      USDC to the message's mintRecipient. CCTP v2 does not auto-call an
    ///      arbitrary application hook; an app must be the mintRecipient (and
    ///      preferably the destinationCaller) and call this function itself.
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success);

    /// @notice Returns non-zero if a nonce has already been received (replay protection).
    /// @dev CCTP v2 keys this mapping by the raw 32-byte message nonce.
    function usedNonces(bytes32 nonce) external view returns (uint256);

    /// @notice The local domain ID for this deployment.
    function localDomain() external view returns (uint32);
}
