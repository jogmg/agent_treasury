// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice 6-decimal ERC-20 used in tests to simulate the USDC ERC-20 on Arc.
///         Matches the real USDC ERC-20 interface (6 decimals).
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    /// @notice Mint `amount` tokens to `to`. Used by test setup.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Burn `amount` from `account` (simulates CCTP burn).
    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
