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
    /// @dev Arc's deployed TokenMessengerV2 returns NO data for this function. Do not
    ///      declare a return value here: Solidity would try to ABI-decode an empty
    ///      return buffer and revert *after* the burn succeeds, rolling the whole
    ///      withdrawal back. This was the cause of the 0x-only CCTP withdrawals.
    function depositForBurnWithHook(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold,
        bytes   calldata hookData
    ) external;

    /// @notice Standard burn without hook data.
    /// @dev Arc's deployed TokenMessengerV2 returns NO data here either.
    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external;
}
