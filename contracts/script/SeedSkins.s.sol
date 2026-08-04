// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GameAssetRegistry} from "../src/GameAssetRegistry.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";

/// @notice 给 demo 灌一批款式，并可选地给一个测试地址发几件。
///
/// 用法：
///   REGISTRY_ADDRESS=0x... DISTRIBUTOR_ADDRESS=0x... DEMO_PLAYER=0x... \
///   forge script script/SeedSkins.s.sol:SeedSkins --rpc-url base_sepolia --broadcast
///
/// contentHash 用款式名的 keccak256 占位。真实流程里应当是 AssetBundle 的哈希，
/// 由客户端打包流水线产出 —— 详见 docs/asset-model.md。
contract SeedSkins is Script {
    struct SkinSeed {
        uint32 id;
        uint32 maxSupply;
        uint8 rarity; // 0 常见 .. 4 传说
        string name;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        GameAssetRegistry registry = GameAssetRegistry(vm.envAddress("REGISTRY_ADDRESS"));

        SkinSeed[5] memory seeds = [
            SkinSeed(1001, 10_000, 0, "Standard AK-47"),
            SkinSeed(1010, 2_500, 1, "Desert Tan M4"),
            SkinSeed(1025, 800, 2, "Urban Camo AWP"),
            SkinSeed(1042, 500, 4, "Frostbite AK-47"),
            SkinSeed(1077, 100, 4, "Solar Flare AWP")
        ];

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < seeds.length; ++i) {
            SkinSeed memory s = seeds[i];
            if (registry.isDefined(s.id)) {
                console2.log("skip (already defined):", s.name);
                continue;
            }
            registry.defineSkin(s.id, s.maxSupply, s.rarity, keccak256(bytes(s.name)));
            console2.log("defined:", s.name, s.id);
        }

        // 可选：给 demo 玩家发两件，方便直接演示衣柜和挂单
        address demoPlayer = vm.envOr("DEMO_PLAYER", address(0));
        if (demoPlayer != address(0)) {
            RewardDistributor distributor = RewardDistributor(vm.envAddress("DISTRIBUTOR_ADDRESS"));

            distributor.mintDirect(demoPlayer, 1042, 731, 2, keccak256("seed-demo-1"));
            distributor.mintDirect(demoPlayer, 1077, 120, 2, keccak256("seed-demo-2"));
            console2.log("seeded demo player:", demoPlayer);
        }

        vm.stopBroadcast();
    }
}
