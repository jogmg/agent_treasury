// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICCTPReceiver} from "../../src/interfaces/ICCTPReceiver.sol";

/// @title MockMessageTransmitter
/// @notice Simulates Circle's MessageTransmitterV2 for CCTP v2 tests.
///         Allows tests to trigger handleReceiveMessage on CCTPReceiver directly.
contract MockMessageTransmitter {
    using SafeERC20 for IERC20;

    address public immutable usdc;
    uint32  public localDomain;

    mapping(bytes32 => uint256) public usedNonces;

    constructor(address _usdc, uint32 _localDomain) {
        usdc        = _usdc;
        localDomain = _localDomain;
    }

    /// @notice Simulate receiving a CCTP message: mint USDC to receiver, then call the hook.
    /// @param receiver      The mintRecipient (CCTPReceiver contract).
    /// @param sourceDomain  Source chain CCTP domain.
    /// @param amount        USDC to mint.
    /// @param sender        bytes32-encoded source sender (ignored by receiver, passed for completeness).
    /// @param hookData      Hook data (encodes agent address).
    function simulateReceive(
        address receiver,
        uint32  sourceDomain,
        uint256 amount,
        bytes32 sender,
        bytes   calldata hookData
    ) external {
        // Mint USDC to the receiver (simulates what MessageTransmitterV2 does on Arc).
        IERC20(usdc).safeTransfer(receiver, amount);

        // Build a simplified message body: abi.encode(amount, hookData).
        bytes memory messageBody = abi.encode(amount, hookData);

        // Call the hook.
        ICCTPReceiver(receiver).handleReceiveMessage(sourceDomain, sender, messageBody);
    }

    /// @notice Low-level receiveMessage stub (returns true, does not execute).
    function receiveMessage(bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }

    function markNonceUsed(bytes32 nonce) external {
        usedNonces[nonce] = 1;
    }
}
