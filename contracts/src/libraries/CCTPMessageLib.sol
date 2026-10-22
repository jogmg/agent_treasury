// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CCTPMessageLib
/// @notice Helpers for encoding and decoding CCTP v2 hook data used by AgentTreasury.
///
/// @dev Hook data format used by this system:
///      Inbound (source chain to Arc): abi.encode(address agent)
///      Outbound (Arc to dest):        abi.encode(address agent, uint256 withdrawalId)
///
///      CCTP v2 message body format (from Circle spec):
///      https://developers.circle.com/cctp/
///      The message body is abi-encoded by the source TokenMessengerV2.
///      On the destination, MessageTransmitterV2 mints USDC to the
///      mintRecipient; it does not auto-call an application hook. The receiver
///      contract must be the mintRecipient and call receiveMessage itself.
///      BurnMessageV2 has 228 fixed bytes; raw hookData starts at body byte 228.
library CCTPMessageLib {
    // ── Hook data ─────────────────────────────────────────────────────────────

    /// @notice Encode inbound hook data: agent address only (deposit path).
    function encodeDepositHookData(address agent) internal pure returns (bytes memory) {
        return abi.encode(agent);
    }

    /// @notice Encode outbound hook data: agent + withdrawalId (withdrawal path).
    function encodeWithdrawalHookData(
        address  agent,
        uint256  withdrawalId
    ) internal pure returns (bytes memory) {
        return abi.encode(agent, withdrawalId);
    }

    /// @notice Safe decode an agent address from hook data using assembly.
    ///         Returns address(0) on any decoding failure (wrong length, bad padding).
    ///         Does not revert.
    function safeDecodeAgent(bytes calldata hookData) internal pure returns (address agent) {
        if (hookData.length < 32) return address(0);

        // abi.encode(address) produces a 32-byte word, left-padded with 12 zero bytes.
        // The address lives in the low 20 bytes of the first word.
        uint256 word;
        assembly {
            // hookData.offset is the calldata offset; load the first 32-byte word.
            word := calldataload(hookData.offset)
        }

        // Validate upper 12 bytes are zero (proper address ABI padding).
        if (word >> 160 != 0) return address(0);

        agent = address(uint160(word));
    }

    // ── mintRecipient ─────────────────────────────────────────────────────────

    /// @notice Convert an EVM address to the bytes32 mintRecipient format CCTP expects.
    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /// @notice Convert a bytes32 mintRecipient back to an EVM address.
    function bytes32ToAddress(bytes32 b) internal pure returns (address) {
        return address(uint160(uint256(b)));
    }
}
