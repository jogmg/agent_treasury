// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorphoVaultAdapter}  from "../../src/MorphoVaultAdapter.sol";
import {AgentTreasury}       from "../../src/AgentTreasury.sol";
import {CCTPReceiver}        from "../../src/CCTPReceiver.sol";
import {IMorphoVault}        from "../../src/interfaces/IMorphoVault.sol";
import {IMorphoVaultAdapter} from "../../src/interfaces/IMorphoVaultAdapter.sol";

/// @title MainnetDeployForkTest
/// @notice Rehearses the exact Arc mainnet deployment + wiring sequence against a
///         live fork, so the browser deploy page is validated before real money.
///         Run with:
///           ARC_MAINNET_RPC=https://rpc.mainnet.arc.io forge test \
///             --match-path test/fork/MainnetDeploy.t.sol -vv
///         Skips automatically when ARC_MAINNET_RPC is unset (CI-safe).
contract MainnetDeployForkTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address constant MSG_TRANSMITTER = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
    address constant VAULT = 0x8E357432CC12ff425c36432F312968aEb16112AF; // Galaxy USDC

    function test_deployAndWireOnArcMainnetFork() public {
        string memory rpc = vm.envOr("ARC_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 5042, "not Arc mainnet");

        address owner = makeAddr("mainnetOwner");
        vm.deal(owner, 100e18);

        vm.startPrank(owner);
        MorphoVaultAdapter adapter = new MorphoVaultAdapter(owner);
        CCTPReceiver receiver = new CCTPReceiver(
            MSG_TRANSMITTER, USDC, owner, address(0), owner
        );
        AgentTreasury treasury = new AgentTreasury(
            USDC,
            TOKEN_MESSENGER,
            MSG_TRANSMITTER,
            address(adapter),
            address(receiver),
            26,
            24,
            1,
            0,
            owner
        );

        adapter.setTreasury(address(treasury));
        receiver.setTreasury(address(treasury));
        adapter.addVault(1, VAULT, "Galaxy USDC", "arcUSDC", 5e6);
        adapter.setVaultAPY(1, 26_500_000_000_000_000);
        adapter.setKeeper(owner);
        treasury.setKeeper(owner);
        treasury.setSpendingLimit(owner, 25e6, 50e6);
        vm.stopPrank();

        assertEq(adapter.treasury(), address(treasury));
        assertEq(address(receiver.treasury()), address(treasury));
        assertEq(address(treasury.morphoAdapter()), address(adapter));
        assertEq(treasury.gatewayReceiver(), address(receiver));
        assertEq(treasury.keeper(), owner);
        assertEq(treasury.defaultVaultId(), 1);
        assertFalse(treasury.paused());

        IMorphoVaultAdapter.VaultConfig memory cfg = adapter.getVaultConfig(1);
        assertEq(cfg.vaultAddress, VAULT);
        assertEq(cfg.minDeposit, 5e6);
        assertTrue(cfg.isActive);

        // The live vault must be ERC-4626 over Arc USDC and 5 USDC must mint shares.
        assertEq(IMorphoVault(VAULT).asset(), USDC, "vault asset != USDC");
        assertGt(IMorphoVault(VAULT).convertToShares(5e6), 0, "5 USDC mints zero shares");
    }
}
