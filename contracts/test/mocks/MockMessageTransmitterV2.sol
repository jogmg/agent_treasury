// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @title MockMessageTransmitterV2
/// @notice Test double for Circle's MessageTransmitterV2.
///
/// @dev Parses the real CCTP v2 header + BurnMessageV2 body, enforces the
///      destination domain/caller, mints USDC to the mintRecipient, and marks
///      the nonce used. This mirrors the parts of the real transmitter that
///      CCTPReceiverV2 relies on. Attestation validity is simulated by
///      requiring a non-empty attestation.
contract MockMessageTransmitterV2 {
    address public immutable usdc;
    uint32 public immutable localDomain;

    mapping(bytes32 => uint256) public usedNonces;

    constructor(address _usdc, uint32 _localDomain) {
        usdc = _usdc;
        localDomain = _localDomain;
    }

    function receiveMessage(bytes calldata message, bytes calldata attestation)
        external
        returns (bool)
    {
        require(attestation.length > 0, "MockTransmitter: empty attestation");
        require(message.length >= 376, "MockTransmitter: short message");

        uint32 version;
        uint32 destinationDomain;
        bytes32 nonce;
        bytes32 destinationCaller;
        uint32 bodyVersion;
        bytes32 mintRecipient;
        uint256 amount;

        assembly {
            version := shr(224, calldataload(message.offset))
            destinationDomain := shr(224, calldataload(add(message.offset, 8)))
            nonce := calldataload(add(message.offset, 12))
            destinationCaller := calldataload(add(message.offset, 108))
            bodyVersion := shr(224, calldataload(add(message.offset, 148)))
            mintRecipient := calldataload(add(message.offset, 184))
            amount := calldataload(add(message.offset, 216))
        }

        require(version == 1 && bodyVersion == 1, "MockTransmitter: version");
        require(destinationDomain == localDomain, "MockTransmitter: domain");
        require(
            destinationCaller == bytes32(0) ||
                destinationCaller == bytes32(uint256(uint160(msg.sender))),
            "MockTransmitter: caller"
        );
        require(usedNonces[nonce] == 0, "MockTransmitter: nonce used");

        usedNonces[nonce] = 1;

        address recipient = address(uint160(uint256(mintRecipient)));
        MockUSDC(usdc).mint(recipient, amount);

        return true;
    }

    /// @notice Simulate a relayer delivering a message and marking the nonce
    ///         used, without minting. Used to test the owner fallback where the
    ///         USDC is already in the receiver.
    function markDelivered(bytes32 nonce) external {
        usedNonces[nonce] = 1;
    }
}
