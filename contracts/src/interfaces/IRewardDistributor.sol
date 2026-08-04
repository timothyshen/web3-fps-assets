// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IRewardDistributor
/// @notice 奖励发放的唯一入口，持有 WeaponSkin 的 MINTER_ROLE。
/// @dev 两条路径共存：
///      - claim (pull)      玩家自己提交后端签发的 voucher，玩家付 gas（或 Paymaster 赞助）。
///                          未领取的奖励不上链，成本只在玩家真正想要时发生。
///      - mintDirect (push) 后端直接铸造，后端付 gas，玩家零操作。
///                          demo 体验最顺，靠 requestId 做幂等以容忍游戏服务器重试。
interface IRewardDistributor {
    /// @dev EIP-712 结构。domain separator 含 chainId + verifyingContract，
    ///      因此测试网签名无法在主网重放。
    struct Voucher {
        address player;
        uint32 skinDefId;
        uint16 wear;
        uint32 seasonId;
        uint256 nonce;
        uint64 deadline;
    }

    event RewardClaimed(
        address indexed player, uint256 indexed tokenId, uint32 indexed skinDefId, uint256 nonce
    );
    event RewardMinted(
        address indexed player, uint256 indexed tokenId, uint32 indexed skinDefId, bytes32 requestId
    );
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);

    error InvalidSignature();
    error VoucherExpired(uint64 deadline, uint256 nowTs);
    error NonceAlreadyUsed(address player, uint256 nonce);
    error RequestAlreadyProcessed(bytes32 requestId);
    error ZeroAddress();
    error ZeroRequestId();

    /// @notice 用后端签发的 voucher 领取奖励。任何人可代为提交，NFT 始终铸给 voucher.player。
    /// @dev 允许第三方提交是为了支持 relayer / Paymaster 代付。
    function claim(Voucher calldata voucher, bytes calldata signature) external returns (uint256 tokenId);

    /// @notice 后端直接铸造。仅 OPERATOR_ROLE。
    /// @param requestId 幂等键，建议 keccak256(abi.encode(matchId, playerId, slot))。
    ///                  重复提交同一 requestId 会 revert，游戏服务器可安全重试。
    function mintDirect(address to, uint32 skinDefId, uint16 wear, uint32 seasonId, bytes32 requestId)
        external
        returns (uint256 tokenId);

    function isNonceUsed(address player, uint256 nonce) external view returns (bool);
    function isRequestProcessed(bytes32 requestId) external view returns (bool);

    /// @notice 返回 voucher 的 EIP-712 摘要，供后端签名服务与前端调试比对。
    function voucherHash(Voucher calldata voucher) external view returns (bytes32);
}
