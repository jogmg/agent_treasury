// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICCTPReceiverV2} from "./interfaces/ICCTPReceiverV2.sol";
import {IAgentTreasury} from "./interfaces/IAgentTreasury.sol";
import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";

/// @title CCTPReceiverV2
/// @notice Atomic inbound CCTP v2 receiver for Arc + AgentTreasury.
///
/// @dev Why this contract exists:
///      CCTP v2 does not auto-call a hook on the destination. The destination
///      MessageTransmitterV2 mints USDC to the `mintRecipient` and, if the
///      destination TokenMessenger has a hook handler, calls it. The deployed
///      CCTPReceiver (v1) tried to decode the hook data from the wrong offset:
///      it read a 32-byte length word at body byte 228, but the real
///      BurnMessageV2 body has raw hook data starting at byte 228. As a result
///      every real inbound message was routed to a default beneficiary instead
///      of the agent.
///
///      This receiver takes the safe path:
///        1. The source burn sets mintRecipient = receiver and
///           destinationCaller = receiver, so only this contract can deliver
///           the message.
///        2. `receiveAndProcess` is permissionless. It validates the full
///           attested message, calls MessageTransmitterV2.receiveMessage,
///           verifies the mint arrived, transfers the USDC to AgentTreasury,
///           and calls recordDeposit(agent, amount, sourceDomain).
///        3. The source domain comes from the message header, so inbound
///           deposits are attributed to the real source chain (e.g. Base 6).
///        4. Owner-only fallbacks recover legacy messages delivered by a
///           relayer, malformed hook data, or stray USDC. The normal path has
///           no owner involvement and no default beneficiary.
///
/// @dev Message layout (CCTP v2):
///      Header (148 bytes):
///        [0..4)     version (uint32)
///        [4..8)     sourceDomain (uint32)
///        [8..12)    destinationDomain (uint32)
///        [12..44)   nonce (bytes32)
///        [44..76)   sender (bytes32)
///        [76..108)  recipient (bytes32)
///        [108..140) destinationCaller (bytes32)
///        [140..144) minFinalityThreshold (uint32)
///        [144..148) finalityThresholdExecuted (uint32)
///      Body (BurnMessageV2, 228 fixed bytes):
///        [148..152) version (uint32)
///        [152..184) burnToken (bytes32)
///        [184..216) mintRecipient (bytes32)
///        [216..248) amount (uint256)
///        [248..280) messageSender (bytes32)
///        [280..312) maxFee (uint256)
///        [312..344) feeExecuted (uint256)
///        [344..376) expirationBlock (uint256)
///        [376..)    hookData (raw; first 32 bytes = abi.encode(agent))
contract CCTPReceiverV2 is ICCTPReceiverV2, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice CCTP domain of Arc. This contract is Arc-specific.
    uint32 public constant ARC_DOMAIN = 26;

    uint256 private constant HEADER_LENGTH = 148;
    uint256 private constant BODY_FIXED_LENGTH = 228;
    uint256 private constant MIN_MESSAGE_LENGTH = HEADER_LENGTH + BODY_FIXED_LENGTH; // 376
    uint256 private constant AGENT_OFFSET = MIN_MESSAGE_LENGTH; // 376
    uint256 private constant MIN_HOOK_MESSAGE_LENGTH = AGENT_OFFSET + 32; // 408

    /// @notice Arc USDC (6 decimals). Immutable: the token never changes.
    IERC20 public immutable usdc;

    /// @notice Circle's MessageTransmitterV2 on Arc.
    IMessageTransmitterV2 public trustedTransmitter;

    /// @notice AgentTreasury that receives the USDC and records the source domain.
    IAgentTreasury public treasury;

    /// @notice Message hashes already credited or rescued (extra replay guard).
    mapping(bytes32 => bool) public override processedMessages;

    error ZeroAddress();
    error InvalidMessageLength();
    error UnsupportedMessageVersion();
    error WrongDestinationDomain();
    error WrongDestinationCaller();
    error WrongMintRecipient();
    error ZeroAmount();
    error InvalidAgent();
    error AlreadyProcessed();
    error MessageNotDelivered();
    error ReceiveFailed();
    error MintMismatch();

    event MessageProcessed(
        address indexed agent,
        uint32 indexed sourceDomain,
        bytes32 indexed nonce,
        uint256 amount,
        bytes32 messageHash
    );
    event MessageRescued(
        address indexed to,
        uint32 indexed sourceDomain,
        bytes32 indexed nonce,
        uint256 amount,
        bytes32 messageHash
    );
    event TreasuryUpdated(address indexed treasury);
    event TrustedTransmitterUpdated(address indexed transmitter);
    event USDCRescued(address indexed to, uint256 amount);

    struct Envelope {
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 nonce;
        bytes32 destinationCaller;
        bytes32 mintRecipient;
        uint256 amount;
    }

    constructor(
        address initialOwner,
        address transmitter,
        address usdc_,
        address treasury_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            transmitter == address(0) ||
            usdc_ == address(0) ||
            treasury_ == address(0)
        ) revert ZeroAddress();

        trustedTransmitter = IMessageTransmitterV2(transmitter);
        usdc = IERC20(usdc_);
        treasury = IAgentTreasury(treasury_);

        emit TrustedTransmitterUpdated(transmitter);
        emit TreasuryUpdated(treasury_);
    }

    // ── Normal inbound path ──────────────────────────────────────────────────

    /// @inheritdoc ICCTPReceiverV2
    function receiveAndProcess(bytes calldata message, bytes calldata attestation)
        external
        override
        nonReentrant
        whenNotPaused
        returns (address agent, uint256 amount)
    {
        Envelope memory envelope = _parseEnvelope(message);
        agent = _decodeAgent(message);
        bytes32 messageHash = keccak256(message);

        if (processedMessages[messageHash]) revert AlreadyProcessed();

        // Set before the external calls (CEI). The whole transaction reverts if
        // receiveMessage or recordDeposit fails, including this flag.
        processedMessages[messageHash] = true;

        _receive(message, attestation, envelope.amount);
        _credit(envelope, agent, messageHash);

        amount = envelope.amount;
    }

    // ── Owner fallbacks ──────────────────────────────────────────────────────

    /// @inheritdoc ICCTPReceiverV2
    /// @dev For a message that a relayer already delivered to this contract
    ///      (destinationCaller = 0 in the source burn), so the USDC is already
    ///      here. Verifies the nonce was used before crediting.
    function processDeliveredMessage(bytes calldata message)
        external
        override
        onlyOwner
        nonReentrant
        whenNotPaused
        returns (address agent, uint256 amount)
    {
        Envelope memory envelope = _parseEnvelope(message);
        agent = _decodeAgent(message);
        bytes32 messageHash = keccak256(message);

        if (processedMessages[messageHash]) revert AlreadyProcessed();
        if (trustedTransmitter.usedNonces(envelope.nonce) == 0) revert MessageNotDelivered();

        processedMessages[messageHash] = true;
        _credit(envelope, agent, messageHash);

        amount = envelope.amount;
    }

    /// @inheritdoc ICCTPReceiverV2
    /// @dev Last-resort path for malformed hook data. Delivers the message and
    ///      sends the USDC to `to` instead of the treasury. No hook data is
    ///      decoded. Owner-only so a malformed message cannot be used to bypass
    ///      agent accounting.
    function receiveAndRescue(bytes calldata message, bytes calldata attestation, address to)
        external
        override
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (to == address(0)) revert ZeroAddress();

        Envelope memory envelope = _parseEnvelope(message);
        bytes32 messageHash = keccak256(message);

        if (processedMessages[messageHash]) revert AlreadyProcessed();

        processedMessages[messageHash] = true;
        _receive(message, attestation, envelope.amount);

        usdc.safeTransfer(to, envelope.amount);

        emit MessageRescued(to, envelope.sourceDomain, envelope.nonce, envelope.amount, messageHash);
        amount = envelope.amount;
    }

    /// @inheritdoc ICCTPReceiverV2
    function rescueUSDC(address to, uint256 amount) external override onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransfer(to, amount);
        emit USDCRescued(to, amount);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setTreasury(address newTreasury) external override onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = IAgentTreasury(newTreasury);
        emit TreasuryUpdated(newTreasury);
    }

    function setTrustedTransmitter(address newTransmitter) external override onlyOwner {
        if (newTransmitter == address(0)) revert ZeroAddress();
        trustedTransmitter = IMessageTransmitterV2(newTransmitter);
        emit TrustedTransmitterUpdated(newTransmitter);
    }

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /// @dev Calls the attested transmitter and verifies the expected USDC was
    ///      minted to this contract. A pre-existing balance is preserved.
    function _receive(bytes calldata message, bytes calldata attestation, uint256 expectedAmount)
        private
    {
        uint256 balanceBefore = usdc.balanceOf(address(this));

        bool success = trustedTransmitter.receiveMessage(message, attestation);
        if (!success) revert ReceiveFailed();

        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore + expectedAmount) revert MintMismatch();
    }

    /// @dev Forward the minted USDC to the treasury and credit the real source
    ///      domain. The treasury deploys the USDC into the active vault.
    function _credit(Envelope memory envelope, address agent, bytes32 messageHash) private {
        usdc.safeTransfer(address(treasury), envelope.amount);
        treasury.recordDeposit(agent, envelope.amount, envelope.sourceDomain);

        emit MessageProcessed(
            agent,
            envelope.sourceDomain,
            envelope.nonce,
            envelope.amount,
            messageHash
        );
    }

    /// @dev Validate the fixed header + BurnMessageV2 fields. Hook data is not
    ///      touched here, so the owner rescue path works even when it is
    ///      malformed.
    function _parseEnvelope(bytes calldata message) private view returns (Envelope memory envelope) {
        if (message.length < MIN_MESSAGE_LENGTH) revert InvalidMessageLength();

        uint32 version;
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 nonce;
        bytes32 destinationCaller;
        uint32 bodyVersion;
        bytes32 mintRecipient;
        uint256 amount;

        assembly {
            version := shr(224, calldataload(message.offset))
            sourceDomain := shr(224, calldataload(add(message.offset, 4)))
            destinationDomain := shr(224, calldataload(add(message.offset, 8)))
            nonce := calldataload(add(message.offset, 12))
            destinationCaller := calldataload(add(message.offset, 108))
            bodyVersion := shr(224, calldataload(add(message.offset, 148)))
            mintRecipient := calldataload(add(message.offset, 184))
            amount := calldataload(add(message.offset, 216))
        }

        if (version != 1 || bodyVersion != 1) revert UnsupportedMessageVersion();
        if (destinationDomain != ARC_DOMAIN) revert WrongDestinationDomain();
        if (destinationCaller != bytes32(0) && destinationCaller != _self()) {
            revert WrongDestinationCaller();
        }
        // The BurnMessageV2 `burnToken` is the SOURCE-chain token (e.g. Base
        // USDC), not Arc USDC. Circle's destination TokenMessenger maps it to
        // the local token, so comparing it to `usdc` here rejects every real
        // cross-chain message. The minted token is proven by the USDC balance
        // delta in `_receive` instead.
        if (mintRecipient != _self()) revert WrongMintRecipient();
        if (amount == 0) revert ZeroAmount();

        envelope = Envelope({
            sourceDomain: sourceDomain,
            destinationDomain: destinationDomain,
            nonce: nonce,
            destinationCaller: destinationCaller,
            mintRecipient: mintRecipient,
            amount: amount
        });
    }

    /// @dev The real BurnMessageV2 body has raw hook data at byte 228 (absolute
    ///      376). The source app sends abi.encode(agent), i.e. one 32-byte
    ///      word. Reject any high bytes so a malformed address cannot be
    ///      truncated into a valid one.
    function _decodeAgent(bytes calldata message) private pure returns (address agent) {
        if (message.length < MIN_HOOK_MESSAGE_LENGTH) revert InvalidAgent();

        uint256 word;
        assembly {
            word := calldataload(add(message.offset, 376))
        }

        if (word >> 160 != 0) revert InvalidAgent();
        agent = address(uint160(word));
        if (agent == address(0)) revert InvalidAgent();
    }

    function _self() private view returns (bytes32) {
        return _addressToBytes32(address(this));
    }

    function _addressToBytes32(address value) private pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }
}
