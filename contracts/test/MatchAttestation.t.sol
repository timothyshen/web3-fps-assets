// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {MatchAttestation} from "../src/MatchAttestation.sol";
import {IMatchAttestation} from "../src/interfaces/IMatchAttestation.sol";

contract MatchAttestationTest is Test {
    MatchAttestation internal attestation;

    address internal admin = makeAddr("admin");
    address internal gameServer = makeAddr("gameServer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant MATCH_1 = keccak256("m_01HX");
    bytes32 internal constant RESULT_1 = keccak256("{matchId:m_01HX,winner:alice}");

    function setUp() public {
        attestation = new MatchAttestation(admin);

        // role getter 必须在 vm.prank 之前求值，否则这次外部调用会把 prank 消耗掉
        bytes32 attesterRole = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(attesterRole, gameServer);
    }

    function test_attest_storesResult() public {
        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        assertEq(attestation.resultOf(MATCH_1), RESULT_1);
        assertTrue(attestation.isAttested(MATCH_1));
        assertTrue(attestation.verify(MATCH_1, RESULT_1));
        assertEq(attestation.attestationCount(), 1);
    }

    function test_attest_emitsFullDetailInEvent() public {
        vm.expectEmit(true, true, false, true, address(attestation));
        emit IMatchAttestation.MatchAttested(MATCH_1, RESULT_1, gameServer, uint64(block.timestamp));

        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);
    }

    // --------------------------------------------------------------------
    // 不可篡改 —— 这是整个合约存在的理由
    // --------------------------------------------------------------------

    function test_attest_cannotOverwrite() public {
        vm.startPrank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        bytes32 forged = keccak256("{matchId:m_01HX,winner:bob}");
        vm.expectRevert(abi.encodeWithSelector(IMatchAttestation.AlreadyAttested.selector, MATCH_1, RESULT_1));
        attestation.attest(MATCH_1, forged);
        vm.stopPrank();

        assertEq(attestation.resultOf(MATCH_1), RESULT_1, "original must survive");
    }

    /// @dev 连 admin 也不能覆盖。没有任何"修正"通道 —— 有的话就不叫存证了。
    function test_attest_adminCannotOverwriteEither() public {
        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IMatchAttestation.AlreadyAttested.selector, MATCH_1, RESULT_1));
        attestation.attest(MATCH_1, keccak256("admin-rewrite"));
    }

    function test_noDeleteOrUpdateBackdoors() public {
        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        string[3] memory backdoors =
            ["revoke(bytes32)", "updateResult(bytes32,bytes32)", "deleteAttestation(bytes32)"];

        for (uint256 i = 0; i < backdoors.length; ++i) {
            vm.prank(admin);
            (bool ok,) = address(attestation)
                .call(abi.encodeWithSelector(bytes4(keccak256(bytes(backdoors[i]))), MATCH_1, RESULT_1));
            assertFalse(ok, backdoors[i]);
        }

        assertEq(attestation.resultOf(MATCH_1), RESULT_1);
    }

    // --------------------------------------------------------------------
    // 权限与入参
    // --------------------------------------------------------------------

    function test_attest_onlyAttester() public {
        bytes32 role = attestation.ATTESTER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role)
        );
        attestation.attest(MATCH_1, RESULT_1);
    }

    function test_attest_rejectsZeroValues() public {
        vm.startPrank(gameServer);

        vm.expectRevert(IMatchAttestation.ZeroMatchId.selector);
        attestation.attest(bytes32(0), RESULT_1);

        vm.expectRevert(IMatchAttestation.ZeroResultHash.selector);
        attestation.attest(MATCH_1, bytes32(0));

        vm.stopPrank();
    }

    /// @dev verify 对未存证的比赛必须返回 false，而不是因为两边都是 0 而误判为真。
    function test_verify_falseForUnattested() public view {
        assertFalse(attestation.verify(MATCH_1, bytes32(0)));
        assertFalse(attestation.verify(MATCH_1, RESULT_1));
    }

    function test_verify_falseForWrongHash() public {
        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        assertFalse(attestation.verify(MATCH_1, keccak256("tampered")));
    }

    // --------------------------------------------------------------------
    // 批量
    // --------------------------------------------------------------------

    function test_attestBatch_writesAll() public {
        (bytes32[] memory ids, bytes32[] memory hashes) = _makeBatch(10, 0);

        vm.prank(gameServer);
        attestation.attestBatch(ids, hashes);

        for (uint256 i = 0; i < ids.length; ++i) {
            assertTrue(attestation.verify(ids[i], hashes[i]));
        }
        assertEq(attestation.attestationCount(), 10);
    }

    /// @dev 批内有重复时整批回滚，而不是静默跳过 ——
    ///      静默跳过会让调用方以为全写成功了。
    function test_attestBatch_revertsWholeBatchOnDuplicate() public {
        vm.prank(gameServer);
        attestation.attest(MATCH_1, RESULT_1);

        bytes32[] memory ids = new bytes32[](2);
        bytes32[] memory hashes = new bytes32[](2);
        ids[0] = keccak256("fresh");
        hashes[0] = keccak256("fresh-result");
        ids[1] = MATCH_1; // 已存证
        hashes[1] = RESULT_1;

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(IMatchAttestation.AlreadyAttested.selector, MATCH_1, RESULT_1));
        attestation.attestBatch(ids, hashes);

        assertFalse(attestation.isAttested(keccak256("fresh")), "whole batch must roll back");
    }

    function test_attestBatch_rejectsLengthMismatch() public {
        bytes32[] memory ids = new bytes32[](2);
        bytes32[] memory hashes = new bytes32[](1);
        ids[0] = keccak256("a");
        ids[1] = keccak256("b");
        hashes[0] = keccak256("h");

        vm.prank(gameServer);
        vm.expectRevert(
            abi.encodeWithSelector(IMatchAttestation.LengthMismatch.selector, uint256(2), uint256(1))
        );
        attestation.attestBatch(ids, hashes);
    }

    function test_attestBatch_rejectsEmpty() public {
        vm.prank(gameServer);
        vm.expectRevert(IMatchAttestation.EmptyBatch.selector);
        attestation.attestBatch(new bytes32[](0), new bytes32[](0));
    }

    // --------------------------------------------------------------------
    // 成本
    // --------------------------------------------------------------------

    /// @dev 量化单场存证成本与批量摊薄效果。这个数字决定了"每局都上链"
    ///      到底可不可行，值得实测而不是估。
    function test_measureAttestationCost() public {
        (bytes32[] memory single, bytes32[] memory singleHash) = _makeBatch(1, 1000);

        vm.startPrank(gameServer);

        uint256 g0 = gasleft();
        attestation.attest(single[0], singleHash[0]);
        uint256 singleCost = g0 - gasleft();

        (bytes32[] memory ids100, bytes32[] memory hashes100) = _makeBatch(100, 2000);
        g0 = gasleft();
        attestation.attestBatch(ids100, hashes100);
        uint256 batchCost = g0 - gasleft();

        vm.stopPrank();

        console2.log("single attest gas          :", singleCost);
        console2.log("batch of 100 total gas     :", batchCost);
        console2.log("batch per-match gas        :", batchCost / 100);

        // 批量摊薄后单场成本必须显著低于单笔
        assertLt(batchCost / 100, singleCost, "batching must amortize");
    }

    function _makeBatch(uint256 count, uint256 seed)
        internal
        pure
        returns (bytes32[] memory ids, bytes32[] memory hashes)
    {
        ids = new bytes32[](count);
        hashes = new bytes32[](count);
        for (uint256 i = 0; i < count; ++i) {
            ids[i] = keccak256(abi.encode("match", seed + i));
            hashes[i] = keccak256(abi.encode("result", seed + i));
        }
    }
}
