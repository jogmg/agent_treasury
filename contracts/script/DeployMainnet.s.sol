// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";
import {IMorphoVault}        from "../src/interfaces/IMorphoVault.sol";
import {ArcConfig}           from "./ArcConfig.sol";

/// @title DeployMainnet
/// @notice Deploy and wire the Agent Treasury stack on Arc mainnet (chain 5042).
///
///         Safety properties enforced before any broadcast:
///           - block.chainid must be 5042
///           - USDC, TokenMessengerV2, MessageTransmitterV2 and the vault must
///             all have code at the configured addresses
///           - the vault's asset() must be Arc USDC
///           - minDeposit must be >= the vault's previewMint(1), so a deposit
///             can never round down to zero shares
///
///         The broadcaster is the owner of all three contracts, so no
///         Ownable2Step acceptance step is required. If you need a different
///         final owner, pass FINAL_OWNER_ADDRESS and accept ownership from it.
///
/// Required env:
///   DEPLOYER_ADDRESS          must equal the broadcast sender
///   FINAL_OWNER_ADDRESS       owner/keeper (usually the same EOA)
/// Optional env (defaults from ArcConfig):
///   ARC_USDC, ARC_TOKEN_MESSENGER, ARC_MESSAGE_TRANSMITTER, ARC_CCTP_DOMAIN
///   VAULT_1_ADDRESS, VAULT_1_APY, MIN_DEPOSIT
///   DAILY_LIMIT, WEEKLY_LIMIT (spending guardrails; 0 = unlimited)
contract DeployMainnet is Script {
    uint256 constant ARC_MAINNET_ID = 5_042;

    function run() external {
        require(block.chainid == ARC_MAINNET_ID, "DeployMainnet: not Arc mainnet");

        address usdc               = vm.envOr("ARC_USDC", ArcConfig.ARC_USDC);
        address tokenMessenger     = vm.envOr("ARC_TOKEN_MESSENGER", ArcConfig.ARC_MAINNET_TOKEN_MESSENGER_V2);
        address messageTransmitter = vm.envOr("ARC_MESSAGE_TRANSMITTER", ArcConfig.ARC_MAINNET_MESSAGE_TRANSMITTER_V2);
        address vault1             = vm.envOr("VAULT_1_ADDRESS", ArcConfig.VAULT_MAINNET_CONSERVATIVE);
        uint32  arcDomain          = uint32(vm.envOr("ARC_CCTP_DOMAIN", uint256(ArcConfig.ARC_CCTP_DOMAIN)));
        uint256 vaultAPY           = vm.envOr("VAULT_1_APY", uint256(26_500_000_000_000_000)); // 2.65%
        uint256 minDeposit         = vm.envOr("MIN_DEPOSIT", ArcConfig.MIN_DEPOSIT_MAINNET);
        uint256 dailyLimit         = vm.envOr("DAILY_LIMIT", uint256(25e6));
        uint256 weeklyLimit        = vm.envOr("WEEKLY_LIMIT", uint256(50e6));

        address deployer   = vm.envAddress("DEPLOYER_ADDRESS");
        address finalOwner = vm.envAddress("FINAL_OWNER_ADDRESS");
        require(deployer != address(0) && finalOwner != address(0), "DeployMainnet: zero address");
        require(msg.sender == deployer, "DeployMainnet: sender != DEPLOYER_ADDRESS");

        _requireCode(usdc, "USDC");
        _requireCode(tokenMessenger, "TokenMessengerV2");
        _requireCode(messageTransmitter, "MessageTransmitterV2");
        _requireCode(vault1, "vault");

        require(IMorphoVault(vault1).asset() == usdc, "DeployMainnet: vault asset != USDC");
        uint256 oneShareAssets = IMorphoVault(vault1).previewMint(1);
        require(minDeposit >= oneShareAssets, "DeployMainnet: minDeposit mints zero shares");

        console2.log("chainId            :", block.chainid);
        console2.log("deployer           :", deployer);
        console2.log("final owner        :", finalOwner);
        console2.log("USDC               :", usdc);
        console2.log("TokenMessengerV2   :", tokenMessenger);
        console2.log("MessageTransmitter :", messageTransmitter);
        console2.log("vault #1           :", vault1);
        console2.log("minDeposit         :", minDeposit);
        console2.log("previewMint(1)     :", oneShareAssets);

        vm.startBroadcast();

        MorphoVaultAdapter adapter = new MorphoVaultAdapter(deployer);
        CCTPReceiver receiver = new CCTPReceiver(
            messageTransmitter, usdc, deployer, address(0), deployer
        );
        AgentTreasury treasury = new AgentTreasury(
            usdc,
            tokenMessenger,
            messageTransmitter,
            address(adapter),
            address(receiver),
            arcDomain,
            ArcConfig.DEFAULT_MAX_WITHDRAWAL_DELAY_HOURS,
            1, // defaultVaultId
            0, // defaultMaxFee
            deployer
        );

        adapter.setTreasury(address(treasury));
        receiver.setTreasury(address(treasury));
        adapter.addVault(1, vault1, "Galaxy USDC", "arcUSDC", minDeposit);
        adapter.setVaultAPY(1, vaultAPY);

        // Guardrail: bound what the deployer wallet can withdraw per day/week.
        if (dailyLimit > 0 || weeklyLimit > 0) {
            treasury.setSpendingLimit(deployer, dailyLimit, weeklyLimit);
        }

        // Keep the keeper explicit (owner can do everything, but an explicit
        // keeper makes the role visible in the UI and in event logs).
        treasury.setKeeper(finalOwner);
        adapter.setKeeper(finalOwner);

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            receiver.transferOwnership(finalOwner);
            treasury.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        console2.log("=== DeployMainnet complete ===");
        console2.log("adapter  :", address(adapter));
        console2.log("receiver :", address(receiver));
        console2.log("treasury :", address(treasury));
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length > 0, string.concat("DeployMainnet: no code at ", label));
    }
}
