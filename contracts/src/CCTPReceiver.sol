// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard}        from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}                 from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}              from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICCTPReceiver}          from "./interfaces/ICCTPReceiver.sol";
import {IAgentTreasury}         from "./interfaces/IAgentTreasury.sol";
import {CCTPMessageLib}         from "./libraries/CCTPMessageLib.sol";
import {Errors}                 from "./libraries/Errors.sol";

/// @title CCTPReceiver
/// @notice Receives CCTP v2 messages on Arc and routes minted USDC to AgentTreasury.
///
/// @dev Two viable inbound patterns (both implemented):
///      (A) Hook pattern: MessageTransmitterV2 calls handleReceiveMessage automatically
///          after minting USDC to this contract address (mintRecipient = this).
///      (B) Relayer pattern: a trusted relayer calls receiveMessage(message, attestation)
///          on Arc's MessageTransmitterV2, which internally triggers handleReceiveMessage
///          (same hook), or the relayer calls our handleReceiveMessage directly (guarded).
///
///      The relayer path is the default for MVP. Pattern (A) requires Circle to approve
///      a hook registration on the destination; Pattern (B) works permissionlessly.
///      Trade-off documented in docs/ARCHITECTURE.md.
///
/// @dev Fallback safety: if hookData is empty/malformed, credit USDC to `defaultBeneficiary`
///      rather than reverting — the USDC has already been minted so a revert would strand funds.
///
/// @dev Security: caller must be the trusted MessageTransmitterV2 on Arc (or owner in tests).
contract CCTPReceiver is ICCTPReceiver, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Events ────────────────────────────────────────────────────────────────
    event CCTPMessageHandled(uint32 indexed sourceDomain, address indexed agent, uint256 amount);
    event DepositRerouted(address indexed defaultBeneficiary, uint256 amount, bytes hookData);
    event TreasuryUpdated(address indexed treasury);
    event DefaultBeneficiaryUpdated(address indexed beneficiary);
    event TrustedTransmitterUpdated(address indexed transmitter);

    // ── State ─────────────────────────────────────────────────────────────────
    /// @notice The AgentTreasury this receiver routes funds to.
    IAgentTreasury public treasury;

    /// @notice The trusted Circle MessageTransmitterV2 on Arc.
    ///         TODO_RESOLVE: Arc mainnet = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
    ///                       Arc testnet = resolve from Circle docs
    address public trustedTransmitter;

    /// @notice Fallback beneficiary for malformed hookData.
    ///         Should be set to the treasury owner / a safe address.
    address public defaultBeneficiary;

    /// @notice USDC ERC-20 on Arc.
    ///         TODO_RESOLVE: Arc mainnet = 0x3600000000000000000000000000000000000000
    ///                       Arc testnet = resolve from Circle docs
    IERC20 public usdc;

    // ── Constructor ───────────────────────────────────────────────────────────
    /// @param _trustedTransmitter  MessageTransmitterV2 address on Arc. TODO_RESOLVE for testnet.
    /// @param _usdc                USDC ERC-20 address on Arc.       TODO_RESOLVE for testnet.
    /// @param _defaultBeneficiary  Fallback address for malformed hookData.
    /// @param _treasury            AgentTreasury address (may be set later via setTreasury).
    /// @param initialOwner         Contract owner.
    constructor(
        address _trustedTransmitter,
        address _usdc,
        address _defaultBeneficiary,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_trustedTransmitter == address(0)) revert Errors.ZeroAddress();
        if (_usdc == address(0)) revert Errors.ZeroAddress();
        if (_defaultBeneficiary == address(0)) revert Errors.ZeroAddress();

        trustedTransmitter = _trustedTransmitter;
        usdc               = IERC20(_usdc);
        defaultBeneficiary = _defaultBeneficiary;
        treasury           = IAgentTreasury(_treasury); // may be address(0) initially
    }

    // ── CCTP v2 hook interface ─────────────────────────────────────────────────

    /// @notice Called by MessageTransmitterV2 after minting USDC to this contract.
    ///         Decodes the agent from hookData and calls treasury.recordDeposit.
    ///
    /// @dev Implements the Circle CCTP v2 IMessageHandlerV2 hook interface.
    ///      Reference: https://developers.circle.com/cctp/ (hook receiver pattern).
    ///
    /// @param sourceDomain  The CCTP domain of the originating chain.
    /// @param messageBody   ABI-encoded: (mintRecipient bytes32, amount uint256, mintToken bytes32,
    ///                      burnToken bytes32, hookData bytes). We extract amount and hookData.
    /// @return              true to acknowledge the hook.
    function handleReceiveMessage(
        uint32  sourceDomain,
        bytes32, /* sender */
        bytes   calldata messageBody
    ) external override nonReentrant returns (bool) {
        if (msg.sender != trustedTransmitter && msg.sender != owner()) revert Errors.UntrustedCaller();

        // Decode the CCTP v2 message body.
        // CCTP v2 BurnMessageV2 body (from Circle spec):
        //   version         uint32  (first 4 bytes, already stripped by transmitter)
        //   burnToken       bytes32
        //   mintRecipient   bytes32
        //   amount          uint256
        //   messageSender   bytes32
        //   maxFee          uint256
        //   feeExecuted     uint256
        //   expirationBlock uint256
        //   hookData        bytes
        //
        // In practice the transmitter calls us with the body after stripping the version header.
        // We decode what we need: amount and hookData.
        (uint256 amount, bytes memory hookData) = _decodeMessageBody(messageBody);

        address agent;
        bool decoded;
        if (hookData.length >= 32) {
            agent   = _safeDecodeAgent(hookData);
            decoded = (agent != address(0));
        }

        if (!decoded || agent == address(0)) {
            // Malformed hookData: route to default beneficiary instead of reverting.
            emit DepositRerouted(defaultBeneficiary, amount, hookData);
            usdc.safeTransfer(defaultBeneficiary, amount);
            return true;
        }

        // Transfer USDC to the treasury and record the deposit.
        usdc.safeTransfer(address(treasury), amount);
        treasury.recordDeposit(agent, amount, sourceDomain);

        emit CCTPMessageHandled(sourceDomain, agent, amount);
        return true;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setTreasury(address _treasury) external override onlyOwner {
        if (_treasury == address(0)) revert Errors.ZeroAddress();
        treasury = IAgentTreasury(_treasury);
        emit TreasuryUpdated(_treasury);
    }

    function setDefaultBeneficiary(address beneficiary) external override onlyOwner {
        if (beneficiary == address(0)) revert Errors.ZeroAddress();
        defaultBeneficiary = beneficiary;
        emit DefaultBeneficiaryUpdated(beneficiary);
    }

    function setTrustedTransmitter(address transmitter) external override onlyOwner {
        if (transmitter == address(0)) revert Errors.ZeroAddress();
        trustedTransmitter = transmitter;
        emit TrustedTransmitterUpdated(transmitter);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /// @dev Decode an agent address from a bytes-memory hook data buffer.
    ///      Returns address(0) on failure. Mirrors CCTPMessageLib.safeDecodeAgent
    ///      but accepts bytes memory instead of bytes calldata.
    function _safeDecodeAgent(bytes memory hookData) internal pure returns (address agent) {
        if (hookData.length < 32) return address(0);
        uint256 word;
        assembly {
            // First 32 bytes of the bytes memory value (skip the length prefix at hookData).
            word := mload(add(hookData, 32))
        }
        // Upper 12 bytes must be zero for a valid ABI-encoded address.
        if (word >> 160 != 0) return address(0);
        agent = address(uint160(word));
    }

    /// @dev Tolerant decoder for the CCTP v2 BurnMessageV2 body.
    ///
    ///      Two real-world layouts are handled:
    ///
    ///      Layout A (body starts with 4-byte version word):
    ///        [0..3]    version         uint32  (4 bytes)
    ///        [4..35]   burnToken       bytes32
    ///        [36..67]  mintRecipient   bytes32
    ///        [68..99]  amount          uint256   ← amount offset = 68
    ///        [100..131] messageSender  bytes32
    ///        [132..163] maxFee         uint256
    ///        [164..195] feeExecuted    uint256
    ///        [196..227] expirationBlock uint256
    ///        [228..259] hookData length uint256  ← hookDataLenOffset = 228
    ///        [260..]   hookData bytes  (raw, NOT abi-encoded)
    ///
    ///      Layout B (version already stripped by MessageTransmitter):
    ///        [0..31]   burnToken       bytes32
    ///        [32..63]  mintRecipient   bytes32
    ///        [64..95]  amount          uint256   ← amount offset = 64
    ///        [96..127] messageSender   bytes32
    ///        [128..159] maxFee         uint256
    ///        [160..191] feeExecuted    uint256
    ///        [192..223] expirationBlock uint256
    ///        [224..255] hookData length uint256  ← hookDataLenOffset = 224
    ///        [256..]   hookData bytes  (raw, NOT abi-encoded)
    ///
    ///      Fallback: simple abi.encode(uint256 amount, bytes hookData) — used by mocks.
    ///
    ///      The hookData tail is copied directly (no abi.decode) to avoid ABI head/tail confusion.
    ///      TODO_RESOLVE: validate Layout A vs B against live Arc testnet once addresses are confirmed.
    function _decodeMessageBody(bytes calldata body)
        internal
        pure
        returns (uint256 amount, bytes memory hookData)
    {
        // ── Layout A: versioned (body[0..3] is version word, fixed fields start at 4) ────────
        // Minimum: 4 (version) + 7*32 (fixed fields) = 228 bytes.
        if (body.length >= 228) {
            // Peek at first 4 bytes: treat as Layout A if they look like a small version number
            // (≤ 0xFFFF, i.e. upper 2 bytes are zero). This heuristic avoids confusing
            // a large burnToken value for a version.
            uint32 candidate;
            assembly { candidate := shr(224, calldataload(body.offset)) }
            if (candidate <= 0xFFFF) {
                // Layout A confirmed.
                assembly { amount := calldataload(add(body.offset, 68)) }
                uint256 hookLen;
                assembly { hookLen := calldataload(add(body.offset, 228)) }
                if (hookLen > 0 && body.length >= 260 + hookLen) {
                    hookData = new bytes(hookLen);
                    assembly {
                        calldatacopy(add(hookData, 32), add(body.offset, 260), hookLen)
                    }
                }
                return (amount, hookData);
            }
        }

        // ── Layout B: unversioned (7 fixed fields, amount at 64, hookData len at 224) ────────
        // Minimum: 7*32 = 224 bytes.
        if (body.length >= 224) {
            assembly { amount := calldataload(add(body.offset, 64)) }
            uint256 hookLen;
            assembly { hookLen := calldataload(add(body.offset, 224)) }
            if (hookLen > 0 && body.length >= 256 + hookLen) {
                hookData = new bytes(hookLen);
                assembly {
                    calldatacopy(add(hookData, 32), add(body.offset, 256), hookLen)
                }
            }
            return (amount, hookData);
        }

        // ── Fallback: abi.encode(uint256, bytes) — used by mocks and unit tests ──────────────
        if (body.length >= 32) {
            (amount, hookData) = abi.decode(body, (uint256, bytes));
        }
    }
}
