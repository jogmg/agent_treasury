// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockMorphoVault
/// @notice Minimal ERC-4626-compatible vault mock for testing MorphoVaultAdapter.
///         1 share = 1 USDC at construction; pricePerShare can be manipulated.
contract MockMorphoVault is ERC20 {
    using SafeERC20 for IERC20;

    address public immutable _asset;

    /// @dev Exchange rate: how many USDC (6-dec) assets back 1e18 shares. Default 1e18 (1:1).
    uint256 public pricePerShareScaled = 1e18; // 1e18-scaled

    bool public shouldRevert; // set to true to simulate a paused/broken vault

    constructor(address asset_) ERC20("Mock Morpho Vault Share", "mVAULT") {
        _asset = asset_;
    }

    // ── Test helpers ──────────────────────────────────────────────────────────

    function setPricePerShare(uint256 newPrice) external {
        pricePerShareScaled = newPrice;
    }

    function setShouldRevert(bool val) external {
        shouldRevert = val;
    }

    // ── ERC-4626-like interface ────────────────────────────────────────────────

    function asset() external view returns (address) {
        return _asset;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20(_asset).balanceOf(address(this));
    }

    /// @notice Convert assets → shares using the current pricePerShare.
    function convertToShares(uint256 assets) external view returns (uint256) {
        if (shouldRevert) revert("vault paused");
        if (totalSupply() == 0) return assets; // 1:1 at inception
        // shares = assets * 1e18 / pricePerShareScaled
        return (assets * 1e18) / pricePerShareScaled;
    }

    /// @notice Convert shares → assets using the current pricePerShare.
    function convertToAssets(uint256 shares) external view returns (uint256) {
        if (shouldRevert) revert("vault paused");
        // assets = shares * pricePerShareScaled / 1e18
        return (shares * pricePerShareScaled) / 1e18;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (shouldRevert) revert("vault paused");
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), assets);
        shares = (totalSupply() == 0) ? assets : (assets * 1e18) / pricePerShareScaled;
        _mint(receiver, shares);
    }

    function redeem(uint256 shares, address receiver, address owner_) external returns (uint256 assets) {
        if (shouldRevert) revert("vault paused");
        if (owner_ != msg.sender) {
            _spendAllowance(owner_, msg.sender, shares);
        }
        assets = (shares * pricePerShareScaled) / 1e18;
        _burn(owner_, shares);
        IERC20(_asset).safeTransfer(receiver, assets);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account);
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        return super.approve(spender, amount);
    }
}
