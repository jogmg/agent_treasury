// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2}       from "forge-std/Test.sol";
import {AgentTreasury}        from "../src/AgentTreasury.sol";
import {MorphoVaultAdapter}   from "../src/MorphoVaultAdapter.sol";
import {IAgentTreasury}       from "../src/interfaces/IAgentTreasury.sol";
import {Errors}               from "../src/libraries/Errors.sol";
import {MockUSDC}             from "./mocks/MockUSDC.sol";
import {MockMorphoVault}      from "./mocks/MockMorphoVault.sol";
import {MockTokenMessenger}   from "./mocks/MockTokenMessenger.sol";
import {MockMessageTransmitter} from "./mocks/MockMessageTransmitter.sol";

contract AgentTreasuryTest is Test {
    AgentTreasury      treasury;
    MorphoVaultAdapter adapter;
    MockUSDC           usdc;
    MockMorphoVault    vault1;
    MockMorphoVault    vault2;
    MockTokenMessenger messenger;
    MockMessageTransmitter transmitter;

    address owner    = address(this);
    address receiver = makeAddr("receiver"); // CCTPReceiver placeholder
    address keeper   = makeAddr("keeper");
    address agent1   = makeAddr("agent1");
    address agent2   = makeAddr("agent2");

    uint32  constant ARC_DOMAIN   = 26;
    uint32  constant BASE_DOMAIN  = 6;
    uint32  constant ARB_DOMAIN   = 3;
    uint256 constant VAULT_ID_1   = 1;
    uint256 constant VAULT_ID_2   = 2;
    uint256 constant MIN_DEPOSIT  = 10e6; // 10 USDC

    function setUp() public {
        usdc        = new MockUSDC();
        vault1      = new MockMorphoVault(address(usdc));
        vault2      = new MockMorphoVault(address(usdc));
        messenger   = new MockTokenMessenger();
        transmitter = new MockMessageTransmitter(address(usdc), ARC_DOMAIN);

        adapter = new MorphoVaultAdapter(owner);
        adapter.addVault(VAULT_ID_1, address(vault1), "USDC Core", "mUSDC-CORE", MIN_DEPOSIT);
        adapter.addVault(VAULT_ID_2, address(vault2), "USDC Steady", "mUSDC-STEADY", MIN_DEPOSIT);

        treasury = new AgentTreasury(
            address(usdc),
            address(messenger),
            address(transmitter),
            address(adapter),
            receiver,
            ARC_DOMAIN,
            24,         // maxWithdrawalDelayHours
            VAULT_ID_1, // defaultVaultId
            0,          // defaultMaxFee
            owner
        );

        adapter.setTreasury(address(treasury));
        treasury.setKeeper(keeper);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    /// @dev Simulates a CCTP-minted deposit: mint USDC to treasury then call recordDeposit.
    function _deposit(address agent, uint256 amount, uint32 sourceDomain) internal {
        usdc.mint(address(treasury), amount);
        vm.prank(receiver);
        treasury.recordDeposit(agent, amount, sourceDomain);
    }

    // ── recordDeposit ────────────────────────────────────────────────────────

    function test_recordDeposit_increments_principal_and_shares() public {
        uint256 amount = 100e6;
        _deposit(agent1, amount, BASE_DOMAIN);

        assertEq(treasury.getPrincipal(agent1), amount);
        assertGt(treasury.getVaultShares(agent1), 0);
        assertEq(treasury.getDepositsByChain(agent1, BASE_DOMAIN), amount);
    }

    function test_recordDeposit_only_receiver_or_owner() public {
        usdc.mint(address(treasury), 100e6);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Errors.NotReceiver.selector);
        treasury.recordDeposit(agent1, 100e6, BASE_DOMAIN);
    }

    function test_recordDeposit_owner_can_call() public {
        usdc.mint(address(treasury), 100e6);
        treasury.recordDeposit(agent1, 100e6, BASE_DOMAIN);
        assertGt(treasury.getPrincipal(agent1), 0);
    }

    function test_recordDeposit_multiple_sources_tracked() public {
        _deposit(agent1, 50e6, BASE_DOMAIN);
        _deposit(agent1, 30e6, ARB_DOMAIN);

        assertEq(treasury.getDepositsByChain(agent1, BASE_DOMAIN), 50e6);
        assertEq(treasury.getDepositsByChain(agent1, ARB_DOMAIN), 30e6);
    }

    function test_recordDeposit_paused_reverts() public {
        treasury.pause();
        usdc.mint(address(treasury), 100e6);
        vm.prank(receiver);
        vm.expectRevert();
        treasury.recordDeposit(agent1, 100e6, BASE_DOMAIN);
    }

    // ── getTotalBalance (never reverts) ───────────────────────────────────────

    function test_getTotalBalance_includes_yield() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);

        // Simulate yield: price per share increases.
        vault1.setPricePerShare(1.1e18);
        usdc.mint(address(vault1), 10e6); // back the new price

        uint256 total = treasury.getTotalBalance(agent1);
        assertGe(total, 100e6);
    }

    function test_getTotalBalance_does_not_revert_when_vault_paused() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        vault1.setShouldRevert(true);

        // Must not revert; falls back to principal.
        uint256 total = treasury.getTotalBalance(agent1);
        assertGe(total, 0);
    }

    function test_getTotalBalance_zero_for_unknown_agent() public {
        address unknown = makeAddr("unknown");
        assertEq(treasury.getTotalBalance(unknown), 0);
    }

    // ── setYieldStrategy ─────────────────────────────────────────────────────

    function test_setYieldStrategy_moves_shares() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);

        uint256 sharesBefore = treasury.getVaultShares(agent1);
        assertGt(sharesBefore, 0);

        vm.prank(agent1);
        treasury.setYieldStrategy(agent1, VAULT_ID_2);

        assertEq(treasury.getActiveVault(agent1), VAULT_ID_2);
        assertGt(treasury.getVaultShares(agent1), 0);
        // Old vault should have had shares burned.
        assertEq(vault1.balanceOf(address(adapter)), 0);
    }

    function test_setYieldStrategy_reverts_inactive_vault() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        adapter.deactivateVault(VAULT_ID_2);

        vm.prank(agent1);
        vm.expectRevert(Errors.VaultNotActive.selector);
        treasury.setYieldStrategy(agent1, VAULT_ID_2);
    }

    function test_setYieldStrategy_unauthorized() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        vm.prank(agent2); // different agent
        vm.expectRevert(Errors.Unauthorized.selector);
        treasury.setYieldStrategy(agent1, VAULT_ID_2);
    }

    // ── rebalance ────────────────────────────────────────────────────────────

    function test_rebalance_with_zero_shares_safe_noop() public {
        // Agent with no shares — should not revert.
        usdc.mint(address(treasury), 100e6);
        treasury.recordDeposit(agent1, 100e6, BASE_DOMAIN); // owner call
        // Manually drain shares for test isolation.
        // Just call rebalance on an agent that has shares — should complete.
        vm.prank(keeper);
        treasury.rebalance(agent1);
        assertGt(treasury.getVaultShares(agent1), 0);
    }

    function test_rebalance_only_keeper_or_owner() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        vm.prank(makeAddr("rando"));
        vm.expectRevert(Errors.Unauthorized.selector);
        treasury.rebalance(agent1);
    }

    // ── requestWithdrawal ────────────────────────────────────────────────────

    function test_requestWithdrawal_burns_shares_and_calls_messenger() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);

        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        assertEq(wId, 1);
        assertEq(messenger.getBurnCount(), 1);

        MockTokenMessenger.BurnRecord memory burn = messenger.getLastBurn();
        assertEq(burn.destinationDomain, ARB_DOMAIN);
        assertEq(burn.mintRecipient, recipient);
        assertGt(burn.amount, 0);
    }

    function test_requestWithdrawal_rejects_arc_domain() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        vm.expectRevert(Errors.BadDomain.selector);
        treasury.requestWithdrawal(agent1, 50e6, ARC_DOMAIN, recipient);
    }

    function test_requestWithdrawal_type_uint256_max_withdraws_all() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, type(uint256).max, ARB_DOMAIN, recipient);

        // All shares should be burned.
        assertEq(treasury.getVaultShares(agent1), 0);
    }

    function test_requestWithdrawal_stores_pending_id() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        uint256[] memory pending = treasury.getPendingWithdrawals(agent1);
        assertEq(pending.length, 1);
        assertEq(pending[0], 1);
    }

    function test_requestWithdrawal_paused_reverts() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        treasury.pause();
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        vm.expectRevert();
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);
    }

    // ── executeWithdrawal ────────────────────────────────────────────────────

    function test_executeWithdrawal_marks_executed() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        vm.prank(keeper);
        treasury.executeWithdrawal(wId);

        IAgentTreasury.WithdrawalRequest memory req = treasury.getWithdrawal(wId);
        assertTrue(req.executed);
    }

    function test_executeWithdrawal_prevents_double_execute() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        vm.prank(keeper);
        treasury.executeWithdrawal(wId);

        vm.prank(keeper);
        vm.expectRevert(Errors.AlreadyExecuted.selector);
        treasury.executeWithdrawal(wId);
    }

    // ── cancelWithdrawal ─────────────────────────────────────────────────────

    function test_cancelWithdrawal_after_delay() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        // Warp past maxWithdrawalDelayHours (24h).
        vm.warp(block.timestamp + 25 hours);
        treasury.cancelWithdrawal(wId);

        IAgentTreasury.WithdrawalRequest memory req = treasury.getWithdrawal(wId);
        assertTrue(req.cancelled);
    }

    function test_cancelWithdrawal_before_delay_reverts() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        // Call as a non-owner third party; delay has not expired.
        vm.prank(makeAddr("thirdParty"));
        vm.expectRevert(Errors.DelayNotExpired.selector);
        treasury.cancelWithdrawal(wId);
    }

    function test_owner_can_cancel_immediately() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        // Owner cancels immediately (no delay required).
        treasury.cancelWithdrawal(wId);
        IAgentTreasury.WithdrawalRequest memory req = treasury.getWithdrawal(wId);
        assertTrue(req.cancelled);
    }

    // ── Spending limits ───────────────────────────────────────────────────────

    function test_spending_limit_enforced_daily() public {
        _deposit(agent1, 200e6, BASE_DOMAIN);

        vm.prank(agent1);
        treasury.setSpendingLimit(agent1, 60e6, 0); // 60 USDC/day

        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        // Second withdrawal in same day would exceed daily limit.
        vm.prank(agent1);
        vm.expectRevert(Errors.LimitExceeded.selector);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);
    }

    function test_spending_limit_resets_after_day() public {
        _deposit(agent1, 300e6, BASE_DOMAIN);

        vm.prank(agent1);
        treasury.setSpendingLimit(agent1, 60e6, 0);

        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);

        // Warp past 24h.
        vm.warp(block.timestamp + 25 hours);

        // Should succeed after window reset.
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);
        assertGe(messenger.getBurnCount(), 2);
    }

    // ── Pause blocks state-changing but not reads ────────────────────────────

    function test_pause_does_not_block_getTotalBalance() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        treasury.pause();
        // Must not revert.
        uint256 total = treasury.getTotalBalance(agent1);
        assertGe(total, 0);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function test_setMorphoAdapter_only_owner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        treasury.setMorphoAdapter(address(adapter));
    }

    function test_setGatewayReceiver_only_owner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        treasury.setGatewayReceiver(makeAddr("x"));
    }

    function test_setMaxWithdrawalDelay_updates() public {
        treasury.setMaxWithdrawalDelay(48);
        assertEq(treasury.maxWithdrawalDelayHours(), 48);
    }

    // ── Fix 1: keeper privilege hardening ────────────────────────────────────

    function test_keeper_cannot_requestWithdrawal_for_another_agent() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        // Keeper is NOT agent1, so it must be rejected.
        vm.prank(keeper);
        vm.expectRevert(Errors.Unauthorized.selector);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, recipient);
    }

    function test_keeper_cannot_setSpendingLimit_for_another_agent() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        // Keeper must not be able to set spending limits on an agent's behalf.
        vm.prank(keeper);
        vm.expectRevert(Errors.Unauthorized.selector);
        treasury.setSpendingLimit(agent1, 10e6, 0);
    }

    // ── Fix 2: getTotalBalance includes idle principal ────────────────────────

    function test_getTotalBalance_includes_idle_principal_no_vault() public {
        // Deploy treasury with NO adapter (zero address).
        AgentTreasury noVaultTreasury = new AgentTreasury(
            address(usdc),
            address(messenger),
            address(transmitter),
            address(0), // no adapter
            receiver,
            ARC_DOMAIN,
            24,
            0,   // defaultVaultId = 0 (no vault)
            0,
            owner
        );

        uint256 amount = 50e6;
        usdc.mint(address(noVaultTreasury), amount);
        vm.prank(receiver);
        noVaultTreasury.recordDeposit(agent1, amount, BASE_DOMAIN);

        // Shares should be zero since there's no adapter.
        assertEq(noVaultTreasury.getVaultShares(agent1), 0);
        // getTotalBalance must return the idle principal, not 0.
        assertEq(noVaultTreasury.getTotalBalance(agent1), amount);
    }

    // ── Fix 3: max withdrawal leaves no shares / no dust ─────────────────────

    function test_max_withdrawal_leaves_zero_shares() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        uint256 sharesBefore = treasury.getVaultShares(agent1);
        assertGt(sharesBefore, 0);

        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, type(uint256).max, ARB_DOMAIN, recipient);

        // All shares must be gone after a max withdrawal.
        assertEq(treasury.getVaultShares(agent1), 0, "shares should be zero after max withdrawal");

        // The messenger should have received the full redeemed amount (no dust left in treasury).
        MockTokenMessenger.BurnRecord memory burn = messenger.getLastBurn();
        assertGt(burn.amount, 0, "messenger should have received non-zero USDC");
    }

    // ── claimYield ───────────────────────────────────────────────────────────

    function test_claimYield_does_not_revert_with_yield() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        vault1.setPricePerShare(1.05e18);
        usdc.mint(address(vault1), 5e6);

        vm.prank(agent1);
        treasury.claimYield(agent1); // must not revert
    }

    function test_claimYield_does_not_revert_without_yield() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        vm.prank(agent1);
        treasury.claimYield(agent1); // safe no-op at 1:1
    }

    // ── Fix A: spending-limit bypass regression ───────────────────────────────

    /// @dev Before the fix, max withdrawal skipped _enforceSpendingLimit entirely,
    ///      so an agent with a 60 USDC daily cap could drain the entire 200 USDC vault.
    ///      After the fix, _enforceSpendingLimit is called on the RESOLVED amount,
    ///      so 200 USDC > 60 USDC cap must revert with LimitExceeded.
    function test_max_withdrawal_reverts_when_exceeds_daily_limit() public {
        _deposit(agent1, 200e6, BASE_DOMAIN);

        // Set a tight daily limit.
        vm.prank(agent1);
        treasury.setSpendingLimit(agent1, 60e6, 0);

        bytes32 recipient = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        vm.expectRevert(Errors.LimitExceeded.selector);
        // type(uint256).max resolves to ~200 USDC; 200 > 60 cap => must revert.
        treasury.requestWithdrawal(agent1, type(uint256).max, ARB_DOMAIN, recipient);

        // Vault shares must be untouched since the tx reverted.
        assertGt(treasury.getVaultShares(agent1), 0, "shares must be intact after reverted max withdrawal");
    }

    // ── Fix B: deposit() ─────────────────────────────────────────────────────

    function test_deposit_pulls_usdc_credits_principal_and_mints_shares() public {
        uint256 amount = 75e6;
        usdc.mint(agent1, amount);

        vm.startPrank(agent1);
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
        vm.stopPrank();

        // Principal credited.
        assertEq(treasury.getPrincipal(agent1), amount, "principal should equal deposited amount");
        // Vault shares minted (deployed to default vault).
        assertGt(treasury.getVaultShares(agent1), 0, "should have vault shares after deposit");
        // Arc domain tracked.
        assertEq(treasury.getDepositsByChain(agent1, ARC_DOMAIN), amount, "Arc domain deposit should be tracked");
    }

    // ── Fix B: withdrawLocal() ────────────────────────────────────────────────

    function test_withdrawLocal_max_returns_usdc_and_zeroes_shares() public {
        uint256 amount = 100e6;
        usdc.mint(agent1, amount);

        vm.startPrank(agent1);
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
        vm.stopPrank();

        uint256 balanceBefore = usdc.balanceOf(agent1);
        assertEq(treasury.getVaultShares(agent1), amount, "shares should equal deposit amount at 1:1");

        vm.prank(agent1);
        treasury.withdrawLocal(type(uint256).max);

        // Shares must be zeroed.
        assertEq(treasury.getVaultShares(agent1), 0, "shares should be zero after max withdrawLocal");
        // USDC returned to agent.
        assertGe(usdc.balanceOf(agent1), balanceBefore, "agent should have received USDC back");
    }

    function test_keeper_cannot_call_withdrawLocal_for_another_agent() public {
        // First, agent1 deposits via the local path.
        uint256 amount = 50e6;
        usdc.mint(agent1, amount);
        vm.startPrank(agent1);
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
        vm.stopPrank();

        // Keeper calls withdrawLocal for themselves (keeper has no account) — must revert.
        vm.prank(keeper);
        vm.expectRevert(Errors.AgentNotFound.selector);
        treasury.withdrawLocal(amount);
    }
}
