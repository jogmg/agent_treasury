// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";

/// @title DeployTestnet
/// @notice Deploy all three contracts to Arc Testnet in one broadcast.
///         Addresses come from .env; see .env.example for the full list.
///
/// Run:
///   forge script contracts/script/DeployTestnet.s.sol \
///     --rpc-url $ARC_TESTNET_RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     -vvvv
contract DeployTestnet is Script {
    function run() external {
        address usdc               = vm.envAddress("ARC_USDC");
        address tokenMessenger     = vm.envAddress("ARC_TOKEN_MESSENGER");
        address messageTransmitter = vm.envAddress("ARC_MESSAGE_TRANSMITTER");
        uint32  arcDomain          = uint32(vm.envUint("ARC_CCTP_DOMAIN"));
        address deployerAddress    = vm.envAddress("DEPLOYER_ADDRESS");
        uint256 maxDelayHours      = vm.envOr("MAX_WITHDRAWAL_DELAY_HOURS", uint256(24));
        uint256 defaultMaxFee      = vm.envOr("DEFAULT_MAX_FEE", uint256(0));

        require(usdc               != address(0), "ARC_USDC not set");
        require(tokenMessenger     != address(0), "ARC_TOKEN_MESSENGER not set");
        require(messageTransmitter != address(0), "ARC_MESSAGE_TRANSMITTER not set");
        require(deployerAddress    != address(0), "DEPLOYER_ADDRESS not set");
        require(arcDomain          != 0,          "ARC_CCTP_DOMAIN not set");

        vm.startBroadcast();

        // 1. MorphoVaultAdapter — owner = deployer
        MorphoVaultAdapter adapter = new MorphoVaultAdapter(deployerAddress);
        console2.log("MorphoVaultAdapter deployed:", address(adapter));

        // 2. CCTPReceiver — treasury wired in ConfigureTestnet.s.sol
        //    defaultBeneficiary = deployer (safe fallback for malformed hookData during testing)
        CCTPReceiver cctpReceiver = new CCTPReceiver(
            messageTransmitter,
            usdc,
            deployerAddress, // defaultBeneficiary
            address(0),      // treasury — set in ConfigureTestnet
            deployerAddress  // owner
        );
        console2.log("CCTPReceiver deployed:", address(cctpReceiver));

        // 3. AgentTreasury — defaultVaultId = 0 until vault registered in ConfigureTestnet
        AgentTreasury treasury = new AgentTreasury(
            usdc,
            tokenMessenger,
            messageTransmitter,
            address(adapter),
            address(cctpReceiver),
            arcDomain,
            maxDelayHours,
            0,              // defaultVaultId — set in ConfigureTestnet
            defaultMaxFee,
            deployerAddress
        );
        console2.log("AgentTreasury deployed:", address(treasury));

        vm.stopBroadcast();

        console2.log("=== DeployTestnet complete ===");
        console2.log("chainId       :", block.chainid);
        console2.log("deployer      :", deployerAddress);
        console2.log("adapter       :", address(adapter));
        console2.log("receiver      :", address(cctpReceiver));
        console2.log("treasury      :", address(treasury));
        console2.log("Next: set env vars and run ConfigureTestnet.s.sol");
    }
}
