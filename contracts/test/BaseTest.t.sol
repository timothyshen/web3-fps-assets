// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {GameAssetRegistry} from "../src/GameAssetRegistry.sol";
import {WeaponSkin} from "../src/WeaponSkin.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {SkinMarket} from "../src/SkinMarket.sol";
import {IRewardDistributor} from "../src/interfaces/IRewardDistributor.sol";

/// @notice 全部测试共享的部署与工具方法。
abstract contract BaseTest is Test {
    GameAssetRegistry internal registry;
    WeaponSkin internal skin;
    RewardDistributor internal distributor;
    SkinMarket internal market;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal player = makeAddr("player");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal signerKey = 0xA11CE;
    address internal signer;

    uint32 internal constant SKIN_AK = 1042;
    uint32 internal constant SKIN_LIMITED = 7; // maxSupply = 2，用于测试售罄
    uint32 internal constant SEASON = 2;
    uint96 internal constant ROYALTY_BPS = 500; // 5%

    function setUp() public virtual {
        signer = vm.addr(signerKey);

        vm.startPrank(admin);

        registry = new GameAssetRegistry(admin);

        skin = new WeaponSkin(
            "FPS Weapon Skin",
            "SKIN",
            "https://meta.example/v1/skin/",
            address(registry),
            admin,
            treasury,
            ROYALTY_BPS
        );

        registry.setMinter(address(skin));

        distributor = new RewardDistributor(address(skin), admin, signer);
        skin.grantRole(skin.MINTER_ROLE(), address(distributor));

        registry.defineSkin(SKIN_AK, 500, 4, keccak256("ak-bundle-v1"));
        registry.defineSkin(SKIN_LIMITED, 2, 4, keccak256("limited-bundle-v1"));

        market = new SkinMarket(address(skin));

        vm.stopPrank();
    }

    // --------------------------------------------------------------------
    // 工具
    // --------------------------------------------------------------------

    function _voucher(address to, uint32 skinDefId, uint256 nonce)
        internal
        view
        returns (IRewardDistributor.Voucher memory)
    {
        return IRewardDistributor.Voucher({
            player: to,
            skinDefId: skinDefId,
            wear: 731,
            seasonId: SEASON,
            nonce: nonce,
            deadline: uint64(block.timestamp + 7 days)
        });
    }

    function _sign(IRewardDistributor.Voucher memory voucher, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = distributor.voucherHash(voucher);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice 直接给某地址铸一件皮肤，返回 tokenId。
    function _mintTo(address to, uint32 skinDefId, bytes32 requestId) internal returns (uint256) {
        vm.prank(admin);
        return distributor.mintDirect(to, skinDefId, 731, SEASON, requestId);
    }
}
