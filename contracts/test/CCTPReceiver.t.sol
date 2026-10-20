// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2}       from "forge-std/Test.sol";
import {CCTPReceiver}         from "../src/CCTPReceiver.sol";
import {AgentTreasury}        from "../src/AgentTreasury.sol";
import {MorphoVaultAdapter}   from "../src/MorphoVaultAdapter.sol";
import {Errors}               from "../src/libraries/Errors.sol";
import {CCTPMessageLib}       from "../src/libraries/CCTPMessageLib.sol";
import {MockUSDC}             from "./mocks/MockUSDC.sol";
import {MockMorphoVault}      from "./mocks/MockMorphoVault.sol";
import {MockTokenMessenger}   from "./mocks/MockTokenMessenger.sol";
import {MockMessageTransmitter} from "./mocks/MockMessageTransmitter.sol";

contract CCTPReceiverTest is Test {
    CCTPReceiver       cctpReceiver;
    AgentTreasury      treasury;
    MorphoVaultAdapter adapter;
    MockUSDC           usdc;
    MockMorphoVault    vault1;
    MockTokenMessenger messenger;
    MockMessageTransmitter transmitter;

    address owner            = address(this);
    address defaultBeneficiary = makeAddr("defaultBeneficiary");
    address agent1           = makeAddr("agent1");

    uint32  constant ARC_DOMAIN  = 26;
    uint32  constant BASE_DOMAIN = 6;
    uint256 constant VAULT_ID_1  = 1;
    uint256 constant MIN_DEPOSIT = 10e6;

    function setUp() public {
        usdc        = new MockUSDC();
        vault1      = new MockMorphoVault(address(usdc));
        messenger   = new MockTokenMessenger();
        transmitter = new MockMessageTransmitter(address(usdc), ARC_DOMAIN);

        adapter = new MorphoVaultAdapter(owner);
        adapter.addVault(VAULT_ID_1, address(vault1), "USDC Core", "mUSDC-CORE", MIN_DEPOSIT);

        // Deploy CCTPReceiver first without treasury (set after).
        cctpReceiver = new CCTPReceiver(
            address(transmitter),
            address(usdc),
            defaultBeneficiary,
            address(0), // treasury set below
            owner
        );

        treasury = new AgentTreasury(
            address(usdc),
            address(messenger),
            address(transmitter),
            address(adapter),
            address(cctpReceiver),
            ARC_DOMAIN,
            24,
            VAULT_ID_1,
            0,
            owner
        );

        adapter.setTreasury(address(treasury));
        cctpReceiver.setTreasury(address(treasury));
    }

    // ── handleReceiveMessage ─────────────────────────────────────────────────

    function test_handleReceiveMessage_decodes_agent_and_records_deposit() public {
        uint256 amount = 100e6;
        bytes memory hookData = CCTPMessageLib.encodeDepositHookData(agent1);

        // Mint USDC to the receiver (simulates what MessageTransmitterV2 does).
        usdc.mint(address(cctpReceiver), amount);

        // Build simplified message body: abi.encode(amount, hookData).
        bytes memory body = abi.encode(amount, hookData);

        vm.prank(address(transmitter));
        bool ok = cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);

        assertTrue(ok);
        assertGt(treasury.getPrincipal(agent1), 0);
    }

    function test_handleReceiveMessage_rejects_untrusted_caller() public {
        bytes memory body = abi.encode(uint256(100e6), CCTPMessageLib.encodeDepositHookData(agent1));
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Errors.UntrustedCaller.selector);
        cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);
    }

    function test_handleReceiveMessage_malformed_hookdata_routes_to_beneficiary() public {
        uint256 amount = 50e6;
        bytes memory hookData = hex"deadbeef"; // malformed (< 32 bytes, non-address)
        bytes memory body = abi.encode(amount, hookData);

        usdc.mint(address(cctpReceiver), amount);

        vm.prank(address(transmitter));
        bool ok = cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);

        assertTrue(ok);
        // Funds went to defaultBeneficiary, not treasury.
        assertEq(usdc.balanceOf(defaultBeneficiary), amount);
        assertEq(treasury.getPrincipal(defaultBeneficiary), 0);
    }

    function test_handleReceiveMessage_empty_hookdata_routes_to_beneficiary() public {
        uint256 amount = 50e6;
        bytes memory hookData = "";
        bytes memory body = abi.encode(amount, hookData);

        usdc.mint(address(cctpReceiver), amount);

        vm.prank(address(transmitter));
        bool ok = cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);

        assertTrue(ok);
        assertEq(usdc.balanceOf(defaultBeneficiary), amount);
    }

    function test_handleReceiveMessage_owner_can_call() public {
        uint256 amount = 100e6;
        bytes memory hookData = CCTPMessageLib.encodeDepositHookData(agent1);
        bytes memory body = abi.encode(amount, hookData);

        usdc.mint(address(cctpReceiver), amount);

        // Owner should also be able to call (useful for relayer fallback tests).
        bool ok = cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);
        assertTrue(ok);
        assertGt(treasury.getPrincipal(agent1), 0);
    }

    function test_setTreasury_only_owner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        cctpReceiver.setTreasury(makeAddr("x"));
    }

    function test_setDefaultBeneficiary_only_owner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        cctpReceiver.setDefaultBeneficiary(makeAddr("x"));
    }

    function test_setTrustedTransmitter_only_owner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        cctpReceiver.setTrustedTransmitter(makeAddr("x"));
    }

    function test_setTrustedTransmitter_updates() public {
        address newTransmitter = makeAddr("newTransmitter");
        cctpReceiver.setTrustedTransmitter(newTransmitter);
        assertEq(cctpReceiver.trustedTransmitter(), newTransmitter);
    }

    // ── Fix 4: versioned BurnMessageV2 body decoding ─────────────────────────

    /// @dev Builds a synthetic Layout A (versioned) BurnMessageV2 body and proves the
    ///      tolerant decoder extracts the correct agent address and amount.
    ///
    ///      Layout A (228 bytes of fixed fields + hookData):
    ///        [0..3]    version         = 1  (uint32, big-endian)
    ///        [4..35]   burnToken       (bytes32)
    ///        [36..67]  mintRecipient   (bytes32, this receiver address)
    ///        [68..99]  amount          (uint256)
    ///        [100..131] messageSender  (bytes32)
    ///        [132..163] maxFee         (uint256)
    ///        [164..195] feeExecuted    (uint256)
    ///        [196..227] expirationBlock (uint256)
    ///        [228..259] hookData length (uint256)
    ///        [260..]   hookData bytes
    function test_versioned_BurnMessageV2_body_decodes_correctly() public {
        uint256 amount    = 123_456e6; // 123,456 USDC
        address agent     = agent1;
        bytes32 hookAgent = bytes32(uint256(uint160(agent)));

        // Build the versioned body in memory.
        bytes memory hookData = abi.encodePacked(hookAgent); // 32 bytes, raw ABI-encoded address

        bytes memory body = new bytes(260 + hookData.length);

        // version = 1 at bytes [0..3]
        body[2] = 0x00;
        body[3] = 0x01;

        // amount at bytes [68..99] — write as big-endian uint256
        for (uint256 i = 0; i < 32; i++) {
            body[68 + i] = bytes1(uint8(amount >> (248 - i * 8)));
        }

        // hookData length at bytes [228..259]
        uint256 hookLen = hookData.length;
        for (uint256 i = 0; i < 32; i++) {
            body[228 + i] = bytes1(uint8(hookLen >> (248 - i * 8)));
        }

        // hookData payload at bytes [260..]
        for (uint256 i = 0; i < hookData.length; i++) {
            body[260 + i] = hookData[i];
        }

        // Mint USDC to the receiver to cover the deposit.
        usdc.mint(address(cctpReceiver), amount);

        vm.prank(address(transmitter));
        bool ok = cctpReceiver.handleReceiveMessage(BASE_DOMAIN, bytes32(0), body);

        assertTrue(ok, "handleReceiveMessage should return true");
        assertGt(treasury.getPrincipal(agent), 0, "agent principal should be > 0 after versioned body decode");
    }

    // ── MockMessageTransmitter integration ───────────────────────────────────

    function test_simulateReceive_via_transmitter() public {
        uint256 amount = 75e6;
        bytes memory hookData = CCTPMessageLib.encodeDepositHookData(agent1);

        // Give the mock transmitter enough USDC to forward.
        usdc.mint(address(transmitter), amount);

        transmitter.simulateReceive(
            address(cctpReceiver),
            BASE_DOMAIN,
            amount,
            bytes32(0),
            hookData
        );

        assertEq(treasury.getPrincipal(agent1), amount);
    }
}
