// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";

/// @title Deploy
/// @notice Deploy MorphoVaultAdapter, CCTPReceiver, and AgentTreasury to Arc (testnet or mainnet).
///
/// @dev All protocol addresses are read from environment variables. The script will revert
///      if any required variable is unset or holds a zero address — this is intentional.
///      See .env.example for the full list.
///
/// @dev TODO_RESOLVE items (must be set in .env before deploying):
///      - ARC_USDC             : ERC-20 USDC on Arc
///                               Mainnet: 0x3600000000000000000000000000000000000000
///                               Testnet: TODO_RESOLVE from Circle docs
///      - ARC_TOKEN_MESSENGER  : TokenMessengerV2 on Arc
///                               Mainnet: 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
///                               Testnet: TODO_RESOLVE from Circle docs
///      - ARC_MESSAGE_TRANSMITTER : MessageTransmitterV2 on Arc
///                               Mainnet: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
///                               Testnet: TODO_RESOLVE from Circle docs
///      - ARC_CCTP_DOMAIN      : CCTP domain ID for Arc (26 per spec; TODO_RESOLVE for testnet)
///      - DEPLOYER_ADDRESS     : Address that will own the deployed contracts (multisig recommended)
///      - DEFAULT_BENEFICIARY  : Fallback address for malformed CCTP hookData
///
/// Run (example):
///   forge script contracts/script/Deploy.s.sol \
///     --rpc-url $ARC_TESTNET_RPC_URL \
///     --broadcast \
///     --sender $DEPLOYER_ADDRESS \
///     -vvvv
contract Deploy is Script {
    function run() external {
        // ── Read env ──────────────────────────────────────────────────────────
        address usdc               = vm.envAddress("ARC_USDC");
        address tokenMessenger     = vm.envAddress("ARC_TOKEN_MESSENGER");
        address messageTransmitter = vm.envAddress("ARC_MESSAGE_TRANSMITTER");
        uint32  arcDomain          = uint32(vm.envUint("ARC_CCTP_DOMAIN"));
        address deployerAddress    = vm.envAddress("DEPLOYER_ADDRESS");
        address defaultBeneficiary = vm.envAddress("DEFAULT_BENEFICIARY");
        uint256 maxWithdrawalDelayHours = vm.envUint("MAX_WITHDRAWAL_DELAY_HOURS");
        uint256 defaultMaxFee      = vm.envUint("DEFAULT_MAX_FEE");

        require(usdc               != address(0), "Deploy: ARC_USDC not set");
        require(tokenMessenger     != address(0), "Deploy: ARC_TOKEN_MESSENGER not set");
        require(messageTransmitter != address(0), "Deploy: ARC_MESSAGE_TRANSMITTER not set");
        require(deployerAddress    != address(0), "Deploy: DEPLOYER_ADDRESS not set");
        require(defaultBeneficiary != address(0), "Deploy: DEFAULT_BENEFICIARY not set");
        require(arcDomain > 0,                    "Deploy: ARC_CCTP_DOMAIN not set");

        if (maxWithdrawalDelayHours == 0) maxWithdrawalDelayHours = 24;

        vm.startBroadcast();

        // ── 1. Deploy MorphoVaultAdapter ──────────────────────────────────────
        MorphoVaultAdapter adapter = new MorphoVaultAdapter(deployerAddress);
        console2.log("MorphoVaultAdapter:", address(adapter));

        // ── 2. Deploy CCTPReceiver (treasury address set after) ───────────────
        CCTPReceiver cctpReceiver = new CCTPReceiver(
            messageTransmitter,
            usdc,
            defaultBeneficiary,
            address(0), // treasury wired in Configure.s.sol
            deployerAddress
        );
        console2.log("CCTPReceiver:", address(cctpReceiver));

        // ── 3. Deploy AgentTreasury ───────────────────────────────────────────
        //      defaultVaultId = 0 (set after vaults are added via Configure.s.sol)
        AgentTreasury treasury = new AgentTreasury(
            usdc,
            tokenMessenger,
            messageTransmitter,
            address(adapter),
            address(cctpReceiver),
            arcDomain,
            maxWithdrawalDelayHours,
            0,             // defaultVaultId — set in Configure.s.sol
            defaultMaxFee,
            deployerAddress
        );
        console2.log("AgentTreasury:", address(treasury));

        vm.stopBroadcast();

        // ── Output deployment summary ────────────────────────────────────────
        console2.log("\n=== Deployment complete ===");
        console2.log("Network   :", block.chainid == 5042 ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Chain ID  :", block.chainid);
        console2.log("Deployer  :", deployerAddress);
        console2.log("");
        console2.log("Contracts:");
        console2.log("  MorphoVaultAdapter  :", address(adapter));
        console2.log("  CCTPReceiver        :", address(cctpReceiver));
        console2.log("  AgentTreasury       :", address(treasury));
        console2.log("");
        console2.log("Next step: run Configure.s.sol with these addresses set in env.");
    }
}
