// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {IRewardDistributor} from "../src/interfaces/IRewardDistributor.sol";
import {IGameAssetRegistry} from "../src/interfaces/IGameAssetRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract RewardDistributorTest is BaseTest {
    // --------------------------------------------------------------------
    // pull —— voucher 领取
    // --------------------------------------------------------------------

    function test_claim_mintsToVoucherPlayer() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.prank(player);
        uint256 tokenId = distributor.claim(v, sig);

        assertEq(skin.ownerOf(tokenId), player);
        assertEq(skin.skinData(tokenId).skinDefId, SKIN_AK);
        assertTrue(distributor.isNonceUsed(player, 0));
    }

    /// @dev 允许第三方代提交是为了支持 relayer / Paymaster 代付 gas。
    ///      NFT 必须始终铸给 voucher.player，而不是 msg.sender。
    function test_claim_relayerCannotStealReward() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.prank(stranger);
        uint256 tokenId = distributor.claim(v, sig);

        assertEq(skin.ownerOf(tokenId), player, "reward must go to the voucher player");
        assertEq(skin.balanceOf(stranger), 0);
    }

    // ---- 重放防护 ----

    function test_claim_revertsOnReplay() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.prank(player);
        distributor.claim(v, sig);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(IRewardDistributor.NonceAlreadyUsed.selector, player, uint256(0))
        );
        distributor.claim(v, sig);
    }

    function test_claim_revertsAfterDeadline() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.warp(v.deadline + 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRewardDistributor.VoucherExpired.selector, v.deadline, uint256(v.deadline + 1)
            )
        );
        distributor.claim(v, sig);
    }

    function test_claim_revertsOnWrongSigner() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, 0xBADBAD);

        vm.prank(player);
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(v, sig);
    }

    /// @dev 篡改任一字段都必须让签名失效。
    function test_claim_revertsOnTamperedFields() public {
        IRewardDistributor.Voucher memory original = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(original, signerKey);

        IRewardDistributor.Voucher memory tampered = original;
        tampered.player = stranger;
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(tampered, sig);

        tampered = original;
        tampered.wear = 0; // 想把磨损改成全新
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(tampered, sig);

        tampered = original;
        tampered.skinDefId = SKIN_LIMITED; // 想换成更稀有的款式
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(tampered, sig);

        tampered = original;
        tampered.nonce = 1;
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(tampered, sig);

        tampered = original;
        tampered.deadline = original.deadline + 1;
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(tampered, sig);
    }

    /// @dev EIP-712 domain 含 chainId：Monad 测试网签发的 voucher 不能在主网重放。
    ///      这是真实风险 —— 测试网的签名密钥往往管得松，泄露后如果能在主网用就是事故。
    function test_claim_revertsOnCrossChainReplay() public {
        vm.chainId(10_143); // Monad 测试网

        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        // 同一条链上签名有效
        assertEq(distributor.voucherHash(v), distributor.voucherHash(v));

        vm.chainId(143); // Monad 主网

        vm.prank(player);
        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(v, sig);
    }

    /// @dev 反向确认：不跨链时同一个 voucher 是能正常用的，
    ///      否则上面那个测试可能因为别的原因通过。
    function test_claim_succeedsOnSameChain() public {
        vm.chainId(10_143);

        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.prank(player);
        uint256 tokenId = distributor.claim(v, sig);
        assertEq(skin.ownerOf(tokenId), player);
    }

    function testFuzz_noncesAreIndependent(uint8 a, uint8 b) public {
        vm.assume(a != b);

        IRewardDistributor.Voucher memory v1 = _voucher(player, SKIN_AK, a);
        IRewardDistributor.Voucher memory v2 = _voucher(player, SKIN_AK, b);

        distributor.claim(v1, _sign(v1, signerKey));
        distributor.claim(v2, _sign(v2, signerKey));

        assertEq(skin.balanceOf(player), 2);
    }

    /// @dev bitmap 的高位不能被截断 —— 这是 `1 << bitPos` 类型推导坑的回归测试。
    function testFuzz_highNoncesWork(uint256 nonce) public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, nonce);
        // _sign 内部有外部调用（voucherHash），必须在 expectRevert 之前先算好。
        bytes memory sig = _sign(v, signerKey);

        distributor.claim(v, sig);
        assertTrue(distributor.isNonceUsed(player, nonce));

        vm.expectRevert(abi.encodeWithSelector(IRewardDistributor.NonceAlreadyUsed.selector, player, nonce));
        distributor.claim(v, sig);
    }

    // ---- signer 轮换 ----

    function test_setSigner_invalidatesOldVouchers() public {
        IRewardDistributor.Voucher memory v = _voucher(player, SKIN_AK, 0);
        bytes memory sig = _sign(v, signerKey);

        vm.prank(admin);
        distributor.setSigner(makeAddr("newSigner"));

        vm.expectRevert(IRewardDistributor.InvalidSignature.selector);
        distributor.claim(v, sig);
    }

    function test_setSigner_onlySignerAdmin() public {
        bytes32 role = distributor.SIGNER_ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        distributor.setSigner(stranger);
    }

    // --------------------------------------------------------------------
    // push —— 后端直接铸造
    // --------------------------------------------------------------------

    function test_mintDirect_isIdempotent() public {
        bytes32 requestId = keccak256(abi.encode("match_1", "player_1", uint8(0)));

        vm.prank(admin);
        uint256 tokenId = distributor.mintDirect(player, SKIN_AK, 731, SEASON, requestId);

        // 游戏服务器重试推送同一结果
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IRewardDistributor.RequestAlreadyProcessed.selector, requestId)
        );
        distributor.mintDirect(player, SKIN_AK, 731, SEASON, requestId);

        assertEq(skin.balanceOf(player), 1, "retry must not double-mint");
        assertTrue(distributor.isRequestProcessed(requestId));
        assertEq(skin.ownerOf(tokenId), player);
    }

    function test_mintDirect_rejectsZeroRequestId() public {
        vm.prank(admin);
        vm.expectRevert(IRewardDistributor.ZeroRequestId.selector);
        distributor.mintDirect(player, SKIN_AK, 0, SEASON, bytes32(0));
    }

    function test_mintDirect_onlyOperator() public {
        bytes32 role = distributor.OPERATOR_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        distributor.mintDirect(stranger, SKIN_AK, 0, SEASON, keccak256("x"));
    }

    // --------------------------------------------------------------------
    // 纵深防御：签名密钥泄露也无法无限增发
    // --------------------------------------------------------------------

    /// @dev 模拟最坏情况 —— 攻击者拿到了签名私钥，可以任意签发 voucher。
    ///      registry 的 maxSupply 仍然是硬天花板。
    function test_compromisedSignerCannotExceedMaxSupply() public {
        uint32 cap = registry.getSkin(SKIN_LIMITED).maxSupply;

        for (uint256 i = 0; i < cap; ++i) {
            IRewardDistributor.Voucher memory v = _voucher(stranger, SKIN_LIMITED, i);
            distributor.claim(v, _sign(v, signerKey));
        }

        IRewardDistributor.Voucher memory overflow = _voucher(stranger, SKIN_LIMITED, cap);
        bytes memory overflowSig = _sign(overflow, signerKey);

        vm.expectRevert(
            abi.encodeWithSelector(IGameAssetRegistry.SupplyExhausted.selector, SKIN_LIMITED, cap)
        );
        distributor.claim(overflow, overflowSig);

        assertEq(skin.balanceOf(stranger), cap);
        assertEq(registry.getSkin(SKIN_LIMITED).minted, cap);
    }
}
