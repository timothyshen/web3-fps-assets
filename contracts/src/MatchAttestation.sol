// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IMatchAttestation} from "./interfaces/IMatchAttestation.sol";

/// @title MatchAttestation
/// @notice 对局结果的抗篡改存证。**不是把对局过程上链** —— 只把结果的哈希上链，
///         让战绩事后不可被悄悄修改，且任何人可独立核验。
///
/// @dev 存储设计刻意做到极简：每场比赛只写 **1 个 slot**（resultHash）。
///      时间戳和提交者放在事件里 —— 事件比 storage 便宜一个数量级，而核验
///      本来就发生在链下，读事件完全够用。
///
///      唯一需要写进 storage 的是 resultHash 本身，因为它承担一个链上才能
///      提供的保证：**同一个 matchId 不能被二次存证**。没有这条，提交方就能
///      在事后为同一场比赛发布另一个结果，整个存证也就失去意义了。
///
///      为什么这个功能适合 Monad：每局都写在通用链上是要精打细算的（要不要写、
///      多久批一次、写多细），在 Monad 上这个取舍基本消失。`attestBatch`
///      让结算服务可以按批写入，进一步摊薄单场成本。
contract MatchAttestation is IMatchAttestation, AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    /// @dev matchId => resultHash。bytes32(0) 表示尚未存证。
    mapping(bytes32 matchId => bytes32 resultHash) private _results;

    /// @notice 累计存证场次，用于展示和监控。
    uint256 public attestationCount;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
    }

    // --------------------------------------------------------------------
    // 写入
    // --------------------------------------------------------------------

    /// @inheritdoc IMatchAttestation
    function attest(bytes32 matchId, bytes32 resultHash) external onlyRole(ATTESTER_ROLE) {
        _attest(matchId, resultHash);
        unchecked {
            ++attestationCount;
        }
    }

    /// @inheritdoc IMatchAttestation
    function attestBatch(bytes32[] calldata matchIds, bytes32[] calldata resultHashes)
        external
        onlyRole(ATTESTER_ROLE)
    {
        uint256 length = matchIds.length;
        if (length != resultHashes.length) revert LengthMismatch(length, resultHashes.length);
        if (length == 0) revert EmptyBatch();

        for (uint256 i = 0; i < length; ++i) {
            _attest(matchIds[i], resultHashes[i]);
        }

        unchecked {
            attestationCount += length;
        }
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc IMatchAttestation
    function resultOf(bytes32 matchId) external view returns (bytes32) {
        return _results[matchId];
    }

    /// @inheritdoc IMatchAttestation
    function isAttested(bytes32 matchId) external view returns (bool) {
        return _results[matchId] != bytes32(0);
    }

    /// @inheritdoc IMatchAttestation
    function verify(bytes32 matchId, bytes32 resultHash) external view returns (bool) {
        // 未存证时 _results 为 0；要求 resultHash 非 0 才算通过，
        // 否则 verify(未存证的 id, 0) 会误判为真。
        return resultHash != bytes32(0) && _results[matchId] == resultHash;
    }

    // --------------------------------------------------------------------
    // 内部
    // --------------------------------------------------------------------

    function _attest(bytes32 matchId, bytes32 resultHash) private {
        if (matchId == bytes32(0)) revert ZeroMatchId();
        if (resultHash == bytes32(0)) revert ZeroResultHash();

        bytes32 existing = _results[matchId];
        // 不可覆盖 —— 这是整个合约存在的理由
        if (existing != bytes32(0)) revert AlreadyAttested(matchId, existing);

        _results[matchId] = resultHash;

        emit MatchAttested(matchId, resultHash, msg.sender, uint64(block.timestamp));
    }
}
