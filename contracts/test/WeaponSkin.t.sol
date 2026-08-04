// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {IWeaponSkin} from "../src/interfaces/IWeaponSkin.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract WeaponSkinTest is BaseTest {
    function test_mint_setsImmutableSkinData() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        IWeaponSkin.SkinData memory data = skin.skinData(tokenId);
        assertEq(data.skinDefId, SKIN_AK);
        assertEq(data.serial, 1);
        assertEq(data.wear, 731);
        assertEq(data.seasonId, SEASON);
        assertEq(data.mintedAt, uint64(block.timestamp));
        assertEq(skin.ownerOf(tokenId), player);
    }

    function test_tokenId_encodesDefAndSerial() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        (uint32 defId, uint32 serial) = skin.decodeTokenId(tokenId);
        assertEq(defId, SKIN_AK);
        assertEq(serial, 1);
        assertEq(tokenId, (uint256(SKIN_AK) << 32) | 1);
    }

    function testFuzz_tokenIdRoundTrip(uint32 defId, uint32 serial) public view {
        uint256 tokenId = skin.encodeTokenId(defId, serial);
        (uint32 outDef, uint32 outSerial) = skin.decodeTokenId(tokenId);
        assertEq(outDef, defId);
        assertEq(outSerial, serial);
    }

    function test_mint_rejectsWearAboveMax() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IWeaponSkin.WearOutOfRange.selector, uint16(10_001)));
        distributor.mintDirect(player, SKIN_AK, 10_001, SEASON, keccak256("bad"));
    }

    function test_mint_acceptsWearAtBoundary() public {
        vm.prank(admin);
        uint256 tokenId = distributor.mintDirect(player, SKIN_AK, 10_000, SEASON, keccak256("edge"));
        assertEq(skin.skinData(tokenId).wear, 10_000);
    }

    // ---- 铸造权限 ----

    function test_mint_onlyMinterRole() public {
        // 注意：role getter 必须在 vm.prank / vm.expectRevert 之前求值，
        // 否则这次外部调用会把 cheatcode 消耗掉。
        bytes32 minterRole = skin.MINTER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, minterRole
            )
        );
        skin.mint(stranger, SKIN_AK, 0, SEASON);
    }

    /// @dev admin 持有 DEFAULT_ADMIN_ROLE 但没有 MINTER_ROLE，不能直接铸造。
    ///      铸造必须经过 RewardDistributor，那里有 nonce / requestId 的幂等保护。
    function test_mint_adminIsNotAutomaticallyMinter() public {
        bytes32 minterRole = skin.MINTER_ROLE();

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, minterRole
            )
        );
        skin.mint(admin, SKIN_AK, 0, SEASON);
    }

    // ---- 所有权承诺：不存在管理员后门 ----

    /// @dev 用低阶 call 探测常见的后门方法名，全部应当不存在（call 失败）。
    ///      如果哪天有人加了这些方法，这个测试会变红。
    function test_noAdminBackdoors() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        string[4] memory backdoors = [
            "adminTransfer(uint256,address)",
            "adminBurn(uint256)",
            "setTransferEnabled(bool)",
            "forceTransferFrom(address,address,uint256)"
        ];

        for (uint256 i = 0; i < backdoors.length; ++i) {
            bytes4 selector = bytes4(keccak256(bytes(backdoors[i])));
            vm.prank(admin);
            (bool ok,) = address(skin).call(abi.encodeWithSelector(selector, tokenId, admin));
            assertFalse(ok, backdoors[i]);
        }

        assertEq(skin.ownerOf(tokenId), player, "player must still own the token");
    }

    function test_burn_onlyOwner() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IWeaponSkin.NotTokenOwner.selector, tokenId, admin));
        skin.burn(tokenId);

        vm.prank(player);
        skin.burn(tokenId);
        assertEq(skin.balanceOf(player), 0);
    }

    /// @dev 被授权的操作者也不能销毁 —— 销毁是所有权行为，approve 不应传递销毁权。
    function test_burn_approvedOperatorCannotBurn() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        vm.prank(player);
        skin.setApprovalForAll(stranger, true);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IWeaponSkin.NotTokenOwner.selector, tokenId, stranger));
        skin.burn(tokenId);
    }

    function test_skinData_revertsForBurnedToken() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));
        vm.prank(player);
        skin.burn(tokenId);

        vm.expectRevert(abi.encodeWithSelector(IWeaponSkin.TokenDoesNotExist.selector, tokenId));
        skin.skinData(tokenId);
    }

    // ---- 库存读取（替代索引服务） ----

    function test_tokensOfOwner_listsInventory() public {
        uint256 t1 = _mintTo(player, SKIN_AK, keccak256("a"));
        uint256 t2 = _mintTo(player, SKIN_AK, keccak256("b"));
        _mintTo(stranger, SKIN_AK, keccak256("c"));

        uint256[] memory owned = skin.tokensOfOwner(player);
        assertEq(owned.length, 2);
        assertEq(owned[0], t1);
        assertEq(owned[1], t2);

        assertEq(skin.tokensOfOwner(buyer).length, 0);
    }

    function test_tokensOfOwner_updatesAfterTransfer() public {
        uint256 t1 = _mintTo(player, SKIN_AK, keccak256("a"));

        vm.prank(player);
        skin.transferFrom(player, buyer, t1);

        assertEq(skin.tokensOfOwner(player).length, 0);
        assertEq(skin.tokensOfOwner(buyer)[0], t1);
    }

    // ---- 元数据与版税 ----

    function test_tokenURI_concatenatesBase() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));
        assertEq(skin.tokenURI(tokenId), string.concat("https://meta.example/v1/skin/", vm.toString(tokenId)));
    }

    function test_tokenURI_revertsForNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(IWeaponSkin.TokenDoesNotExist.selector, uint256(123)));
        skin.tokenURI(123);
    }

    function test_royaltyInfo() public {
        uint256 tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));
        (address receiver, uint256 amount) = skin.royaltyInfo(tokenId, 1 ether);
        assertEq(receiver, treasury);
        assertEq(amount, 0.05 ether); // 5%
    }

    function test_supportsExpectedInterfaces() public view {
        assertTrue(skin.supportsInterface(type(IERC721).interfaceId));
        assertTrue(skin.supportsInterface(type(IERC721Enumerable).interfaceId));
        assertTrue(skin.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(skin.supportsInterface(type(IAccessControl).interfaceId));
    }
}
