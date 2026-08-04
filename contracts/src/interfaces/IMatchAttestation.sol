// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMatchAttestation
/// @notice 对局结果存证。玩家的战绩可被任何人独立核验没有被事后篡改。
///
/// @dev **核验流程（链下 + 链上各承担一半）**
///
///      1. 对局结束，游戏服务器把完整结果序列化成一个 JSON blob：
///         `{matchId, players[], scores[], placements[], endedAt, ...}`
///      2. 计算 `resultHash = keccak256(blob)`，调 `attest(matchId, resultHash)`
///      3. blob 本身通过普通 API 提供（`GET /v1/matches/{matchId}`）
///      4. 任何人拿到 blob 后自己算哈希，和链上 `resultOf(matchId)` 比对
///
///      这样链上只花 1 个 slot，却覆盖了完整结果 —— 因为哈希覆盖了 blob 的
///      每一个字节。改任何一个数字，哈希就对不上。
///
///      **它保证什么**：结果一旦公布就不能被悄悄修改。
///      **它不保证什么**：结果一开始就是真的。游戏服务器仍然可以在提交前
///      造假。这是可验证性，不是可信性 —— 两者不能混为一谈。
interface IMatchAttestation {
    /// @param matchId    对局唯一标识，建议 keccak256(matchId 字符串)
    /// @param resultHash 完整结果 blob 的 keccak256
    /// @param attester   提交者（游戏服务器地址）
    /// @param timestamp  上链时间，不是对局结束时间
    event MatchAttested(
        bytes32 indexed matchId, bytes32 resultHash, address indexed attester, uint64 timestamp
    );

    error AlreadyAttested(bytes32 matchId, bytes32 existingHash);
    error ZeroMatchId();
    error ZeroResultHash();
    error LengthMismatch(uint256 matchIdsLength, uint256 resultHashesLength);
    error EmptyBatch();
    error ZeroAddress();

    /// @notice 为一场比赛存证。同一个 matchId 不可二次存证。
    function attest(bytes32 matchId, bytes32 resultHash) external;

    /// @notice 批量存证。结算服务按批写入，摊薄单场成本。
    /// @dev 批内任意一场已存证会导致整批回滚 —— 调用方应先过滤已存证的场次。
    ///      这是刻意的：静默跳过会让调用方以为写成功了。
    function attestBatch(bytes32[] calldata matchIds, bytes32[] calldata resultHashes) external;

    /// @notice 返回已存证的哈希；未存证返回 bytes32(0)。
    function resultOf(bytes32 matchId) external view returns (bytes32);

    function isAttested(bytes32 matchId) external view returns (bool);

    /// @notice 核验某个哈希是否与链上存证一致。
    function verify(bytes32 matchId, bytes32 resultHash) external view returns (bool);
}
