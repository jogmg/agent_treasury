// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable}     from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable}                  from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard}           from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}                    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}                 from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMorphoVaultAdapter}       from "./interfaces/IMorphoVaultAdapter.sol";
import {IMorphoVault}              from "./interfaces/IMorphoVault.sol";
import {Errors}                    from "./libraries/Errors.sol";

/// @title MorphoVaultAdapter
/// @notice Manages whitelisted Morpho (ERC-4626-compatible) yield vaults on Arc.
///         Exposes a unified deposit/withdraw/preview interface to AgentTreasury.
///
/// @dev Implementation path: direct Morpho Blue / ERC-4626 vault interface.
///      If circle-fin/earn-kit becomes available, replace IMorphoVault with the kit
///      interface - the adapter surface (IMorphoVaultAdapter) remains identical.
///
/// @dev Only the designated treasury (or an authorized caller) may call deposit/withdraw.
///      All read functions are permissionless.
contract MorphoVaultAdapter is IMorphoVaultAdapter, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Events ────────────────────────────────────────────────────────────────
    event VaultAdded(uint256 indexed vaultId, address vaultAddress, string name);
    event VaultUpdated(uint256 indexed vaultId, uint256 minDeposit, bool isActive);
    event VaultDeactivated(uint256 indexed vaultId);
    event VaultAPYSet(uint256 indexed vaultId, uint256 apy1e18);
    event TreasurySet(address indexed treasury);
    event KeeperSet(address indexed keeper);
    event Deposited(uint256 indexed vaultId, uint256 assets, uint256 shares);
    event Withdrawn(uint256 indexed vaultId, uint256 shares, uint256 assets);

    // ── State ────────────────────────────────────────────────────────────────
    /// @notice The AgentTreasury contract that is authorized to call deposit/withdraw.
    address public treasury;

    /// @notice Optional keeper address that can also call privileged write functions.
    address public keeper;

    /// @notice Vault registry: vaultId → config.
    mapping(uint256 => VaultConfig) private _vaults;

    /// @notice Ordered list of active vault IDs for enumeration.
    uint256[] private _vaultIds;

    /// @notice Cached APY per vault, 1e18-scaled. Set by keeper via setVaultAPY.
    ///         This is an on-chain cache sourced from Morpho off-chain data — NOT an oracle.
    ///         Never use for value math; use for display/routing only.
    mapping(uint256 => uint256) private _vaultAPY;

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyTreasury() {
        if (msg.sender != treasury && msg.sender != owner()) revert Errors.Unauthorized();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert Errors.Unauthorized();
        _;
    }

    modifier vaultExists(uint256 vaultId) {
        if (_vaults[vaultId].vaultAddress == address(0)) revert Errors.VaultNotActive();
        _;
    }

    modifier vaultActive(uint256 vaultId) {
        if (!_vaults[vaultId].isActive) revert Errors.VaultNotActive();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Set the treasury address that is allowed to deposit/withdraw.
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert Errors.ZeroAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /// @notice Set the keeper address (APY sync + vault management).
    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert Errors.ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    /// @notice Register a new whitelisted vault.
    /// @param vaultId      Unique numeric ID for this vault (must not be 0 or already used).
    /// @param vaultAddress On-chain vault contract address.
    /// @param name         Human-readable name (e.g. "USDC Core").
    /// @param symbol       Token symbol (e.g. "mUSDC-CORE").
    /// @param minDeposit   Minimum deposit in USDC ERC-20 units (6 decimals).
    function addVault(
        uint256 vaultId,
        address vaultAddress,
        string  calldata name,
        string  calldata symbol,
        uint256 minDeposit
    ) external onlyOwner {
        if (vaultId == 0) revert Errors.InvalidVaultId();
        if (vaultAddress == address(0)) revert Errors.ZeroAddress();
        if (_vaults[vaultId].vaultAddress != address(0)) revert Errors.VaultAlreadyExists();

        _vaults[vaultId] = VaultConfig({
            id:           vaultId,
            vaultAddress: vaultAddress,
            name:         name,
            symbol:       symbol,
            minDeposit:   minDeposit,
            isActive:     true
        });
        _vaultIds.push(vaultId);

        emit VaultAdded(vaultId, vaultAddress, name);
    }

    /// @notice Update a vault's minDeposit and isActive flag.
    function updateVault(uint256 vaultId, uint256 minDeposit, bool isActive)
        external
        onlyOwner
        vaultExists(vaultId)
    {
        _vaults[vaultId].minDeposit = minDeposit;
        _vaults[vaultId].isActive   = isActive;
        emit VaultUpdated(vaultId, minDeposit, isActive);
    }

    /// @notice Deactivate a vault (no new deposits; existing shares still withdrawable).
    function deactivateVault(uint256 vaultId) external onlyOwner vaultExists(vaultId) {
        _vaults[vaultId].isActive = false;
        emit VaultDeactivated(vaultId);
    }

    /// @notice Push a fresh cached APY value for a vault (keeper or owner only).
    ///         `apy1e18`: annual yield rate scaled by 1e18 (e.g. 7.2% → 72000000000000000).
    ///         This is a display-only cache. All value math uses on-chain share prices.
    function setVaultAPY(uint256 vaultId, uint256 apy1e18)
        external
        onlyKeeperOrOwner
        vaultExists(vaultId)
    {
        _vaultAPY[vaultId] = apy1e18;
        emit VaultAPYSet(vaultId, apy1e18);
    }

    // ── Mutating (treasury-only) ──────────────────────────────────────────────

    /// @notice Deposit `assets` of USDC into vault `vaultId`.
    ///         Caller (AgentTreasury) must have already pulled the USDC to this contract,
    ///         or approved this contract. This implementation pulls from msg.sender (treasury).
    /// @return shares Vault shares received.
    function deposit(uint256 assets, uint256 vaultId)
        external
        override
        nonReentrant
        whenNotPaused
        onlyTreasury
        vaultActive(vaultId)
        returns (uint256 shares)
    {
        VaultConfig memory cfg = _vaults[vaultId];
        if (assets < cfg.minDeposit) revert Errors.BelowMinDeposit();

        IMorphoVault vault = IMorphoVault(cfg.vaultAddress);

        // Pull USDC from the treasury to this adapter, then deposit into the vault.
        IERC20(vault.asset()).safeTransferFrom(msg.sender, address(this), assets);

        // Approve vault to spend assets (set exact amount, reset after if needed).
        IERC20(vault.asset()).forceApprove(cfg.vaultAddress, assets);

        shares = vault.deposit(assets, address(this));

        // A tiny deposit can round down to zero shares when pricePerShare is
        // high. The vault still took the assets, so revert the whole call
        // rather than silently lose the deposit's value.
        if (shares == 0) revert Errors.ZeroShares();

        emit Deposited(vaultId, assets, shares);
    }

    /// @notice Redeem `shares` from vault `vaultId` and send assets back to the treasury.
    /// @return assets USDC amount returned.
    function withdraw(uint256 shares, uint256 vaultId)
        external
        override
        nonReentrant
        whenNotPaused
        onlyTreasury
        vaultExists(vaultId)
        returns (uint256 assets)
    {
        VaultConfig memory cfg = _vaults[vaultId];
        IMorphoVault vault = IMorphoVault(cfg.vaultAddress);
        IERC20 asset = IERC20(vault.asset());

        // Redeem shares → assets sent to treasury (msg.sender).
        assets = vault.redeem(shares, msg.sender, address(this));

        emit Withdrawn(vaultId, shares, assets);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function previewDeposit(uint256 assets, uint256 vaultId)
        external
        view
        override
        vaultExists(vaultId)
        returns (uint256 shares)
    {
        return IMorphoVault(_vaults[vaultId].vaultAddress).convertToShares(assets);
    }

    /// @notice Preview assets for redeeming `shares` from `vaultId`.
    ///         Falls back to returning `shares` as a conservative floor if the vault reverts.
    function previewRedeem(uint256 shares, uint256 vaultId)
        external
        view
        override
        returns (uint256 assets)
    {
        if (_vaults[vaultId].vaultAddress == address(0)) return shares;
        try IMorphoVault(_vaults[vaultId].vaultAddress).convertToAssets(shares) returns (uint256 a) {
            return a;
        } catch {
            return shares; // conservative floor
        }
    }

    function balanceOf(address account, uint256 vaultId)
        external
        view
        override
        vaultExists(vaultId)
        returns (uint256 shares)
    {
        return IMorphoVault(_vaults[vaultId].vaultAddress).balanceOf(account);
    }

    function totalAssets(uint256 vaultId)
        external
        view
        override
        vaultExists(vaultId)
        returns (uint256)
    {
        return IMorphoVault(_vaults[vaultId].vaultAddress).totalAssets();
    }

    /// @notice Price per share, 1e18-scaled. Returns 1e18 if the vault reverts.
    function pricePerShare(uint256 vaultId)
        external
        view
        override
        vaultExists(vaultId)
        returns (uint256)
    {
        try IMorphoVault(_vaults[vaultId].vaultAddress).convertToAssets(1e18) returns (uint256 a) {
            return a;
        } catch {
            return 1e18;
        }
    }

    /// @notice Returns the cached APY for `vaultId` (1e18-scaled).
    ///         This is a display-only cache; never use it for value math.
    function vaultAPY(uint256 vaultId)
        external
        view
        override
        returns (uint256)
    {
        return _vaultAPY[vaultId];
    }

    function getVaultConfig(uint256 vaultId)
        external
        view
        override
        vaultExists(vaultId)
        returns (VaultConfig memory)
    {
        return _vaults[vaultId];
    }

    function getActiveVaults()
        external
        view
        override
        returns (VaultConfig[] memory configs)
    {
        uint256 count;
        for (uint256 i; i < _vaultIds.length; ++i) {
            if (_vaults[_vaultIds[i]].isActive) ++count;
        }
        configs = new VaultConfig[](count);
        uint256 idx;
        for (uint256 i; i < _vaultIds.length; ++i) {
            if (_vaults[_vaultIds[i]].isActive) {
                configs[idx++] = _vaults[_vaultIds[i]];
            }
        }
    }

    // ── Pausable passthrough ──────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
