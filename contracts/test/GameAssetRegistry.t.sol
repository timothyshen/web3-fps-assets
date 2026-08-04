// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {IGameAssetRegistry} from "../src/interfaces/IGameAssetRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GameAssetRegistryTest is BaseTest {
    function test_defineSkin_storesDefinition() public view {
        IGameAssetRegistry.SkinDefinition memory def = registry.getSkin(SKIN_AK);

        assertEq(def.maxSupply, 500);
        assertEq(def.minted, 0);
        assertEq(def.rarity, 4);
        assertFalse(def.frozen);
        assertEq(def.contentHash, keccak256("ak-bundle-v1"));
    }

    function test_defineSkin_revertsOnDuplicate() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.SkinAlreadyDefined.selector, SKIN_AK));
        registry.defineSkin(SKIN_AK, 100, 1, bytes32(0));
    }

    function test_defineSkin_revertsOnZeroSupply() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.InvalidMaxSupply.selector, uint32(0)));
        registry.defineSkin(999, 0, 1, bytes32(0));
    }

    function test_defineSkin_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.defineSkin(999, 100, 1, bytes32(0));
    }

    // ---- 发行上限：只能降不能升 ----

    function test_reduceMaxSupply_lowersCap() public {
        vm.prank(admin);
        registry.reduceMaxSupply(SKIN_AK, 100);
        assertEq(registry.getSkin(SKIN_AK).maxSupply, 100);
    }

    function test_reduceMaxSupply_cannotRaise() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.InvalidMaxSupply.selector, uint32(1000)));
        registry.reduceMaxSupply(SKIN_AK, 1000);
    }

    function test_reduceMaxSupply_cannotEqualCurrent() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.InvalidMaxSupply.selector, uint32(500)));
        registry.reduceMaxSupply(SKIN_AK, 500);
    }

    function test_reduceMaxSupply_cannotGoBelowMinted() public {
        _mintTo(player, SKIN_AK, keccak256("r1"));
        _mintTo(player, SKIN_AK, keccak256("r2"));
        _mintTo(player, SKIN_AK, keccak256("r3"));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.InvalidMaxSupply.selector, uint32(2)));
        registry.reduceMaxSupply(SKIN_AK, 2);
    }

    /// @dev 回归测试：`maxSupply == 0` 曾被同时用作"未定义"的哨兵值，
    ///      导致 reduceMaxSupply(id, 0) 会静默抹掉一个已存在的款式定义。
    ///      现在 exists 是独立字段，降到 0 只意味着"停止发行"。
    function test_reduceMaxSupplyToZero_retainsDefinition() public {
        vm.prank(admin);
        registry.reduceMaxSupply(SKIN_AK, 0);

        assertTrue(registry.isDefined(SKIN_AK), "definition must survive");

        IGameAssetRegistry.SkinDefinition memory def = registry.getSkin(SKIN_AK);
        assertEq(def.maxSupply, 0);
        assertEq(def.rarity, 4, "rarity must be preserved");
        assertEq(def.contentHash, keccak256("ak-bundle-v1"), "contentHash must be preserved");
        assertEq(registry.remainingSupply(SKIN_AK), 0);

        // 停止发行后不能再铸造，但错误是 SupplyExhausted 而不是 SkinNotDefined
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IGameAssetRegistry.SupplyExhausted.selector, SKIN_AK, uint32(0))
        );
        distributor.mintDirect(player, SKIN_AK, 0, SEASON, keccak256("after-retire"));
    }

    /// @dev 停止发行后不能再重新定义同一个 skinDefId 来绕过上限。
    function test_retiredSkinCannotBeRedefined() public {
        vm.startPrank(admin);
        registry.reduceMaxSupply(SKIN_AK, 0);

        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.SkinAlreadyDefined.selector, SKIN_AK));
        registry.defineSkin(SKIN_AK, 999999, 4, keccak256("sneaky-reissue"));
        vm.stopPrank();
    }

    /// @dev 这是对玩家最实质的稀缺性承诺 —— fuzz 一遍确保没有任何路径能上调。
    function testFuzz_maxSupplyNeverIncreases(uint32 attempted) public {
        uint32 current = registry.getSkin(SKIN_AK).maxSupply;

        vm.prank(admin);
        try registry.reduceMaxSupply(SKIN_AK, attempted) {
            assertLt(registry.getSkin(SKIN_AK).maxSupply, current, "cap must strictly decrease");
        } catch {
            assertEq(registry.getSkin(SKIN_AK).maxSupply, current, "failed call must not change cap");
        }
    }

    // ---- 外观哈希与冻结 ----

    function test_updateContentHash_emitsAuditTrail() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true, address(registry));
        emit IGameAssetRegistry.ContentHashUpdated(
            SKIN_AK, keccak256("ak-bundle-v1"), keccak256("ak-bundle-v2")
        );
        registry.updateContentHash(SKIN_AK, keccak256("ak-bundle-v2"));

        assertEq(registry.getSkin(SKIN_AK).contentHash, keccak256("ak-bundle-v2"));
    }

    function test_freeze_locksContentHashForever() public {
        vm.startPrank(admin);
        registry.freeze(SKIN_AK);

        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.SkinIsFrozen.selector, SKIN_AK));
        registry.updateContentHash(SKIN_AK, keccak256("sneaky-nerf"));
        vm.stopPrank();

        assertTrue(registry.getSkin(SKIN_AK).frozen);
    }

    function test_freeze_isNotReversible() public {
        vm.startPrank(admin);
        registry.freeze(SKIN_AK);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.SkinIsFrozen.selector, SKIN_AK));
        registry.freeze(SKIN_AK);
        vm.stopPrank();
    }

    // ---- consumeSupply 权限 ----

    function test_consumeSupply_onlyMinterContract() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.NotAuthorizedMinter.selector, stranger));
        registry.consumeSupply(SKIN_AK);
    }

    /// @dev admin 也不行 —— 只有被指定的 WeaponSkin 合约可以消耗额度。
    function test_consumeSupply_ownerCannotBypass() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.NotAuthorizedMinter.selector, admin));
        registry.consumeSupply(SKIN_AK);
    }

    function test_consumeSupply_serialsAreSequential() public {
        uint256 t1 = _mintTo(player, SKIN_AK, keccak256("a"));
        uint256 t2 = _mintTo(player, SKIN_AK, keccak256("b"));

        assertEq(skin.skinData(t1).serial, 1);
        assertEq(skin.skinData(t2).serial, 2);
    }

    function test_supplyExhausted_blocksFurtherMints() public {
        _mintTo(player, SKIN_LIMITED, keccak256("l1"));
        _mintTo(player, SKIN_LIMITED, keccak256("l2"));

        assertEq(registry.remainingSupply(SKIN_LIMITED), 0);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IGameAssetRegistry.SupplyExhausted.selector, SKIN_LIMITED, uint32(2))
        );
        distributor.mintDirect(player, SKIN_LIMITED, 0, SEASON, keccak256("l3"));
    }

    /// @dev 销毁不回退 minted，序号永不复用。
    function test_burnDoesNotFreeSupply() public {
        uint256 t1 = _mintTo(player, SKIN_LIMITED, keccak256("l1"));
        _mintTo(player, SKIN_LIMITED, keccak256("l2"));

        vm.prank(player);
        skin.burn(t1);

        assertEq(registry.remainingSupply(SKIN_LIMITED), 0);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IGameAssetRegistry.SupplyExhausted.selector, SKIN_LIMITED, uint32(2))
        );
        distributor.mintDirect(player, SKIN_LIMITED, 0, SEASON, keccak256("l3"));
    }

    function test_undefinedSkin_reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IGameAssetRegistry.SkinNotDefined.selector, uint32(4242)));
        distributor.mintDirect(player, 4242, 0, SEASON, keccak256("x"));
    }
}
