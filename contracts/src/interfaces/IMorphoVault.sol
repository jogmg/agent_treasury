// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMorphoVault
/// @notice Minimal ERC-4626-compatible interface for a Morpho vault (or any compatible earn vault).
/// @dev Used by MorphoVaultAdapter to interact with whitelisted yield vaults.
///      If circle-fin/earn-kit becomes available and exposes its own vault interface,
///      swap this file for the kit interface - the adapter is designed to be drop-in compatible.
///      Current implementation uses the direct Morpho Blue / ERC-4626 vault interface.
interface IMorphoVault {
    /// @notice Deposit `assets` of the underlying token; mint shares to `receiver`.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Redeem `shares` and send underlying assets to `receiver`.
    ///         `owner` must have approved the caller if caller != owner.
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    /// @notice Preview how many shares `assets` would mint (without fees).
    function convertToShares(uint256 assets) external view returns (uint256 shares);

    /// @notice Preview how many assets `shares` would redeem to.
    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    /// @notice Total underlying assets managed by the vault.
    function totalAssets() external view returns (uint256);

    /// @notice Total shares outstanding.
    function totalSupply() external view returns (uint256);

    /// @notice The underlying ERC-20 asset (e.g. USDC).
    function asset() external view returns (address);

    /// @notice Shares balance of an account.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Approve `spender` to transfer up to `amount` shares.
    function approve(address spender, uint256 amount) external returns (bool);
}
