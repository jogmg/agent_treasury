// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {CCTPReceiverV2} from "../src/CCTPReceiverV2.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {MorphoVaultAdapter} from "../src/MorphoVaultAdapter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockMorphoVault} from "./mocks/MockMorphoVault.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";
import {MockMessageTransmitterV2} from "./mocks/MockMessageTransmitterV2.sol";

/// @notice Tests the real CCTP v2 message layout, including raw hook data at
///         body byte 228 (absolute byte 376). The v1 receiver read a 32-byte
///         length word there and misrouted every live inbound message.
contract CCTPReceiverV2Test is Test {
    CCTPReceiverV2 receiver;
    AgentTreasury treasury;
    MorphoVaultAdapter adapter;
    MockUSDC usdc;
    MockMorphoVault vault1;
    MockTokenMessenger messenger;
    MockMessageTransmitterV2 transmitter;

    address owner = address(this);
    address agent1 = makeAddr("agent1");
    address beneficiary = makeAddr("beneficiary");
    address relayer = makeAddr("relayer");

    uint32 constant ARC_DOMAIN = 26;
    uint32 constant BASE_DOMAIN = 6;
    uint256 constant VAULT_ID_1 = 1;
    uint256 constant MIN_DEPOSIT = 1e6;
    uint256 constant AMOUNT = 100e6;

    bytes32 constant NONCE = keccak256("nonce-1");

    /// @dev Base Sepolia USDC, i.e. the SOURCE-chain token that real CCTP v2
    ///      messages carry in the BurnMessageV2 `burnToken` field.
    address constant REMOTE_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function setUp() public {
        usdc = new MockUSDC();
        vault1 = new MockMorphoVault(address(usdc));
        messenger = new MockTokenMessenger();
        transmitter = new MockMessageTransmitterV2(address(usdc), ARC_DOMAIN);

        adapter = new MorphoVaultAdapter(owner);
        adapter.addVault(VAULT_ID_1, address(vault1), "USDC Core", "mUSDC-CORE", MIN_DEPOSIT);

        // The treasury needs the receiver address and the receiver needs the
        // treasury address. Deploy the receiver with a non-zero placeholder,
        // then point it at the real treasury.
        receiver = new CCTPReceiverV2(
            owner,
            address(transmitter),
            address(usdc),
            makeAddr("placeholderTreasury")
        );

        treasury = new AgentTreasury(
            address(usdc),
            address(messenger),
            address(transmitter),
            address(adapter),
            address(receiver),
            ARC_DOMAIN,
            24,
            VAULT_ID_1,
            0,
            owner
        );

        adapter.setTreasury(address(treasury));
        receiver.setTreasury(address(treasury));
    }

    // ── Message builder ──────────────────────────────────────────────────────

    function _buildMessage(
        uint32 sourceDomain,
        uint32 destinationDomain,
        bytes32 nonce,
        bytes32 destinationCaller,
        address mintRecipient,
        uint256 amount,
        bytes memory hookData
    ) internal view returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint32(1), // version
            sourceDomain,
            destinationDomain,
            nonce,
            bytes32(uint256(uint160(address(0x1111)))), // sender (source TokenMessenger)
            bytes32(uint256(uint160(address(0x2222)))), // recipient (Arc TokenMessenger)
            destinationCaller,
            uint32(2000), // minFinalityThreshold
            uint32(2000) // finalityThresholdExecuted
        );

        bytes memory body = abi.encodePacked(
            uint32(1), // BurnMessageV2 version
            _toBytes32(REMOTE_USDC), // burnToken (source-chain token)
            bytes32(uint256(uint160(mintRecipient))), // mintRecipient
            amount,
            bytes32(uint256(uint160(address(0x1111)))), // messageSender
            uint256(0), // maxFee
            uint256(0), // feeExecuted
            uint256(0), // expirationBlock
            hookData // raw hook data starts at body byte 228
        );

        return bytes.concat(header, body);
    }

    function _defaultMessage() internal view returns (bytes memory) {
        return _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );
    }

    function _toBytes32(address value) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }

    // ── Normal path ─────────────────────────────────────────────────────────

    function test_receiveAndProcess_credits_agent_and_real_source_domain() public {
        bytes memory message = _defaultMessage();

        vm.prank(relayer);
        (address credited, uint256 amount) = receiver.receiveAndProcess(message, hex"01");

        assertEq(credited, agent1);
        assertEq(amount, AMOUNT);
        assertEq(treasury.getPrincipal(agent1), AMOUNT);
        assertEq(treasury.getDepositsByChain(agent1, BASE_DOMAIN), AMOUNT);
        assertEq(treasury.getDepositsByChain(agent1, ARC_DOMAIN), 0);
        assertEq(usdc.balanceOf(address(receiver)), 0);
        assertEq(transmitter.usedNonces(NONCE), 1);
        assertTrue(receiver.processedMessages(keccak256(message)));
    }

    function test_receiveAndProcess_accepts_zero_destination_caller() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            bytes32(0),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );

        receiver.receiveAndProcess(message, hex"01");
        assertEq(treasury.getPrincipal(agent1), AMOUNT);
    }

    function test_receiveAndProcess_rejects_replay() public {
        bytes memory message = _defaultMessage();

        receiver.receiveAndProcess(message, hex"01");

        vm.expectRevert(CCTPReceiverV2.AlreadyProcessed.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_wrong_domain() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            BASE_DOMAIN, // wrong destination
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );

        vm.expectRevert(CCTPReceiverV2.WrongDestinationDomain.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_wrong_destination_caller() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(makeAddr("attacker")),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );

        vm.expectRevert(CCTPReceiverV2.WrongDestinationCaller.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_wrong_mint_recipient() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            makeAddr("wrongRecipient"),
            AMOUNT,
            abi.encode(agent1)
        );

        vm.expectRevert(CCTPReceiverV2.WrongMintRecipient.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    /// @dev Regression: real inbound messages carry the source-chain token in
    ///      `burnToken`, not Arc USDC. The first receiver compared it to Arc
    ///      USDC and reverted WrongBurnToken() on live Base Sepolia burns.
    function test_receiveAndProcess_accepts_remote_burn_token() public {
        bytes memory message = _defaultMessage();

        (address credited, uint256 amount) = receiver.receiveAndProcess(message, hex"01");

        assertEq(credited, agent1);
        assertEq(amount, AMOUNT);
        assertEq(treasury.getPrincipal(agent1), AMOUNT);
        assertEq(treasury.getDepositsByChain(agent1, BASE_DOMAIN), AMOUNT);
        assertEq(usdc.balanceOf(address(receiver)), 0);
    }

    function test_receiveAndProcess_rejects_zero_amount() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            0,
            abi.encode(agent1)
        );

        vm.expectRevert(CCTPReceiverV2.ZeroAmount.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_missing_hook_data() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            ""
        );

        vm.expectRevert(CCTPReceiverV2.InvalidAgent.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_short_hook_data() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            hex"deadbeef"
        );

        vm.expectRevert(CCTPReceiverV2.InvalidAgent.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_dirty_agent_word() public {
        uint256 dirty = uint256(uint160(agent1)) | (uint256(1) << 160);
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            abi.encode(dirty)
        );

        vm.expectRevert(CCTPReceiverV2.InvalidAgent.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    function test_receiveAndProcess_rejects_zero_agent() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            abi.encode(uint256(0))
        );

        vm.expectRevert(CCTPReceiverV2.InvalidAgent.selector);
        receiver.receiveAndProcess(message, hex"01");
    }

    // ── Owner fallbacks ─────────────────────────────────────────────────────

    function test_processDeliveredMessage_credits_after_relayer_delivery() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            bytes32(0),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );

        // A relayer delivered the message and the USDC is already here.
        usdc.mint(address(receiver), AMOUNT);
        transmitter.markDelivered(NONCE);

        (address credited, uint256 amount) = receiver.processDeliveredMessage(message);

        assertEq(credited, agent1);
        assertEq(amount, AMOUNT);
        assertEq(treasury.getPrincipal(agent1), AMOUNT);
        assertEq(treasury.getDepositsByChain(agent1, BASE_DOMAIN), AMOUNT);
        assertEq(usdc.balanceOf(address(receiver)), 0);
    }

    function test_processDeliveredMessage_only_owner() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            bytes32(0),
            address(receiver),
            AMOUNT,
            abi.encode(agent1)
        );
        usdc.mint(address(receiver), AMOUNT);
        transmitter.markDelivered(NONCE);

        vm.prank(relayer);
        vm.expectRevert();
        receiver.processDeliveredMessage(message);
    }

    function test_processDeliveredMessage_rejects_undelivered_message() public {
        bytes memory message = _defaultMessage();
        usdc.mint(address(receiver), AMOUNT);

        vm.expectRevert(CCTPReceiverV2.MessageNotDelivered.selector);
        receiver.processDeliveredMessage(message);
    }

    function test_receiveAndRescue_handles_malformed_hook_data() public {
        bytes memory message = _buildMessage(
            BASE_DOMAIN,
            ARC_DOMAIN,
            NONCE,
            _toBytes32(address(receiver)),
            address(receiver),
            AMOUNT,
            hex"deadbeef"
        );

        uint256 rescued = receiver.receiveAndRescue(message, hex"01", beneficiary);

        assertEq(rescued, AMOUNT);
        assertEq(usdc.balanceOf(beneficiary), AMOUNT);
        assertEq(treasury.getPrincipal(agent1), 0);
        assertTrue(receiver.processedMessages(keccak256(message)));
    }

    function test_receiveAndRescue_only_owner() public {
        bytes memory message = _defaultMessage();

        vm.prank(relayer);
        vm.expectRevert();
        receiver.receiveAndRescue(message, hex"01", beneficiary);
    }

    function test_rescueUSDC_only_owner_and_transfers() public {
        usdc.mint(address(receiver), 7e6);

        vm.prank(relayer);
        vm.expectRevert();
        receiver.rescueUSDC(beneficiary, 7e6);

        receiver.rescueUSDC(beneficiary, 7e6);
        assertEq(usdc.balanceOf(beneficiary), 7e6);
        assertEq(usdc.balanceOf(address(receiver)), 0);
    }

    // ── Pause / admin ───────────────────────────────────────────────────────

    function test_pause_blocks_receiveAndProcess_but_allows_rescue() public {
        bytes memory message = _defaultMessage();
        receiver.pause();

        vm.expectRevert();
        receiver.receiveAndProcess(message, hex"01");

        // Rescue is deliberately not paused so the owner can recover funds.
        receiver.receiveAndRescue(message, hex"01", beneficiary);
        assertEq(usdc.balanceOf(beneficiary), AMOUNT);

        receiver.unpause();
        assertFalse(receiver.paused());
    }

    function test_pause_only_owner() public {
        vm.prank(relayer);
        vm.expectRevert();
        receiver.pause();
    }

    function test_setTreasury_only_owner_and_updates() public {
        address newTreasury = makeAddr("newTreasury");

        vm.prank(relayer);
        vm.expectRevert();
        receiver.setTreasury(newTreasury);

        receiver.setTreasury(newTreasury);
        assertEq(address(receiver.treasury()), newTreasury);
    }

    function test_setTrustedTransmitter_only_owner_and_updates() public {
        address newTransmitter = makeAddr("newTransmitter");

        vm.prank(relayer);
        vm.expectRevert();
        receiver.setTrustedTransmitter(newTransmitter);

        receiver.setTrustedTransmitter(newTransmitter);
        assertEq(address(receiver.trustedTransmitter()), newTransmitter);
    }

    function test_constructor_rejects_zero_addresses() public {
        // Ownable rejects a zero initial owner before the body runs.
        vm.expectRevert();
        new CCTPReceiverV2(address(0), address(transmitter), address(usdc), address(treasury));

        vm.expectRevert(CCTPReceiverV2.ZeroAddress.selector);
        new CCTPReceiverV2(owner, address(0), address(usdc), address(treasury));

        vm.expectRevert(CCTPReceiverV2.ZeroAddress.selector);
        new CCTPReceiverV2(owner, address(transmitter), address(0), address(treasury));

        vm.expectRevert(CCTPReceiverV2.ZeroAddress.selector);
        new CCTPReceiverV2(owner, address(transmitter), address(usdc), address(0));
    }
}
