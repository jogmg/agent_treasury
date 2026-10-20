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

/// @title InvariantsTest
/// @notice Checks system-level invariants after a sequence of operations.
///         These are property tests run deterministically (not fuzzing) to verify key invariants.
contract InvariantsTest is Test {
    AgentTreasury      treasury;
    MorphoVaultAdapter adapter;
    MockUSDC           usdc;
    MockMorphoVault    vault1;
    MockTokenMessenger messenger;
    MockMessageTransmitter transmitter;

    address owner   = address(this);
    address receiver = makeAddr("receiver");
    address keeper  = makeAddr("keeper");
    address agent1  = makeAddr("agent1");
    address agent2  = makeAddr("agent2");

    uint32  constant ARC_DOMAIN  = 26;
    uint32  constant BASE_DOMAIN = 6;
    uint32  constant ARB_DOMAIN  = 3;
    uint256 constant VAULT_ID_1  = 1;

    function setUp() public {
        usdc        = new MockUSDC();
        vault1      = new MockMorphoVault(address(usdc));
        messenger   = new MockTokenMessenger();
        transmitter = new MockMessageTransmitter(address(usdc), ARC_DOMAIN);

        adapter = new MorphoVaultAdapter(owner);
        adapter.addVault(VAULT_ID_1, address(vault1), "USDC Core", "mUSDC-CORE", 10e6);

        treasury = new AgentTreasury(
            address(usdc),
            address(messenger),
            address(transmitter),
            address(adapter),
            receiver,
            ARC_DOMAIN,
            24,
            VAULT_ID_1,
            0,
            owner
        );
        adapter.setTreasury(address(treasury));
        treasury.setKeeper(keeper);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    function _deposit(address agent, uint256 amount, uint32 src) internal {
        usdc.mint(address(treasury), amount);
        vm.prank(receiver);
        treasury.recordDeposit(agent, amount, src);
    }

    // ── Invariant 1: nextWithdrawalId strictly increases ─────────────────────

    function test_invariant_nextWithdrawalId_strictly_increases() public {
        _deposit(agent1, 200e6, BASE_DOMAIN);
        bytes32 rec = bytes32(uint256(uint160(agent1)));

        uint256 id0 = treasury.nextWithdrawalId();
        vm.prank(agent1);
        uint256 w1 = treasury.requestWithdrawal(agent1, 20e6, ARB_DOMAIN, rec);
        uint256 id1 = treasury.nextWithdrawalId();

        vm.prank(agent1);
        uint256 w2 = treasury.requestWithdrawal(agent1, 20e6, ARB_DOMAIN, rec);
        uint256 id2 = treasury.nextWithdrawalId();

        assertGt(id1, id0, "nextWithdrawalId must increase after first request");
        assertGt(id2, id1, "nextWithdrawalId must increase after second request");
        assertEq(w2, w1 + 1,    "withdrawal IDs must be sequential");
    }

    // ── Invariant 2: No executed withdrawal can be executed twice ─────────────

    function test_invariant_no_double_execute() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 rec = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, rec);

        vm.prank(keeper);
        treasury.executeWithdrawal(wId);

        vm.prank(keeper);
        vm.expectRevert(Errors.AlreadyExecuted.selector);
        treasury.executeWithdrawal(wId);
    }

    // ── Invariant 3: Paused state never blocks view functions ─────────────────

    function test_invariant_pause_never_blocks_views() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        treasury.pause();

        // All view functions must succeed while paused.
        uint256 total   = treasury.getTotalBalance(agent1);
        uint256 princip = treasury.getPrincipal(agent1);
        uint256 shares  = treasury.getVaultShares(agent1);
        uint256 byChain = treasury.getDepositsByChain(agent1, BASE_DOMAIN);
        uint256 vault   = treasury.getActiveVault(agent1);
        bool    exists  = treasury.agentExists(agent1);

        assertGe(total,   0);
        assertGe(princip, 0);
        assertGe(shares,  0);
        assertGe(byChain, 0);
        assertGe(vault,   0);
        assertTrue(exists);
    }

    // ── Invariant 4: Balance is consistent after multiple deposits ────────────

    function test_invariant_total_deposited_monotonically_increasing() public {
        _deposit(agent1, 50e6,  BASE_DOMAIN);
        _deposit(agent1, 75e6,  ARB_DOMAIN);
        _deposit(agent1, 100e6, BASE_DOMAIN);

        // Total balance should reflect all deposits (ignoring yield for simplicity at 1:1).
        uint256 total = treasury.getTotalBalance(agent1);
        assertGe(total, 225e6 - 1, "total balance should cover all deposits (within rounding)");
    }

    // ── Invariant 5: Vault shares are zero after full withdrawal ──────────────

    function test_invariant_shares_zero_after_full_withdrawal() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        assertGt(treasury.getVaultShares(agent1), 0);

        bytes32 rec = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, type(uint256).max, ARB_DOMAIN, rec);

        assertEq(treasury.getVaultShares(agent1), 0, "shares must be zero after full withdrawal");
    }

    // ── Invariant 6: USDC transferred out equals amount in burn records ───────

    function test_invariant_messenger_received_correct_amount() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);

        bytes32 rec = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, rec);

        MockTokenMessenger.BurnRecord memory burn = messenger.getLastBurn();
        assertApproxEqAbs(burn.amount, 50e6, 1, "messenger should have received ~50 USDC");
    }

    // ── Invariant 7: Cancelled withdrawal ID cannot be executed ──────────────

    function test_invariant_cancelled_cannot_be_executed() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        bytes32 rec = bytes32(uint256(uint160(agent1)));
        vm.prank(agent1);
        uint256 wId = treasury.requestWithdrawal(agent1, 50e6, ARB_DOMAIN, rec);

        // Owner cancels immediately.
        treasury.cancelWithdrawal(wId);

        vm.prank(keeper);
        vm.expectRevert(Errors.AlreadyCancelled.selector);
        treasury.executeWithdrawal(wId);
    }

    // ── Invariant 8: USDC balance of treasury stays 0 after full vault deposit ─

    function test_invariant_treasury_usdc_drained_to_vault() public {
        uint256 amount = 100e6;
        usdc.mint(address(treasury), amount);
        vm.prank(receiver);
        treasury.recordDeposit(agent1, amount, BASE_DOMAIN);

        // After recordDeposit, treasury USDC should be 0 (all sent to vault via adapter).
        assertEq(usdc.balanceOf(address(treasury)), 0,
            "treasury USDC should be zero after deploying to vault");
    }

    // ── Invariant 9: Two agents' balances are independent ─────────────────────

    function test_invariant_agent_isolation() public {
        _deposit(agent1, 100e6, BASE_DOMAIN);
        _deposit(agent2,  50e6, BASE_DOMAIN);

        assertEq(treasury.getPrincipal(agent1), 100e6);
        assertEq(treasury.getPrincipal(agent2),  50e6);
    }
}
