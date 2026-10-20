// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MorphoVaultAdapter}  from "../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../src/CCTPReceiver.sol";

/// @title DeployFixedTestnet
/// @notice Deploy a fresh, fully wired Agent Treasury stack on Arc Testnet.
///
///         This is the post-CCTP-hotfix deployment. The previous AgentTreasury
///         declared a `uint64` return value on `depositForBurnWithHook`, but Arc's
///         TokenMessengerV2 returns no data, so every cross-chain withdrawal
///         reverted during ABI decoding *after* the burn. The new treasury uses
///         the corrected interface and standard CCTP finality (2000).
///
///         The deployer is the temporary owner so it can wire all three contracts
///         in one broadcast. Ownership is then handed to FINAL_OWNER_ADDRESS via
///         Ownable2Step; the final owner must call acceptOwnership() on each
///         contract (the UI exposes this).
///
/// Required env:
///   DEPLOYER_ADDRESS
///   FINAL_OWNER_ADDRESS
///   ARC_USDC
///   ARC_TOKEN_MESSENGER
///   ARC_MESSAGE_TRANSMITTER
///   ARC_CCTP_DOMAIN
///   VAULT_1_ADDRESS
/// Optional env:
///   MAX_WITHDRAWAL_DELAY_HOURS (default 24)
///   DEFAULT_MAX_FEE (default 0)
contract DeployFixedTestnet is Script {
    function run() external {
        address usdc               = vm.envAddress("ARC_USDC");
        address tokenMessenger     = vm.envAddress("ARC_TOKEN_MESSENGER");
        address messageTransmitter = vm.envAddress("ARC_MESSAGE_TRANSMITTER");
        address deployerAddress    = vm.envAddress("DEPLOYER_ADDRESS");
        address finalOwner         = vm.envAddress("FINAL_OWNER_ADDRESS");
        address vault1             = vm.envAddress("VAULT_1_ADDRESS");
        uint32  arcDomain          = uint32(vm.envUint("ARC_CCTP_DOMAIN"));
        uint256 maxDelayHours      = vm.envOr("MAX_WITHDRAWAL_DELAY_HOURS", uint256(24));
        uint256 defaultMaxFee      = vm.envOr("DEFAULT_MAX_FEE", uint256(0));

        require(usdc               != address(0), "ARC_USDC not set");
        require(tokenMessenger     != address(0), "ARC_TOKEN_MESSENGER not set");
        require(messageTransmitter != address(0), "ARC_MESSAGE_TRANSMITTER not set");
        require(deployerAddress    != address(0), "DEPLOYER_ADDRESS not set");
        require(finalOwner         != address(0), "FINAL_OWNER_ADDRESS not set");
        require(vault1             != address(0), "VAULT_1_ADDRESS not set");
        require(arcDomain          != 0,          "ARC_CCTP_DOMAIN not set");

        vm.startBroadcast();

        // Deploy and wire in a helper to avoid stack-too-deep on the 10-arg constructor.
        (address adapterAddr, address receiverAddr, address treasuryAddr) =
            _deploy(usdc, tokenMessenger, messageTransmitter, deployerAddress, finalOwner,
                    arcDomain, maxDelayHours, defaultMaxFee, vault1);

        vm.stopBroadcast();

        console2.log("=== DeployFixedTestnet complete ===");
        console2.log("chainId  :", block.chainid);
        console2.log("deployer :", deployerAddress);
        console2.log("owner    :", finalOwner);
        console2.log("adapter  :", adapterAddr);
        console2.log("receiver :", receiverAddr);
        console2.log("treasury :", treasuryAddr);
    }

    struct DeployParams {
        address usdc;
        address tokenMessenger;
        address messageTransmitter;
        address deployerAddress;
        address finalOwner;
        uint32  arcDomain;
        uint256 maxDelayHours;
        uint256 defaultMaxFee;
        address vault1;
    }

    // Internal helper: packs args into a struct to stay under the 16-slot stack limit.
    function _deploy(
        address usdc,
        address tokenMessenger,
        address messageTransmitter,
        address deployerAddress,
        address finalOwner,
        uint32  arcDomain,
        uint256 maxDelayHours,
        uint256 defaultMaxFee,
        address vault1
    ) internal returns (address adapterAddr, address receiverAddr, address treasuryAddr) {
        DeployParams memory p = DeployParams({
            usdc: usdc,
            tokenMessenger: tokenMessenger,
            messageTransmitter: messageTransmitter,
            deployerAddress: deployerAddress,
            finalOwner: finalOwner,
            arcDomain: arcDomain,
            maxDelayHours: maxDelayHours,
            defaultMaxFee: defaultMaxFee,
            vault1: vault1
        });
        return _deployFromParams(p);
    }

    function _deployFromParams(DeployParams memory p)
        internal
        returns (address adapterAddr, address receiverAddr, address treasuryAddr)
    {
        MorphoVaultAdapter adapter = new MorphoVaultAdapter(p.deployerAddress);
        CCTPReceiver cctpReceiver  = new CCTPReceiver(
            p.messageTransmitter, p.usdc, p.finalOwner, address(0), p.deployerAddress
        );
        AgentTreasury treasury = _deployTreasury(p, address(adapter), address(cctpReceiver));

        adapter.setTreasury(address(treasury));
        cctpReceiver.setTreasury(address(treasury));
        adapter.setKeeper(p.finalOwner);
        treasury.setKeeper(p.finalOwner);

        adapter.addVault(1, p.vault1, "USDC Core", "mUSDC-CORE", 10e6);
        adapter.setVaultAPY(1, 42_000_000_000_000_000);
        treasury.setDefaultVaultId(1);

        adapter.transferOwnership(p.finalOwner);
        cctpReceiver.transferOwnership(p.finalOwner);
        treasury.transferOwnership(p.finalOwner);

        return (address(adapter), address(cctpReceiver), address(treasury));
    }

    function _deployTreasury(DeployParams memory p, address adapterAddr, address receiverAddr)
        internal
        returns (AgentTreasury)
    {
        return new AgentTreasury(
            p.usdc,
            p.tokenMessenger,
            p.messageTransmitter,
            adapterAddr,
            receiverAddr,
            p.arcDomain,
            p.maxDelayHours,
            0,
            p.defaultMaxFee,
            p.deployerAddress
        );
    }
}
