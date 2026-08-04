// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {GameAssetRegistry} from "../src/GameAssetRegistry.sol";
import {WeaponSkin} from "../src/WeaponSkin.sol";
import {IWeaponSkin} from "../src/interfaces/IWeaponSkin.sol";
import {IGameAssetRegistry} from "../src/interfaces/IGameAssetRegistry.sol";

/// @notice 对照组：与 WeaponSkin 铸造路径完全相同，只是不继承 ERC721Enumerable。
/// @dev 只用于量化 Enumerable 的成本，不参与部署。
contract PlainSkin is ERC721 {
    IGameAssetRegistry public immutable registry;
    mapping(uint256 => IWeaponSkin.SkinData) private _skinData;

    constructor(address registry_) ERC721("Plain", "PLAIN") {
        registry = IGameAssetRegistry(registry_);
    }

    function mint(address to, uint32 skinDefId, uint16 wear, uint32 seasonId)
        external
        returns (uint256 tokenId)
    {
        uint32 serial = registry.consumeSupply(skinDefId);
        tokenId = (uint256(skinDefId) << 32) | uint256(serial);

        _skinData[tokenId] = IWeaponSkin.SkinData({
            skinDefId: skinDefId,
            serial: serial,
            wear: wear,
            seasonId: seasonId,
            mintedAt: uint64(block.timestamp)
        });

        _safeMint(to, tokenId);
    }
}

/// @notice 量化 ERC721Enumerable 的实际代价 —— 它换掉的是一整个索引服务，
///         所以这个数字值得写进文档而不是拍脑袋估。
contract EnumerableCostTest is Test {
    GameAssetRegistry internal registryA;
    GameAssetRegistry internal registryB;
    WeaponSkin internal enumerableSkin;
    PlainSkin internal plainSkin;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint32 internal constant SKIN_ID = 1042;

    function setUp() public {
        vm.startPrank(admin);

        // Enumerable 版
        registryA = new GameAssetRegistry(admin);
        enumerableSkin =
            new WeaponSkin("Enumerable", "E", "https://x/", address(registryA), admin, treasury, 500);
        registryA.setMinter(address(enumerableSkin));
        registryA.defineSkin(SKIN_ID, 10_000, 4, keccak256("b"));
        enumerableSkin.grantRole(enumerableSkin.MINTER_ROLE(), admin);

        // 对照版
        registryB = new GameAssetRegistry(admin);
        plainSkin = new PlainSkin(address(registryB));
        registryB.setMinter(address(plainSkin));
        registryB.defineSkin(SKIN_ID, 10_000, 4, keccak256("b"));

        vm.stopPrank();
    }

    function test_measureEnumerableOverhead() public {
        // ---- 首次铸造（收件人余额 0 → 1，冷 storage）----
        vm.startPrank(admin);

        uint256 g0 = gasleft();
        uint256 tokenA = enumerableSkin.mint(alice, SKIN_ID, 731, 2);
        uint256 enumerableMint = g0 - gasleft();

        g0 = gasleft();
        uint256 tokenB = plainSkin.mint(alice, SKIN_ID, 731, 2);
        uint256 plainMint = g0 - gasleft();

        vm.stopPrank();

        // ---- 转移 ----
        vm.startPrank(alice);

        g0 = gasleft();
        enumerableSkin.transferFrom(alice, bob, tokenA);
        uint256 enumerableTransfer = g0 - gasleft();

        g0 = gasleft();
        plainSkin.transferFrom(alice, bob, tokenB);
        uint256 plainTransfer = g0 - gasleft();

        vm.stopPrank();

        console2.log("mint      enumerable / plain / delta:", enumerableMint, plainMint);
        console2.log("mint      delta:", enumerableMint - plainMint);
        console2.log("transfer  enumerable / plain:", enumerableTransfer, plainTransfer);
        console2.log("transfer  delta:", enumerableTransfer - plainTransfer);

        // Enumerable 一定更贵；这里只断言方向与量级，避免编译器版本变动导致脆性失败。
        assertGt(enumerableMint, plainMint);
        assertGt(enumerableTransfer, plainTransfer);
        assertLt(enumerableMint - plainMint, 150_000, "mint overhead unexpectedly large");
    }
}
