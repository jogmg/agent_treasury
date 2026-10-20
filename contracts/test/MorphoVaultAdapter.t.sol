// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {IMorphoVaultAdapter} from "../src/interfaces/IMorphoVaultAdapter.sol";
import {Errors}              from "../src/libraries/Errors.sol";
import {MockUSDC}            from "./mocks/MockUSDC.sol";
import {MockMorphoVault}     from "./mocks/MockMorphoVault.sol";

contract MorphoVaultAdapterTest is Test {
    MorphoVaultAdapter adapter;
    MockUSDC           usdc;
    MockMorphoVault    vault1;
    MockMorphoVault    vault2;

    address owner   = address(this);
    address treasury = makeAddr("treasury");
    address keeper  = makeAddr("keeper");

    uint256 constant VAULT_ID_1 = 1;
    uint256 constant VAULT_ID_2 = 2;
    uint256 constant MIN_DEPOSIT = 10e6; // 10 USDC

    function setUp() public {
        usdc   = new MockUSDC();
        vault1 = new MockMorphoVault(address(usdc));
        vault2 = new MockMorphoVault(address(usdc));

        adapter = new MorphoVaultAdapter(owner);
        adapter.setTreasury(treasury);
        adapter.setKeeper(keeper);

        adapter.addVault(VAULT_ID_1, address(vault1), "USDC Core", "mUSDC-CORE", MIN_DEPOSIT);
        adapter.addVault(VAULT_ID_2, address(vault2), "USDC Steady", "mUSDC-STEADY", MIN_DEPOSIT);
    }

    // ── Vault config ────────────────────────────────────────────────────────

    function test_addVault_recorded() public view {
        IMorphoVaultAdapter.VaultConfig memory cfg = adapter.getVaultConfig(VAULT_ID_1);
        assertEq(cfg.id, VAULT_ID_1);
        assertEq(cfg.vaultAddress, address(vault1));
        assertTrue(cfg.isActive);
    }

    function test_addVault_duplicate_reverts() public {
        vm.expectRevert(Errors.VaultAlreadyExists.selector);
        adapter.addVault(VAULT_ID_1, address(vault1), "dup", "dup", 0);
    }

    function test_addVault_zeroId_reverts() public {
        vm.expectRevert(Errors.InvalidVaultId.selector);
        adapter.addVault(0, address(vault1), "z", "z", 0);
    }

    function test_deactivateVault() public {
        adapter.deactivateVault(VAULT_ID_1);
        IMorphoVaultAdapter.VaultConfig memory cfg = adapter.getVaultConfig(VAULT_ID_1);
        assertFalse(cfg.isActive);
    }

    function test_getActiveVaults_excludes_inactive() public {
        adapter.deactivateVault(VAULT_ID_1);
        IMorphoVaultAdapter.VaultConfig[] memory active = adapter.getActiveVaults();
        assertEq(active.length, 1);
        assertEq(active[0].id, VAULT_ID_2);
    }

    function test_onlyOwner_addVault() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        adapter.addVault(99, address(vault1), "x", "x", 0);
    }

    // ── Deposit / withdraw round-trip ────────────────────────────────────────

    function test_deposit_withdraw_roundtrip_1to1() public {
        uint256 amount = 100e6; // 100 USDC
        usdc.mint(treasury, amount);

        vm.startPrank(treasury);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.deposit(amount, VAULT_ID_1);
        vm.stopPrank();

        assertEq(shares, amount, "shares should equal assets at 1:1");
        assertEq(usdc.balanceOf(address(vault1)), amount);

        // Withdraw
        vm.prank(treasury);
        uint256 returned = adapter.withdraw(shares, VAULT_ID_1);
        assertEq(returned, amount, "should get back 100 USDC");
    }

    function test_deposit_withdraw_with_yield() public {
        uint256 amount = 100e6;
        usdc.mint(treasury, amount);

        vm.startPrank(treasury);
        usdc.approve(address(adapter), amount);
        uint256 shares = adapter.deposit(amount, VAULT_ID_1);
        vm.stopPrank();

        // Simulate 5% yield: price per share goes up.
        vault1.setPricePerShare(1.05e18);
        // Mint extra USDC to vault to back the new share price.
        usdc.mint(address(vault1), 5e6);

        vm.prank(treasury);
        uint256 returned = adapter.withdraw(shares, VAULT_ID_1);
        assertGe(returned, amount, "should return at least principal");
    }

    function test_deposit_below_minimum_reverts() public {
        usdc.mint(treasury, 5e6);
        vm.startPrank(treasury);
        usdc.approve(address(adapter), 5e6);
        vm.expectRevert(Errors.BelowMinDeposit.selector);
        adapter.deposit(5e6, VAULT_ID_1);
        vm.stopPrank();
    }

    function test_deposit_inactive_vault_reverts() public {
        adapter.deactivateVault(VAULT_ID_1);
        usdc.mint(treasury, 100e6);
        vm.startPrank(treasury);
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert(Errors.VaultNotActive.selector);
        adapter.deposit(100e6, VAULT_ID_1);
        vm.stopPrank();
    }

    function test_only_treasury_can_deposit() public {
        usdc.mint(makeAddr("attacker"), 100e6);
        vm.startPrank(makeAddr("attacker"));
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert(Errors.Unauthorized.selector);
        adapter.deposit(100e6, VAULT_ID_1);
        vm.stopPrank();
    }

    // ── previewRedeem fallback ───────────────────────────────────────────────

    function test_previewRedeem_returns_shares_on_vault_revert() public {
        vault1.setShouldRevert(true);
        uint256 shares = 50e6;
        uint256 preview = adapter.previewRedeem(shares, VAULT_ID_1);
        assertEq(preview, shares, "should fall back to shares as floor");
    }

    function test_previewRedeem_normal() public view {
        uint256 shares = 100e6;
        uint256 preview = adapter.previewRedeem(shares, VAULT_ID_1);
        assertEq(preview, shares, "1:1 at inception");
    }

    // ── APY cache ────────────────────────────────────────────────────────────

    function test_setVaultAPY_by_keeper() public {
        uint256 apy = 72e15; // 7.2% in 1e18
        vm.prank(keeper);
        adapter.setVaultAPY(VAULT_ID_1, apy);
        assertEq(adapter.vaultAPY(VAULT_ID_1), apy);
    }

    function test_setVaultAPY_by_owner() public {
        adapter.setVaultAPY(VAULT_ID_1, 5e16);
        assertEq(adapter.vaultAPY(VAULT_ID_1), 5e16);
    }

    function test_setVaultAPY_unauthorized() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(Errors.Unauthorized.selector);
        adapter.setVaultAPY(VAULT_ID_1, 5e16);
    }

    // ── pricePerShare ────────────────────────────────────────────────────────

    function test_pricePerShare_default_1e18() public view {
        assertEq(adapter.pricePerShare(VAULT_ID_1), 1e18);
    }

    function test_pricePerShare_after_yield() public {
        vault1.setPricePerShare(1.1e18);
        // With empty vault totalSupply, convertToAssets(1e18) = 1.1e18
        // vault.convertToAssets(1e18) returns (1e18 * 1.1e18) / 1e18 = 1.1e18
        assertEq(adapter.pricePerShare(VAULT_ID_1), 1.1e18);
    }

    function test_pricePerShare_vault_revert_returns_1e18() public {
        vault1.setShouldRevert(true);
        assertEq(adapter.pricePerShare(VAULT_ID_1), 1e18);
    }

    // ── updateVault ──────────────────────────────────────────────────────────

    function test_updateVault_minDeposit() public {
        adapter.updateVault(VAULT_ID_1, 200e6, true);
        IMorphoVaultAdapter.VaultConfig memory cfg = adapter.getVaultConfig(VAULT_ID_1);
        assertEq(cfg.minDeposit, 200e6);
    }

    // ── Pause ────────────────────────────────────────────────────────────────

    function test_pause_blocks_deposit() public {
        adapter.pause();
        usdc.mint(treasury, 100e6);
        vm.startPrank(treasury);
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert();
        adapter.deposit(100e6, VAULT_ID_1);
        vm.stopPrank();
    }
}
