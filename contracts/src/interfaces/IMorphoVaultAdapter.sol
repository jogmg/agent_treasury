// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMorphoVaultAdapter
/// @notice Interface for the MorphoVaultAdapter: manages whitelisted Morpho yield vaults.
interface IMorphoVaultAdapter {
    struct VaultConfig {
        uint256 id;
        address vaultAddress;
        string  name;
        string  symbol;
        uint256 minDeposit;  // in USDC (6-decimal ERC-20 units)
        bool    isActive;
    }

    // ── Mutating (treasury-only) ──────────────────────────────────────────────
    function deposit(uint256 assets, uint256 vaultId) external returns (uint256 shares);
    function withdraw(uint256 shares, uint256 vaultId) external returns (uint256 assets);

    // ── View ──────────────────────────────────────────────────────────────────
    function previewDeposit(uint256 assets, uint256 vaultId) external view returns (uint256 shares);
    function previewRedeem(uint256 shares, uint256 vaultId) external view returns (uint256 assets);
    function balanceOf(address account, uint256 vaultId) external view returns (uint256 shares);
    function totalAssets(uint256 vaultId) external view returns (uint256);
    function pricePerShare(uint256 vaultId) external view returns (uint256); // 1e18-scaled
    function vaultAPY(uint256 vaultId) external view returns (uint256);      // 1e18-scaled, cached
    function getVaultConfig(uint256 vaultId) external view returns (VaultConfig memory);
    function getActiveVaults() external view returns (VaultConfig[] memory);
}
