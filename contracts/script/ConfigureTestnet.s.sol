// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";

/// @title ConfigureTestnet
/// @notice Post-deploy wiring for Arc Testnet.
///         Does NOT initiate Ownable2Step handoff — ownership stays with deployer
///         until the production multisig is confirmed.
///
/// Steps performed:
///   1. adapter.setTreasury(treasury)
///   2. receiver.setTreasury(treasury)
///   3. treasury.setMorphoAdapter(adapter)    (already set at deploy, re-sync)
///   4. treasury.setGatewayReceiver(receiver) (already set at deploy, re-sync)
///   5. adapter.setKeeper(deployer)
///   6. treasury.setKeeper(deployer)
///   7. adapter.addVault(1, vault, "USDC Core", "mUSDC-CORE", 10e6)
///   8. adapter.setVaultAPY(1, 4.2e16)        (~4.2% APY)
///   9. treasury.setDefaultVaultId(1)
///
/// Required env vars:
///   ARC_TREASURY_ADDRESS, ARC_ADAPTER_ADDRESS, ARC_RECEIVER_ADDRESS,
///   DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, VAULT_1_ADDRESS
///
/// Run:
///   forge script contracts/script/ConfigureTestnet.s.sol \
///     --rpc-url $ARC_TESTNET_RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     -vvvv
contract ConfigureTestnet is Script {
    function run() external {
        address treasuryAddr = vm.envAddress("ARC_TREASURY_ADDRESS");
        address adapterAddr  = vm.envAddress("ARC_ADAPTER_ADDRESS");
        address receiverAddr = vm.envAddress("ARC_RECEIVER_ADDRESS");
        address deployerAddr = vm.envAddress("DEPLOYER_ADDRESS");
        address vault1Addr   = vm.envAddress("VAULT_1_ADDRESS");

        require(treasuryAddr != address(0), "ARC_TREASURY_ADDRESS not set");
        require(adapterAddr  != address(0), "ARC_ADAPTER_ADDRESS not set");
        require(receiverAddr != address(0), "ARC_RECEIVER_ADDRESS not set");
        require(deployerAddr != address(0), "DEPLOYER_ADDRESS not set");
        require(vault1Addr   != address(0), "VAULT_1_ADDRESS not set");

        MorphoVaultAdapter adapter  = MorphoVaultAdapter(adapterAddr);
        AgentTreasury      treasury = AgentTreasury(treasuryAddr);
        CCTPReceiver       receiver = CCTPReceiver(receiverAddr);

        vm.startBroadcast();

        // ── 1-4: Wire references ─────────────────────────────────────────────
        adapter.setTreasury(treasuryAddr);
        receiver.setTreasury(treasuryAddr);
        treasury.setMorphoAdapter(adapterAddr);
        treasury.setGatewayReceiver(receiverAddr);
        console2.log("References wired.");

        // ── 5-6: Set keeper = deployer (automation role; not agent-privileged) ─
        adapter.setKeeper(deployerAddr);
        treasury.setKeeper(deployerAddr);
        console2.log("Keeper set to deployer:", deployerAddr);

        // ── 7: Register vault 1 (Arc Earn Kit conservative, ~4.2% APY) ────────
        adapter.addVault(1, vault1Addr, "USDC Core", "mUSDC-CORE", 10e6);
        console2.log("Vault 1 registered:", vault1Addr);

        // ── 8: Record on-chain APY for the UI ────────────────────────────────
        // 4.2e16 = 4.2% in 1e18-scaled bps (4.2 / 100 * 1e18)
        adapter.setVaultAPY(1, 42_000_000_000_000_000); // 4.2e16
        console2.log("Vault 1 APY set: 4.2e16 (4.2%)");

        // ── 9: Set defaultVaultId = 1 ─────────────────────────────────────────
        treasury.setDefaultVaultId(1);
        console2.log("Default vault ID set to 1.");

        vm.stopBroadcast();

        console2.log("=== ConfigureTestnet complete ===");
        console2.log("No ownership transfer initiated - deployer retains ownership.");
        console2.log("Run smoke tests:");
        console2.log("  cast call $ARC_TREASURY_ADDRESS 'getTotalBalance(address)(uint256)' $DEPLOYER_ADDRESS");
        console2.log("  cast call $ARC_ADAPTER_ADDRESS  'getVaultConfig(uint256)(address,string,string,uint256,bool)' 1");
        console2.log("  cast call $ARC_ADAPTER_ADDRESS  'vaultAPY(uint256)(uint256)' 1");
        console2.log("  cast call $ARC_TREASURY_ADDRESS 'paused()(bool)'");
    }
}
