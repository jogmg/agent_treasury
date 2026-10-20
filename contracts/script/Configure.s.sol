// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";

/// @title Configure
/// @notice Post-deploy wiring script.
///         Run after Deploy.s.sol with the deployed addresses set in env.
///
/// @dev This script:
///      1. Wires CCTPReceiver → treasury, treasury → receiver, adapter → treasury.
///      2. Sets keeper address on treasury + adapter.
///      3. Registers vault configs (vaults added here are empty shells;
///         real Morpho vault addresses TODO_RESOLVE on Arc).
///      4. Sets the defaultVaultId.
///      5. Initiates Ownable2Step ownership transfer to the final owner (multisig).
///         The new owner must call acceptOwnership() in a follow-up tx.
///
/// Required env vars (from Deploy.s.sol output):
///   ARC_TREASURY_ADDRESS, ARC_ADAPTER_ADDRESS, ARC_RECEIVER_ADDRESS
///   KEEPER_ADDRESS, FINAL_OWNER_ADDRESS
///
/// Vault env vars (TODO_RESOLVE — must be set when real Morpho vault addresses are known):
///   VAULT_1_ADDRESS  (conservative)  — TODO_RESOLVE: Morpho vault on Arc
///   VAULT_2_ADDRESS  (balanced)      — TODO_RESOLVE: Morpho vault on Arc
///   VAULT_3_ADDRESS  (aggressive)    — TODO_RESOLVE: Morpho vault on Arc
///   DEFAULT_VAULT_ID (1 | 2 | 3)
///
/// Run:
///   forge script contracts/script/Configure.s.sol \
///     --rpc-url $ARC_TESTNET_RPC_URL \
///     --broadcast \
///     --sender $DEPLOYER_ADDRESS \
///     -vvvv
contract Configure is Script {
    function run() external {
        address treasuryAddr = vm.envAddress("ARC_TREASURY_ADDRESS");
        address adapterAddr  = vm.envAddress("ARC_ADAPTER_ADDRESS");
        address receiverAddr = vm.envAddress("ARC_RECEIVER_ADDRESS");
        address keeperAddr   = vm.envAddress("KEEPER_ADDRESS");
        address finalOwner   = vm.envAddress("FINAL_OWNER_ADDRESS");

        // Vault addresses — TODO_RESOLVE before deploying with real vaults.
        address vault1Addr = vm.envOr("VAULT_1_ADDRESS", address(0));
        address vault2Addr = vm.envOr("VAULT_2_ADDRESS", address(0));
        address vault3Addr = vm.envOr("VAULT_3_ADDRESS", address(0));
        uint256 defaultVaultId = vm.envOr("DEFAULT_VAULT_ID", uint256(1));

        MorphoVaultAdapter adapter  = MorphoVaultAdapter(adapterAddr);
        AgentTreasury      treasury = AgentTreasury(treasuryAddr);
        CCTPReceiver       receiver = CCTPReceiver(receiverAddr);

        vm.startBroadcast();

        // ── Wire references ───────────────────────────────────────────────────
        receiver.setTreasury(treasuryAddr);
        adapter.setTreasury(treasuryAddr);
        // treasury already has receiver from Deploy, but sync in case addresses changed.
        treasury.setGatewayReceiver(receiverAddr);
        treasury.setMorphoAdapter(adapterAddr);

        // ── Set keeper ────────────────────────────────────────────────────────
        treasury.setKeeper(keeperAddr);
        adapter.setKeeper(keeperAddr);

        // ── Register vaults ───────────────────────────────────────────────────
        // Vault 1: Conservative (10 USDC min)
        if (vault1Addr != address(0)) {
            adapter.addVault(1, vault1Addr, "USDC Core",   "mUSDC-CORE",   10e6);
            console2.log("Registered vault 1 (Conservative):", vault1Addr);
        } else {
            console2.log("SKIP vault 1 - VAULT_1_ADDRESS not set (TODO_RESOLVE)");
        }

        // Vault 2: Balanced (100 USDC min)
        if (vault2Addr != address(0)) {
            adapter.addVault(2, vault2Addr, "USDC Steady", "mUSDC-STEADY", 100e6);
            console2.log("Registered vault 2 (Balanced):", vault2Addr);
        } else {
            console2.log("SKIP vault 2 - VAULT_2_ADDRESS not set (TODO_RESOLVE)");
        }

        // Vault 3: Aggressive (500 USDC min)
        if (vault3Addr != address(0)) {
            adapter.addVault(3, vault3Addr, "USDC Growth", "mUSDC-GROWTH", 500e6);
            console2.log("Registered vault 3 (Aggressive):", vault3Addr);
        } else {
            console2.log("SKIP vault 3 - VAULT_3_ADDRESS not set (TODO_RESOLVE)");
        }

        // ── Set default vault ─────────────────────────────────────────────────
        treasury.setDefaultVaultId(defaultVaultId);
        console2.log("Default vault ID:", defaultVaultId);

        // ── Initiate ownership transfer (Ownable2Step) ────────────────────────
        // The new owner must call acceptOwnership() in a follow-up transaction.
        treasury.transferOwnership(finalOwner);
        adapter.transferOwnership(finalOwner);
        receiver.transferOwnership(finalOwner);
        console2.log("Ownership transfer initiated to:", finalOwner);
        console2.log("Final owner must call acceptOwnership() on each contract.");

        vm.stopBroadcast();

        console2.log("\n=== Configuration complete ===");
        console2.log("Run acceptOwnership() on:");
        console2.log("  AgentTreasury      :", treasuryAddr);
        console2.log("  MorphoVaultAdapter :", adapterAddr);
        console2.log("  CCTPReceiver       :", receiverAddr);
    }
}
