// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GameAssetRegistry} from "../src/GameAssetRegistry.sol";
import {WeaponSkin} from "../src/WeaponSkin.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {SkinMarket} from "../src/SkinMarket.sol";

/// @notice 一次性部署全套合约并接好权限。
///
/// 用法：
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url base_sepolia --broadcast --verify
///
/// 必需环境变量：
///   PRIVATE_KEY             部署者私钥
///   REWARD_SIGNER_ADDRESS   后端签发 voucher 的地址（对应 KMS 里的密钥）
/// 可选：
///   ADMIN_ADDRESS           默认为部署者
///   TREASURY_ADDRESS        版税收款地址，默认为 admin
///   BASE_TOKEN_URI          元数据 API 前缀
///   ROYALTY_BPS             版税基点，默认 500 (5%)
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address admin = vm.envOr("ADMIN_ADDRESS", deployer);
        address treasury = vm.envOr("TREASURY_ADDRESS", admin);
        address rewardSigner = vm.envAddress("REWARD_SIGNER_ADDRESS");
        string memory baseTokenURI = vm.envOr("BASE_TOKEN_URI", string("https://api.example.com/v1/skin/"));
        uint96 royaltyBps = uint96(vm.envOr("ROYALTY_BPS", uint256(500)));

        vm.startBroadcast(deployerKey);

        // 1. registry —— 发行上限的强制点
        GameAssetRegistry registry = new GameAssetRegistry(deployer);

        // 2. NFT —— 不可升级，保持极简
        WeaponSkin skin = new WeaponSkin(
            "FPS Weapon Skin", "SKIN", baseTokenURI, address(registry), deployer, treasury, royaltyBps
        );

        // 3. 只有 WeaponSkin 能消耗发行额度
        registry.setMinter(address(skin));

        // 4. 奖励发放 —— 唯一持有 MINTER_ROLE 的地址
        RewardDistributor distributor = new RewardDistributor(address(skin), deployer, rewardSigner);
        skin.grantRole(skin.MINTER_ROLE(), address(distributor));

        // 5. demo 市场
        SkinMarket market = new SkinMarket(address(skin));

        // 6. 把控制权交给最终 admin，并撤掉部署者的权限
        if (admin != deployer) {
            registry.transferOwnership(admin);

            skin.grantRole(skin.DEFAULT_ADMIN_ROLE(), admin);
            skin.grantRole(skin.URI_ADMIN_ROLE(), admin);
            skin.renounceRole(skin.URI_ADMIN_ROLE(), deployer);
            skin.renounceRole(skin.DEFAULT_ADMIN_ROLE(), deployer);

            distributor.grantRole(distributor.DEFAULT_ADMIN_ROLE(), admin);
            distributor.grantRole(distributor.SIGNER_ADMIN_ROLE(), admin);
            distributor.grantRole(distributor.OPERATOR_ROLE(), admin);
            distributor.renounceRole(distributor.OPERATOR_ROLE(), deployer);
            distributor.renounceRole(distributor.SIGNER_ADMIN_ROLE(), deployer);
            distributor.renounceRole(distributor.DEFAULT_ADMIN_ROLE(), deployer);
        }

        vm.stopBroadcast();

        console2.log("GameAssetRegistry :", address(registry));
        console2.log("WeaponSkin        :", address(skin));
        console2.log("RewardDistributor :", address(distributor));
        console2.log("SkinMarket        :", address(market));
        console2.log("admin             :", admin);
        console2.log("rewardSigner      :", rewardSigner);
        console2.log("treasury          :", treasury);
    }
}
