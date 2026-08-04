// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {GameAssetRegistry} from "../src/GameAssetRegistry.sol";
import {WeaponSkin} from "../src/WeaponSkin.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";

/// @notice 随机调用铸造与销毁，用于压 supply 不变量。
contract SupplyHandler is Test {
    RewardDistributor private immutable distributor;
    WeaponSkin private immutable skin;
    uint32 private immutable skinDefId;

    uint256 private counter;
    address[] public holders;

    constructor(RewardDistributor distributor_, WeaponSkin skin_, uint32 skinDefId_) {
        distributor = distributor_;
        skin = skin_;
        skinDefId = skinDefId_;
    }

    function mint(uint256 seed) external {
        address to = address(uint160(uint256(keccak256(abi.encode("holder", seed % 20))) | 1));
        bytes32 requestId = keccak256(abi.encode(seed, counter));
        unchecked {
            ++counter;
        }

        // 售罄后会 revert，这是预期行为，不该让 invariant run 失败
        try distributor.mintDirect(to, skinDefId, uint16(seed % 10_001), 1, requestId) {
            holders.push(to);
        } catch {}
    }

    function burn(uint256 seed) external {
        if (holders.length == 0) return;
        address holder = holders[seed % holders.length];
        if (skin.balanceOf(holder) == 0) return;

        uint256 tokenId = skin.tokenOfOwnerByIndex(holder, seed % skin.balanceOf(holder));
        vm.prank(holder);
        try skin.burn(tokenId) {} catch {}
    }

    function transfer(uint256 seed) external {
        if (holders.length < 2) return;
        address from = holders[seed % holders.length];
        address to = holders[(seed + 1) % holders.length];
        if (from == to || skin.balanceOf(from) == 0) return;

        uint256 tokenId = skin.tokenOfOwnerByIndex(from, seed % skin.balanceOf(from));
        vm.prank(from);
        try skin.transferFrom(from, to, tokenId) {} catch {}
    }
}

contract SupplyInvariantTest is Test {
    GameAssetRegistry internal registry;
    WeaponSkin internal skin;
    RewardDistributor internal distributor;
    SupplyHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    uint32 internal constant SKIN_ID = 1042;
    uint32 internal constant MAX_SUPPLY = 50;

    function setUp() public {
        vm.startPrank(admin);

        registry = new GameAssetRegistry(admin);
        skin = new WeaponSkin(
            "FPS Weapon Skin",
            "SKIN",
            "https://meta.example/v1/skin/",
            address(registry),
            admin,
            treasury,
            500
        );
        registry.setMinter(address(skin));

        distributor = new RewardDistributor(address(skin), admin, vm.addr(0xA11CE));
        skin.grantRole(skin.MINTER_ROLE(), address(distributor));
        registry.defineSkin(SKIN_ID, MAX_SUPPLY, 4, keccak256("bundle"));

        handler = new SupplyHandler(distributor, skin, SKIN_ID);
        distributor.grantRole(distributor.OPERATOR_ROLE(), address(handler));

        vm.stopPrank();

        targetContract(address(handler));
    }

    /// @notice 最高危风险（无限增发）的最后一道防线，在任意调用序列下都必须成立。
    function invariant_mintedNeverExceedsMaxSupply() public view {
        assertLe(registry.getSkin(SKIN_ID).minted, MAX_SUPPLY);
    }

    /// @notice 流通中的数量不可能超过累计铸造量（销毁只会让它更少）。
    function invariant_circulatingNeverExceedsMinted() public view {
        assertLe(skin.totalSupply(), registry.getSkin(SKIN_ID).minted);
    }

    /// @notice 发行上限从不上调。
    function invariant_maxSupplyIsStable() public view {
        assertEq(registry.getSkin(SKIN_ID).maxSupply, MAX_SUPPLY);
    }

    /// @notice remainingSupply 不会下溢成一个巨大的数。
    function invariant_remainingSupplyIsSane() public view {
        assertLe(registry.remainingSupply(SKIN_ID), MAX_SUPPLY);
    }
}
