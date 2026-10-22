// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {ArcConfig} from "./ArcConfig.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {CCTPReceiverV2} from "../src/CCTPReceiverV2.sol";

/// @title DeployReceiverV2
/// @notice Deploy the corrected inbound CCTP receiver and point the existing
///         AgentTreasury at it. This does NOT redeploy the treasury or move
///         funds.
///
/// @dev Usage (the private key is read from the environment and never printed):
///        TREASURY_ADDRESS=0x... \
///        forge script contracts/script/DeployReceiverV2.s.sol:DeployReceiverV2 \
///          --rpc-url $ARC_MAINNET_RPC --broadcast
///
///      The deployer must be the current owner of the treasury, because
///      setGatewayReceiver is onlyOwner. For the live deployments the owner
///      signs through MetaMask with scripts/receiver-deploy/index.html instead.
contract DeployReceiverV2 is Script {
    function run() external returns (CCTPReceiverV2 receiver) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");

        bool mainnet = block.chainid == ArcConfig.ARC_MAINNET_CHAIN_ID;
        bool testnet = block.chainid == ArcConfig.ARC_TESTNET_CHAIN_ID;
        require(mainnet || testnet, "Unsupported chain: expected Arc mainnet or testnet");

        address transmitter = mainnet
            ? ArcConfig.ARC_MAINNET_MESSAGE_TRANSMITTER_V2
            : ArcConfig.ARC_TESTNET_MESSAGE_TRANSMITTER_V2;

        require(treasuryAddress.code.length > 0, "Treasury has no code on this chain");
        require(transmitter.code.length > 0, "MessageTransmitterV2 has no code on this chain");

        AgentTreasury treasury = AgentTreasury(treasuryAddress);
        require(treasury.owner() == deployer, "Deployer is not the treasury owner");

        vm.startBroadcast(privateKey);

        receiver = new CCTPReceiverV2(
            deployer,
            transmitter,
            ArcConfig.ARC_USDC,
            treasuryAddress
        );

        treasury.setGatewayReceiver(address(receiver));

        vm.stopBroadcast();

        require(address(receiver.trustedTransmitter()) == transmitter, "Transmitter mismatch");
        require(address(receiver.usdc()) == ArcConfig.ARC_USDC, "USDC mismatch");
        require(address(receiver.treasury()) == treasuryAddress, "Treasury mismatch");
        require(receiver.ARC_DOMAIN() == ArcConfig.ARC_CCTP_DOMAIN, "Domain mismatch");
        require(treasury.gatewayReceiver() == address(receiver), "Treasury receiver mismatch");
        require(receiver.owner() == deployer, "Receiver owner mismatch");

        console2.log("CCTPReceiverV2:", address(receiver));
        console2.log("Treasury:", treasuryAddress);
        console2.log("Transmitter:", transmitter);
    }
}
