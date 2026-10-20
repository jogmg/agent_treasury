// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMessageTransmitterV2
/// @notice Minimal interface for Circle's CCTP v2 MessageTransmitterV2 contract.
///         Full ABI: https://developers.circle.com/cctp/references/contract-addresses
interface IMessageTransmitterV2 {
    /// @notice Receive a CCTP message and its attestation, calling any registered hook.
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success);

    /// @notice Returns true if a message has already been received (replay protection).
    function usedNonces(bytes32 sourceAndNonce) external view returns (uint256);

    /// @notice The local domain ID for this deployment.
    function localDomain() external view returns (uint32);
}
