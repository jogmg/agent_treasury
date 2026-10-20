// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockTokenMessenger
/// @notice Simulates Circle's TokenMessengerV2.depositForBurnWithHook for tests.
///         Burns (transfers to this contract) USDC from the caller; records the call.
contract MockTokenMessenger {
    using SafeERC20 for IERC20;

    struct BurnRecord {
        uint256 amount;
        uint32  destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        uint256 maxFee;
        uint32  minFinalityThreshold;
        bytes   hookData;
    }

    BurnRecord[] public burns;
    uint64 public nextNonce = 1;

    event MessageSent(bytes message); // mimics TokenMessengerV2 event

    function depositForBurnWithHook(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32, /* destinationCaller */
        uint256 maxFee_,
        uint32  minFinalityThreshold_,
        bytes   calldata hookData
    ) external {
        // Pull tokens from caller (simulates burn).
        IERC20(burnToken).safeTransferFrom(msg.sender, address(this), amount);

        burns.push(BurnRecord({
            amount:               amount,
            destinationDomain:    destinationDomain,
            mintRecipient:        mintRecipient,
            burnToken:            burnToken,
            maxFee:               maxFee_,
            minFinalityThreshold: minFinalityThreshold_,
            hookData:             hookData
        }));

        uint64 nonce = nextNonce++;
        bytes memory message = abi.encode(nonce, amount, destinationDomain, mintRecipient);
        emit MessageSent(message);
    }

    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32,
        uint256, /* maxFee */
        uint32   /* minFinalityThreshold */
    ) external {
        IERC20(burnToken).safeTransferFrom(msg.sender, address(this), amount);
        uint64 nonce = nextNonce++;
        emit MessageSent(abi.encode(nonce, amount, destinationDomain, mintRecipient));
    }

    function getBurnCount() external view returns (uint256) {
        return burns.length;
    }

    function getLastBurn() external view returns (BurnRecord memory) {
        require(burns.length > 0, "no burns");
        return burns[burns.length - 1];
    }
}
