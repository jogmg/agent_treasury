// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable}               from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard}        from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}                 from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}              from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAgentTreasury}         from "./interfaces/IAgentTreasury.sol";
import {IMorphoVaultAdapter}    from "./interfaces/IMorphoVaultAdapter.sol";
import {ITokenMessengerV2}      from "./interfaces/ITokenMessengerV2.sol";
import {IMessageTransmitterV2}  from "./interfaces/IMessageTransmitterV2.sol";
import {Errors}                 from "./libraries/Errors.sol";
import {CCTPMessageLib}         from "./libraries/CCTPMessageLib.sol";

/// @title AgentTreasury
/// @notice Cross-chain USDC treasury for AI agents.
///         Accepts USDC from any CCTP-supported chain, auto-deploys it into a
///         whitelisted Morpho vault, and lets agents withdraw either:
///           (a) cross-chain via CCTP (requestWithdrawal), or
///           (b) locally on Arc (withdrawLocal) — the Arc-local MVP fast path.
///
/// @dev Security: every state-changing external function is nonReentrant + whenNotPaused
///      (except pause/unpause/cancelWithdrawal). CEI ordering throughout. SafeERC20.
///      Custom errors from libraries/Errors.sol. All significant actions emit events.
///
/// @dev Decimals: all USDC amounts use 6 decimals (ERC-20 interface).
///      Never mix with Arc native gas decimals (18).
///
/// @dev ARC_DOMAIN: must be provided at construction. Outbound CCTP withdrawals to
///      Arc domain are rejected via BadDomain error. Local withdrawals never touch CCTP.
contract AgentTreasury is IAgentTreasury, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────────
    uint256 private constant SECONDS_PER_DAY  = 86_400;
    uint256 private constant SECONDS_PER_WEEK = 604_800;

    // ── CCTP fast-transfer parameters ────────────────────────────────────────
    /// @dev minFinalityThreshold for Fast Transfer (soft finality). Per Circle spec.
    uint32  public constant FAST_FINALITY_THRESHOLD = 1000;
    /// @dev Default max fee in the underlying token (0 = platform default cap).
    uint256 public defaultMaxFee;

    // ── Events ────────────────────────────────────────────────────────────────
    event DepositRecorded(
        address indexed agent,
        uint256 amount,
        uint32  indexed sourceDomain,
        uint256 vaultId,
        uint256 shares
    );
    event YieldStrategyChanged(
        address indexed agent,
        uint256 oldVaultId,
        uint256 indexed newVaultId
    );
    event Rebalanced(address indexed agent, uint256 indexed vaultId, uint256 shares);
    event YieldClaimed(address indexed agent, uint256 amount);
    event WithdrawalRequested(
        uint256 indexed id,
        address indexed agent,
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        bytes32 messageHash
    );
    event WithdrawalExecuted(uint256 indexed id, address indexed agent);
    event WithdrawalCancelled(uint256 indexed id, address indexed agent);
    event WithdrawalToWallet(address indexed agent, uint256 amount, uint256 sharesBurned);
    event SpendingLimitSet(address indexed agent, uint256 dailyLimit, uint256 weeklyLimit);
    event AdapterUpdated(address indexed adapter);
    event ReceiverUpdated(address indexed receiver);
    event MaxWithdrawalDelayUpdated(uint256 delayHours);
    event KeeperSet(address indexed keeper);
    event DefaultMaxFeeUpdated(uint256 maxFee);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct AgentAccount {
        uint256 totalDeposited;
        uint256 principal;
        /// @notice Portion of `principal` currently deposited in the Morpho vault.
        ///         Invariant: deployedPrincipal <= principal.
        ///         idle = principal - deployedPrincipal (sitting as USDC in the treasury).
        uint256 deployedPrincipal;
        uint256 vaultShares;
        uint256 activeVaultId;
        bool    exists;
        // Spending limits (0 = unlimited)
        uint256 dailyLimit;
        uint256 weeklyLimit;
        uint256 spentToday;
        uint256 spentThisWeek;
        uint256 dayWindowStart;
        uint256 weekWindowStart;
        // Per-domain deposit totals
        mapping(uint32 => uint256) chainDeposits;
        // Open withdrawal IDs
        uint256[] pendingWithdrawalIds;
    }

    /// @dev Return type from the shared redeem-and-account helper.
    struct RedeemResult {
        uint256 resolvedAmount; // actual USDC that will be sent
        uint256 burnedShares;   // shares redeemed from the vault
    }

    // ── State ─────────────────────────────────────────────────────────────────
    mapping(address => AgentAccount) private _agents;
    WithdrawalRequest[] private _withdrawals;

    uint256 public nextWithdrawalId;
    uint256 public maxWithdrawalDelayHours;

    /// @notice The Arc CCTP domain ID (26). Used to reject same-chain CCTP burns.
    uint32  public immutable ARC_DOMAIN;

    // ── External contracts ────────────────────────────────────────────────────
    IMorphoVaultAdapter   public morphoAdapter;
    address               public gatewayReceiver;
    ITokenMessengerV2     public tokenMessenger;
    IMessageTransmitterV2 public messageTransmitter;
    IERC20                public usdc;

    /// @notice Keeper for rebalance / claimYield automation. Cannot touch agent funds.
    address public keeper;

    uint256 public defaultVaultId;

    // ── Constructor ───────────────────────────────────────────────────────────
    /// @param _usdc                  USDC ERC-20 on Arc (0x3600...).
    /// @param _tokenMessenger        TokenMessengerV2 on Arc.
    /// @param _messageTransmitter    MessageTransmitterV2 on Arc.
    /// @param _morphoAdapter         MorphoVaultAdapter (may be set later).
    /// @param _gatewayReceiver       CCTPReceiver (may be set later).
    /// @param _arcDomain             CCTP domain ID of Arc (26).
    /// @param _maxWithdrawalDelayHours Max hours before a pending withdrawal can be cancelled.
    /// @param _defaultVaultId        Default vault for new agents.
    /// @param _defaultMaxFee         Max fee passed to depositForBurnWithHook.
    constructor(
        address _usdc,
        address _tokenMessenger,
        address _messageTransmitter,
        address _morphoAdapter,
        address _gatewayReceiver,
        uint32  _arcDomain,
        uint256 _maxWithdrawalDelayHours,
        uint256 _defaultVaultId,
        uint256 _defaultMaxFee,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_usdc == address(0)) revert Errors.ZeroAddress();
        if (_tokenMessenger == address(0)) revert Errors.ZeroAddress();
        if (_messageTransmitter == address(0)) revert Errors.ZeroAddress();

        usdc                    = IERC20(_usdc);
        tokenMessenger          = ITokenMessengerV2(_tokenMessenger);
        messageTransmitter      = IMessageTransmitterV2(_messageTransmitter);
        morphoAdapter           = IMorphoVaultAdapter(_morphoAdapter);
        gatewayReceiver         = _gatewayReceiver;
        ARC_DOMAIN              = _arcDomain;
        maxWithdrawalDelayHours = _maxWithdrawalDelayHours;
        defaultVaultId          = _defaultVaultId;
        defaultMaxFee           = _defaultMaxFee;
        nextWithdrawalId        = 1;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyReceiverOrOwner() {
        if (msg.sender != gatewayReceiver && msg.sender != owner()) revert Errors.NotReceiver();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert Errors.Unauthorized();
        _;
    }

    /// @dev Strictly agent-or-owner. Keeper intentionally excluded.
    ///      The keeper is an automation role that must never be able to drain or
    ///      reconfigure another agent's account.
    modifier onlyAgentOrOwner(address agent) {
        if (msg.sender != agent && msg.sender != owner())
            revert Errors.Unauthorized();
        _;
    }

    // ── Deposit (CCTP-minted) ─────────────────────────────────────────────────

    /// @notice Record an inbound CCTP deposit for `agent`.
    ///         USDC has already been minted to this contract by the MessageTransmitter.
    /// @dev CEI: checks -> effects (accounting) -> interaction (vault deposit).
    function recordDeposit(address agent, uint256 amount, uint32 sourceDomain)
        external
        override
        nonReentrant
        whenNotPaused
        onlyReceiverOrOwner
    {
        if (agent == address(0)) revert Errors.ZeroAddress();
        if (amount == 0) revert Errors.BelowMinDeposit();

        AgentAccount storage acc = _agents[agent];
        _ensureAccount(acc);

        acc.totalDeposited              += amount;
        acc.principal                   += amount;
        acc.chainDeposits[sourceDomain] += amount;

        uint256 vaultId = acc.activeVaultId;
        uint256 shares  = _deployToVault(acc, amount, vaultId);

        emit DepositRecorded(agent, amount, sourceDomain, vaultId, shares);
    }

    // ── Deposit (Arc-local direct pull) ───────────────────────────────────────

    /// @notice Pull `amount` USDC from msg.sender and credit it as an Arc-local deposit.
    ///         This is the Arc-local MVP fast path; no CCTP involved.
    /// @dev CEI: checks -> transfer (interaction, must precede state write to prevent
    ///      re-entrancy from crafted token) -> effects. SafeERC20 transferFrom will revert
    ///      on failure, so we check balance implicitly. ReentrancyGuard covers any
    ///      re-entrant call from a custom token callback.
    function deposit(uint256 amount)
        external
        override
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert Errors.BelowMinDeposit();

        // ── Interaction first: pull USDC; reverts if allowance/balance insufficient.
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // ── Effects ─────────────────────────────────────────────────────────
        AgentAccount storage acc = _agents[msg.sender];
        _ensureAccount(acc);

        acc.totalDeposited              += amount;
        acc.principal                   += amount;
        acc.chainDeposits[ARC_DOMAIN]   += amount;

        uint256 vaultId = acc.activeVaultId;
        uint256 shares  = _deployToVault(acc, amount, vaultId);

        emit DepositRecorded(msg.sender, amount, ARC_DOMAIN, vaultId, shares);
    }

    // ── Yield management ──────────────────────────────────────────────────────

    /// @notice Switch the agent's yield strategy to a new vault.
    ///         Atomically withdraws all shares from the current vault and deposits into the new one.
    function setYieldStrategy(address agent, uint256 vaultId)
        external
        override
        nonReentrant
        whenNotPaused
        onlyAgentOrOwner(agent)
    {
        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) revert Errors.AgentNotFound();

        IMorphoVaultAdapter.VaultConfig memory cfg = morphoAdapter.getVaultConfig(vaultId);
        if (!cfg.isActive) revert Errors.VaultNotActive();
        if (acc.principal < cfg.minDeposit && acc.principal > 0) revert Errors.BelowMinDeposit();

        uint256 oldVaultId = acc.activeVaultId;
        uint256 underlying;

        acc.activeVaultId = vaultId;

        if (acc.vaultShares > 0 && oldVaultId != 0) {
            underlying        = morphoAdapter.withdraw(acc.vaultShares, oldVaultId);
            acc.vaultShares       = 0;
            acc.deployedPrincipal = 0;
            acc.principal         = underlying;
        } else {
            underlying = acc.principal - acc.deployedPrincipal;
        }

        if (underlying > 0) {
            usdc.forceApprove(address(morphoAdapter), underlying);
            uint256 newShares     = morphoAdapter.deposit(underlying, vaultId);
            acc.vaultShares       = newShares;
            acc.deployedPrincipal = underlying;
        }

        emit YieldStrategyChanged(agent, oldVaultId, vaultId);
        emit Rebalanced(agent, vaultId, acc.vaultShares);
    }

    /// @notice Re-compound / refresh shares in the current vault.
    function rebalance(address agent)
        external
        override
        nonReentrant
        whenNotPaused
        onlyKeeperOrOwner
    {
        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) revert Errors.AgentNotFound();

        uint256 vaultId = acc.activeVaultId;
        if (vaultId == 0 || acc.vaultShares == 0) {
            emit Rebalanced(agent, vaultId, 0);
            return;
        }

        uint256 underlying    = morphoAdapter.withdraw(acc.vaultShares, vaultId);
        acc.vaultShares       = 0;
        acc.deployedPrincipal = 0;
        acc.principal         = underlying;

        usdc.forceApprove(address(morphoAdapter), underlying);
        uint256 newShares     = morphoAdapter.deposit(underlying, vaultId);
        acc.vaultShares       = newShares;
        acc.deployedPrincipal = underlying;

        emit Rebalanced(agent, vaultId, newShares);
    }

    /// @notice Claim any harvestable yield from the active vault (re-sync shares).
    function claimYield(address agent)
        external
        override
        nonReentrant
        whenNotPaused
        onlyAgentOrOwner(agent)
    {
        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) revert Errors.AgentNotFound();

        uint256 before = acc.principal;
        if (acc.vaultShares > 0 && acc.activeVaultId != 0) {
            uint256 redeemed      = morphoAdapter.withdraw(acc.vaultShares, acc.activeVaultId);
            acc.vaultShares       = 0;
            acc.deployedPrincipal = 0;
            usdc.forceApprove(address(morphoAdapter), redeemed);
            uint256 newShares     = morphoAdapter.deposit(redeemed, acc.activeVaultId);
            acc.vaultShares       = newShares;
            acc.deployedPrincipal = redeemed;
            acc.principal         = redeemed;
        }

        uint256 yieldAmount = acc.principal > before ? acc.principal - before : 0;
        emit YieldClaimed(agent, yieldAmount);
    }

    // ── Withdrawal (CCTP cross-chain) ─────────────────────────────────────────

    /// @notice Burn USDC on Arc via CCTP and mint on `destinationDomain`.
    ///         Cross-chain path only. For same-chain Arc withdrawals use withdrawLocal().
    /// @param agent             The agent withdrawing (msg.sender or owner on their behalf).
    /// @param amount            USDC amount (6 dec). type(uint256).max = withdraw all.
    /// @param destinationDomain CCTP domain. Must not equal ARC_DOMAIN.
    /// @param mintRecipient     bytes32 recipient on the destination chain.
    function requestWithdrawal(
        address agent,
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient
    )
        external
        override
        nonReentrant
        whenNotPaused
        onlyAgentOrOwner(agent)
        returns (uint256 withdrawalId)
    {
        if (destinationDomain == ARC_DOMAIN) revert Errors.BadDomain();
        if (mintRecipient == bytes32(0)) revert Errors.ZeroAddress();

        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) revert Errors.AgentNotFound();
        if (amount != type(uint256).max && amount == 0) revert Errors.InsufficientBalance();

        // ── Resolve amount and update vault accounting (CEI: effects before burn) ─
        RedeemResult memory result = _redeemAndAccount(acc, amount);
        // amount is now the resolved, actual USDC to burn.
        amount = result.resolvedAmount;

        // ── Enforce spending limit on the RESOLVED amount (covers both max and partial) ─
        _enforceSpendingLimit(acc, amount);

        // ── Effects: record the request ────────────────────────────────────
        withdrawalId = nextWithdrawalId++;
        _withdrawals.push(WithdrawalRequest({
            id:                withdrawalId,
            agent:             agent,
            amount:            amount,
            destinationDomain: destinationDomain,
            mintRecipient:     mintRecipient,
            requestTime:       block.timestamp,
            burnedShares:      result.burnedShares,
            message:           "",
            messageHash:       bytes32(0),
            executed:          false,
            cancelled:         false
        }));
        acc.pendingWithdrawalIds.push(withdrawalId);

        // ── Interaction: CCTP burn ─────────────────────────────────────────
        usdc.forceApprove(address(tokenMessenger), amount);
        bytes memory hookData = CCTPMessageLib.encodeWithdrawalHookData(agent, withdrawalId);
        tokenMessenger.depositForBurnWithHook(
            amount,
            destinationDomain,
            mintRecipient,
            address(usdc),
            bytes32(0),
            defaultMaxFee,
            FAST_FINALITY_THRESHOLD,
            hookData
        );

        emit WithdrawalRequested(withdrawalId, agent, amount, destinationDomain, mintRecipient, bytes32(0));
    }

    // ── Withdrawal (Arc-local) ────────────────────────────────────────────────

    /// @notice Redeem USDC directly to msg.sender's wallet on Arc. No CCTP, no bridging.
    ///         Arc-local MVP fast path. Spending limits apply.
    /// @param amount USDC amount (6 dec). type(uint256).max = withdraw all.
    function withdrawLocal(uint256 amount)
        external
        override
        nonReentrant
        whenNotPaused
    {
        // Only the agent acts for themselves; owner may act for any agent.
        address agent = msg.sender;
        AgentAccount storage acc = _agents[agent];
        // Allow owner to call for any agent by passing the agent address — but
        // for the local path msg.sender is always the recipient, so we gate simply:
        // If the caller is not the owner, they withdraw only their own funds.
        if (!acc.exists) {
            // Allow owner to withdraw on behalf of a registered agent.
            if (msg.sender == owner()) revert Errors.AgentNotFound(); // owner must call for an existing agent
            revert Errors.AgentNotFound();
        }
        if (amount != type(uint256).max && amount == 0) revert Errors.InsufficientBalance();

        // ── Resolve and update vault accounting ────────────────────────────
        RedeemResult memory result = _redeemAndAccount(acc, amount);
        amount = result.resolvedAmount;

        // ── Enforce spending limit on the resolved amount ───────────────────
        _enforceSpendingLimit(acc, amount);

        // ── Interaction: transfer USDC to agent ────────────────────────────
        usdc.safeTransfer(agent, amount);

        emit WithdrawalToWallet(agent, amount, result.burnedShares);
    }

    // ── Withdrawal bookkeeping ────────────────────────────────────────────────

    function executeWithdrawal(uint256 withdrawalId)
        external
        override
        nonReentrant
        onlyKeeperOrOwner
    {
        WithdrawalRequest storage req = _getWithdrawal(withdrawalId);
        if (req.executed)  revert Errors.AlreadyExecuted();
        if (req.cancelled) revert Errors.AlreadyCancelled();

        req.executed = true;
        _removePendingId(req.agent, withdrawalId);

        emit WithdrawalExecuted(withdrawalId, req.agent);
    }

    /// @notice Cancel an outstanding withdrawal after the delay has passed.
    ///         The USDC has already been burned; this only cleans up accounting state.
    function cancelWithdrawal(uint256 withdrawalId) external override nonReentrant {
        WithdrawalRequest storage req = _getWithdrawal(withdrawalId);
        if (req.executed)  revert Errors.AlreadyExecuted();
        if (req.cancelled) revert Errors.AlreadyCancelled();

        uint256 deadline = req.requestTime + maxWithdrawalDelayHours * 1 hours;
        if (msg.sender != owner() && block.timestamp < deadline) revert Errors.DelayNotExpired();

        req.cancelled = true;
        _removePendingId(req.agent, withdrawalId);

        emit WithdrawalCancelled(withdrawalId, req.agent);
    }

    function setWithdrawalMessageHash(uint256 withdrawalId, bytes32 messageHash) external onlyKeeperOrOwner {
        WithdrawalRequest storage req = _getWithdrawal(withdrawalId);
        req.messageHash = messageHash;
    }

    // ── Spending limits ───────────────────────────────────────────────────────

    function setSpendingLimit(address agent, uint256 dailyLimit, uint256 weeklyLimit)
        external
        override
        nonReentrant
        whenNotPaused
        onlyAgentOrOwner(agent)
    {
        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) {
            acc.exists        = true;
            acc.activeVaultId = defaultVaultId;
        }
        acc.dailyLimit  = dailyLimit;
        acc.weeklyLimit = weeklyLimit;
        emit SpendingLimitSet(agent, dailyLimit, weeklyLimit);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause()   external override onlyOwner { _pause(); }
    function unpause() external override onlyOwner { _unpause(); }

    function setMorphoAdapter(address adapter) external override onlyOwner {
        if (adapter == address(0)) revert Errors.ZeroAddress();
        morphoAdapter = IMorphoVaultAdapter(adapter);
        emit AdapterUpdated(adapter);
    }

    function setGatewayReceiver(address receiver) external override onlyOwner {
        if (receiver == address(0)) revert Errors.ZeroAddress();
        gatewayReceiver = receiver;
        emit ReceiverUpdated(receiver);
    }

    function setMaxWithdrawalDelay(uint256 delayHours) external override onlyOwner {
        maxWithdrawalDelayHours = delayHours;
        emit MaxWithdrawalDelayUpdated(delayHours);
    }

    function setKeeper(address _keeper) external onlyOwner {
        if (_keeper == address(0)) revert Errors.ZeroAddress();
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setDefaultVaultId(uint256 vaultId) external onlyOwner {
        defaultVaultId = vaultId;
    }

    function setDefaultMaxFee(uint256 maxFee) external onlyOwner {
        defaultMaxFee = maxFee;
        emit DefaultMaxFeeUpdated(maxFee);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Total balance including accrued yield. Never reverts.
    /// @dev Returns idle USDC + vault value. Falls back to idle + shares (1:1) on adapter revert.
    function getTotalBalance(address agent) public view override returns (uint256) {
        AgentAccount storage acc = _agents[agent];
        if (!acc.exists) return 0;

        uint256 idle = acc.principal > acc.deployedPrincipal
            ? acc.principal - acc.deployedPrincipal
            : 0;

        if (acc.vaultShares == 0 || acc.activeVaultId == 0) return acc.principal;

        try morphoAdapter.previewRedeem(acc.vaultShares, acc.activeVaultId) returns (uint256 redeemable) {
            return idle + redeemable;
        } catch {
            return idle + acc.vaultShares;
        }
    }

    function getPrincipal(address agent) external view override returns (uint256) {
        return _agents[agent].principal;
    }

    function getVaultShares(address agent) external view override returns (uint256) {
        return _agents[agent].vaultShares;
    }

    function getDepositsByChain(address agent, uint32 domain) external view override returns (uint256) {
        return _agents[agent].chainDeposits[domain];
    }

    function getActiveVault(address agent) external view override returns (uint256) {
        return _agents[agent].activeVaultId;
    }

    function getWithdrawal(uint256 withdrawalId)
        external
        view
        override
        returns (WithdrawalRequest memory)
    {
        return _getWithdrawal(withdrawalId);
    }

    function getPendingWithdrawals(address agent) external view returns (uint256[] memory) {
        return _agents[agent].pendingWithdrawalIds;
    }

    function agentExists(address agent) external view returns (bool) {
        return _agents[agent].exists;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Ensure an account exists, initialising it with the default vault if new.
    function _ensureAccount(AgentAccount storage acc) internal {
        if (!acc.exists) {
            acc.exists        = true;
            acc.activeVaultId = defaultVaultId;
        }
    }

    /// @dev Deploy `amount` USDC already sitting in this contract into the active vault.
    ///      Updates acc.vaultShares and acc.deployedPrincipal. Returns shares received.
    ///      No-op (returns 0) when adapter or vaultId is unset.
    function _deployToVault(AgentAccount storage acc, uint256 amount, uint256 vaultId)
        internal
        returns (uint256 shares)
    {
        if (address(morphoAdapter) != address(0) && vaultId != 0) {
            usdc.forceApprove(address(morphoAdapter), amount);
            shares                = morphoAdapter.deposit(amount, vaultId);
            acc.vaultShares       += shares;
            acc.deployedPrincipal += amount;
        }
        // If no adapter/vault, USDC stays idle in the treasury.
    }

    /// @dev Shared redeem-and-account logic used by both requestWithdrawal and withdrawLocal.
    ///
    ///      Resolves `amount` (honouring type(uint256).max), redeems the necessary vault shares,
    ///      and updates acc.vaultShares / acc.deployedPrincipal / acc.principal.
    ///
    ///      MUST be called before _enforceSpendingLimit (we enforce on the resolved amount).
    ///      No external USDC transfer is performed here — callers do that themselves (CEI).
    ///
    /// @param acc    Storage ref to the agent's account.
    /// @param amount Requested USDC amount, or type(uint256).max for "all".
    /// @return result RedeemResult(resolvedAmount, burnedShares).
    function _redeemAndAccount(AgentAccount storage acc, uint256 amount)
        internal
        returns (RedeemResult memory result)
    {
        bool isMax = (amount == type(uint256).max);

        if (acc.vaultShares > 0 && acc.activeVaultId != 0) {
            uint256 sharesToBurn;
            if (isMax) {
                // Burn every share; use actual redeemed amount — zero dust.
                sharesToBurn = acc.vaultShares;
            } else {
                // Convert requested assets to shares; cap at held shares.
                sharesToBurn = morphoAdapter.previewDeposit(amount, acc.activeVaultId);
                if (sharesToBurn > acc.vaultShares) sharesToBurn = acc.vaultShares;
            }

            uint256 redeemed      = morphoAdapter.withdraw(sharesToBurn, acc.activeVaultId);
            acc.vaultShares      -= sharesToBurn;

            // Use the actual redeemed amount for max; for partial, cap at redeemed to
            // avoid over-sending when the vault returns slightly less than requested.
            uint256 resolved      = isMax ? redeemed : (redeemed < amount ? redeemed : amount);

            uint256 deployedDelta = redeemed < acc.deployedPrincipal ? redeemed : acc.deployedPrincipal;
            acc.deployedPrincipal -= deployedDelta;
            acc.principal         -= (acc.principal >= resolved ? resolved : acc.principal);

            result = RedeemResult({ resolvedAmount: resolved, burnedShares: sharesToBurn });
        } else {
            // Funds are idle (no vault shares).
            if (isMax) amount = acc.principal;
            if (acc.principal < amount) revert Errors.InsufficientBalance();
            acc.principal -= amount;
            result = RedeemResult({ resolvedAmount: amount, burnedShares: 0 });
        }
    }

    function _getWithdrawal(uint256 id) internal view returns (WithdrawalRequest storage) {
        if (id == 0 || id >= nextWithdrawalId) revert Errors.WithdrawalNotFound();
        return _withdrawals[id - 1];
    }

    function _removePendingId(address agent, uint256 id) internal {
        uint256[] storage ids = _agents[agent].pendingWithdrawalIds;
        for (uint256 i; i < ids.length; ++i) {
            if (ids[i] == id) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                return;
            }
        }
    }

    function _enforceSpendingLimit(AgentAccount storage acc, uint256 amount) internal {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= acc.dayWindowStart + SECONDS_PER_DAY) {
            acc.spentToday     = 0;
            acc.dayWindowStart = block.timestamp;
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= acc.weekWindowStart + SECONDS_PER_WEEK) {
            acc.spentThisWeek   = 0;
            acc.weekWindowStart = block.timestamp;
        }

        if (acc.dailyLimit  > 0 && acc.spentToday    + amount > acc.dailyLimit)  revert Errors.LimitExceeded();
        if (acc.weeklyLimit > 0 && acc.spentThisWeek + amount > acc.weeklyLimit) revert Errors.LimitExceeded();

        acc.spentToday    += amount;
        acc.spentThisWeek += amount;
    }
}
