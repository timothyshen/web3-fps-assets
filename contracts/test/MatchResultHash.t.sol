// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

import {MatchAttestation} from "../src/MatchAttestation.sol";

/// @notice 结果包哈希的跨语言参考向量。
///
/// @dev 这个测试的价值不在于验证 Solidity —— keccak256 当然是对的。它的价值是
///      **把参考向量钉死在仓库里**，让 C#（Unity）、TypeScript（后端）和链上三方
///      能对着同一组输入输出校准实现。
///
///      结果包的哈希规则（PRD MAT-003）：
///        1. UTF-8 编码
///        2. 按 RFC 8785 JSON Canonicalization Scheme 规范化
///        3. 对规范化后的字节算 keccak256
///
///      第 2 步不能省。JSON 序列化在键序、Unicode 转义、数字格式上各语言实现
///      各不相同，不规范化的话 C# 和 TS 算出的哈希几乎必然对不上，而且这种
///      不一致要到联调那天才会暴露。
///
///      新增语言实现时，让它对 fixtures/match-result-v1.canonical.json 算哈希，
///      结果必须等于 EXPECTED_RESULT_HASH。
contract MatchResultHashTest is Test {
    /// @dev fixtures/match-result-v1.canonical.json 的 keccak256
    bytes32 internal constant EXPECTED_RESULT_HASH =
        0x9fe99ccb29be1c87314e8df93d1fe5d2e17a094d39282df072be17fae75de45d;

    /// @dev keccak256("m_01HXQZ8K3N4P5R6S7T8V9W")，即该场比赛的链上键
    bytes32 internal constant EXPECTED_MATCH_ID_KEY =
        0x55d927078616dac9ef7817f2a797c9f13abb6b56e3a40b10f91f415bbba4cc05;

    string internal constant MATCH_ID = "m_01HXQZ8K3N4P5R6S7T8V9W";
    string internal constant FIXTURE_PATH = "../fixtures/match-result-v1.canonical.json";

    function test_canonicalFixtureMatchesReferenceHash() public view {
        string memory canonical = vm.readFile(FIXTURE_PATH);
        bytes32 actual = keccak256(bytes(canonical));

        console2.log("canonical byte length:", bytes(canonical).length);
        console2.logBytes32(actual);

        assertEq(
            actual,
            EXPECTED_RESULT_HASH,
            "fixture hash drifted -- every language implementation must be re-checked"
        );
    }

    /// @dev 夹具**不能有尾随换行**。多一个 \n 哈希就全变了，
    ///      而这是编辑器最容易悄悄加上的东西。
    function test_fixtureHasNoTrailingNewline() public view {
        bytes memory canonical = bytes(vm.readFile(FIXTURE_PATH));

        assertGt(canonical.length, 0);
        assertEq(canonical[canonical.length - 1], bytes1("}"), "fixture must end with '}'");
    }

    function test_matchIdKeyDerivation() public pure {
        assertEq(keccak256(bytes(MATCH_ID)), EXPECTED_MATCH_ID_KEY);
    }

    /// @dev 端到端：用参考向量真的存一次证再验一次。
    function test_attestAndVerifyWithReferenceVector() public {
        MatchAttestation attestation = new MatchAttestation(address(this));

        bytes32 matchIdKey = keccak256(bytes(MATCH_ID));
        bytes32 resultHash = keccak256(bytes(vm.readFile(FIXTURE_PATH)));

        attestation.attest(matchIdKey, resultHash);

        assertTrue(attestation.verify(matchIdKey, resultHash));
        assertEq(attestation.resultOf(matchIdKey), EXPECTED_RESULT_HASH);
    }

    /// @dev 改动结果包的任何一个字节，哈希都必须变 —— 这是存证有意义的前提。
    function test_anyByteChangeBreaksTheHash() public view {
        bytes memory canonical = bytes(vm.readFile(FIXTURE_PATH));

        // 把某个 kills 数字改掉（18 -> 19）
        string memory tampered = vm.replace(string(canonical), "\"kills\":18", "\"kills\":19");
        assertTrue(keccak256(bytes(tampered)) != EXPECTED_RESULT_HASH, "tampered score must not match");

        // 只调整键序（非 JCS 序）也必须产生不同哈希，
        // 这正是为什么必须规范化后再哈希
        string memory reordered = vm.replace(
            string(canonical),
            "{\"antiCheatState\":\"passed\",\"endedAt\":1754381700",
            "{\"endedAt\":1754381700,\"antiCheatState\":\"passed\""
        );
        assertTrue(keccak256(bytes(reordered)) != EXPECTED_RESULT_HASH, "key order must matter");
    }
}
