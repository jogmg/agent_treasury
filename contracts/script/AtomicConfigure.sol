// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal interface stubs — only the functions we call in configure.
interface IAdapter {
    function setTreasury(address treasury) external;
    function setKeeper(address keeper) external;
    function addVault(uint256 id, address vault, string calldata name, string calldata symbol, uint256 minDeposit) external;
    function setVaultAPY(uint256 id, uint256 apy) external;
}

interface ITreasury {
    function setMorphoAdapter(address adapter) external;
    function setGatewayReceiver(address receiver) external;
    function setKeeper(address keeper) external;
    function setDefaultVaultId(uint256 vaultId) external;
}

interface IReceiver {
    function setTreasury(address treasury) external;
}

/// @title AtomicConfigure
/// @notice Performs all post-deploy wiring of MorphoVaultAdapter, CCTPReceiver,
///         and AgentTreasury in a single constructor call.
///         Must be deployed by the same address that owns the three contracts
///         (i.e. the platform deployer 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42).
///
/// @dev Because this is called from the deployer's address, all onlyOwner checks pass.
///      The contract has no state after construction and is inert thereafter.
///
/// Addresses (Arc Testnet, confirmed Oct 2026):
///   treasury : 0xf1a181b0e15ae91a9178f8a2e9e12070a18e850d
///   adapter  : 0xb9b1795fa730b30eb6c5d3bf22382eac6f0a16c5
///   receiver : 0x5b1835728ee351c200b9f3822cbcc156e6f213d2
///   vault1   : 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88   (Morpho USDC Core ~4.2% APY)
///   keeper   : 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42   (deployer, until a real keeper is set)
contract AtomicConfigure {
    constructor() {
        address treasury = 0xf1A181b0e15AE91A9178F8A2E9e12070a18e850D;
        address adapter  = 0xb9b1795FA730B30eb6C5D3BF22382EAC6f0A16C5;
        address receiver = 0x5b1835728eE351c200b9f3822cBcC156E6f213d2;
        address vault1   = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
        address keeper   = 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42;

        // 1. adapter.setTreasury(treasury)
        IAdapter(adapter).setTreasury(treasury);

        // 2. receiver.setTreasury(treasury)
        IReceiver(receiver).setTreasury(treasury);

        // 3. treasury.setMorphoAdapter(adapter)
        ITreasury(treasury).setMorphoAdapter(adapter);

        // 4. treasury.setGatewayReceiver(receiver)
        ITreasury(treasury).setGatewayReceiver(receiver);

        // 5. adapter.setKeeper(deployer)
        IAdapter(adapter).setKeeper(keeper);

        // 6. treasury.setKeeper(deployer)
        ITreasury(treasury).setKeeper(keeper);

        // 7. adapter.addVault(1, vault1, "USDC Core", "mUSDC-CORE", 10e6)
        IAdapter(adapter).addVault(1, vault1, "USDC Core", "mUSDC-CORE", 10_000_000);

        // 8. adapter.setVaultAPY(1, 4.2e16)
        IAdapter(adapter).setVaultAPY(1, 42_000_000_000_000_000); // 4.2e16

        // 9. treasury.setDefaultVaultId(1)
        ITreasury(treasury).setDefaultVaultId(1);
    }
}
