// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITokenMessengerV2
/// @notice Minimal interface for Circle's CCTP v2 TokenMessengerV2 contract.
///         Full ABI: https://developers.circle.com/cctp/references/contract-addresses
interface ITokenMessengerV2 {
    /// @notice Burns `amount` of `burnToken` and emits a CCTP message to `destinationDomain`.
    ///         `mintRecipient` receives the minted tokens on the destination.
    ///         `hookData` is forwarded to the hook handler on the destination.
    ///         `maxFee` caps the relayer fee in the same token units (0 = no cap for standard).
    ///         `minFinalityThreshold`: 1000 = Fast Transfer (soft finality), 2000 = standard.
    function depositForBurnWithHook(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold,
        bytes   calldata hookData
    ) external returns (uint64 nonce);

    /// @notice Standard burn without hook data.
    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external returns (uint64 nonce);
}
