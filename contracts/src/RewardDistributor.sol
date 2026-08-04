// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IRewardDistributor} from "./interfaces/IRewardDistributor.sol";
import {IWeaponSkin} from "./interfaces/IWeaponSkin.sol";

/// @title RewardDistributor
/// @notice 奖励发放入口。持有 WeaponSkin 的 MINTER_ROLE，是唯一能铸造的地址。
/// @dev 这里是整个系统权限最集中的地方，因此攻击面刻意收得很窄：
///      - 铸造数量的天花板不在这里，在 GameAssetRegistry.maxSupply。即使签名密钥
///        完全泄露，攻击者也只能把已定义款式铸到上限为止，无法无限增发。
///      - voucher 的 nonce 用 bitmap 存储，比 mapping(uint256 => bool) 省约 80% gas。
///      - domain separator 含 chainId + verifyingContract，测试网签名无法在主网重放。
contract RewardDistributor is IRewardDistributor, EIP712, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address player,uint32 skinDefId,uint16 wear,uint32 seasonId,uint256 nonce,uint64 deadline)"
    );

    IWeaponSkin public immutable weaponSkin;

    /// @notice 签发 voucher 的后端地址。私钥应放在 KMS 中，服务无法导出。
    address public signer;

    /// @dev player => (nonce/256) => bitmap
    mapping(address player => mapping(uint256 wordIndex => uint256 bitmap)) private _nonceBitmap;

    /// @dev push 路径的幂等键。游戏服务器重试推送是常态，重复发奖是事故。
    mapping(bytes32 requestId => bool) private _processedRequests;

    constructor(address weaponSkin_, address admin_, address signer_)
        EIP712("FpsAssetRewardDistributor", "1")
    {
        if (weaponSkin_ == address(0) || admin_ == address(0) || signer_ == address(0)) {
            revert ZeroAddress();
        }

        weaponSkin = IWeaponSkin(weaponSkin_);
        signer = signer_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(SIGNER_ADMIN_ROLE, admin_);
        _grantRole(OPERATOR_ROLE, admin_);

        emit SignerUpdated(address(0), signer_);
    }

    // --------------------------------------------------------------------
    // pull —— 玩家提交 voucher
    // --------------------------------------------------------------------

    /// @inheritdoc IRewardDistributor
    function claim(Voucher calldata voucher, bytes calldata signature) external returns (uint256 tokenId) {
        if (block.timestamp > voucher.deadline) {
            revert VoucherExpired(voucher.deadline, block.timestamp);
        }

        bytes32 digest = _hashVoucher(voucher);
        address recovered = ECDSA.recover(digest, signature);
        // 用 != 而非 hasRole：签名者是单一地址，比较更省 gas 也更明确。
        if (recovered != signer) revert InvalidSignature();

        _consumeNonce(voucher.player, voucher.nonce);

        tokenId = weaponSkin.mint(voucher.player, voucher.skinDefId, voucher.wear, voucher.seasonId);

        emit RewardClaimed(voucher.player, tokenId, voucher.skinDefId, voucher.nonce);
    }

    // --------------------------------------------------------------------
    // push —— 后端直接铸造
    // --------------------------------------------------------------------

    /// @inheritdoc IRewardDistributor
    function mintDirect(address to, uint32 skinDefId, uint16 wear, uint32 seasonId, bytes32 requestId)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (requestId == bytes32(0)) revert ZeroRequestId();
        if (_processedRequests[requestId]) revert RequestAlreadyProcessed(requestId);

        _processedRequests[requestId] = true;

        tokenId = weaponSkin.mint(to, skinDefId, wear, seasonId);

        emit RewardMinted(to, tokenId, skinDefId, requestId);
    }

    // --------------------------------------------------------------------
    // 管理
    // --------------------------------------------------------------------

    /// @notice 轮换签名地址。
    /// @dev 换 signer 会立即作废旧 signer 签发的所有未使用 voucher，包括合法的。
    ///      这是刻意的：密钥泄露时宁可让玩家重领一次，也不能让攻击者继续铸造。
    ///      后端的待领奖励记录还在，重新签发对玩家无感。
    function setSigner(address newSigner) external onlyRole(SIGNER_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc IRewardDistributor
    function isNonceUsed(address player, uint256 nonce) external view returns (bool) {
        (uint256 wordIndex, uint256 mask) = _noncePosition(nonce);
        return _nonceBitmap[player][wordIndex] & mask != 0;
    }

    /// @inheritdoc IRewardDistributor
    function isRequestProcessed(bytes32 requestId) external view returns (bool) {
        return _processedRequests[requestId];
    }

    /// @inheritdoc IRewardDistributor
    function voucherHash(Voucher calldata voucher) external view returns (bytes32) {
        return _hashVoucher(voucher);
    }

    /// @notice 暴露 domain separator，方便后端签名服务与前端自检。
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // --------------------------------------------------------------------
    // 内部
    // --------------------------------------------------------------------

    function _hashVoucher(Voucher calldata voucher) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOUCHER_TYPEHASH,
                    voucher.player,
                    voucher.skinDefId,
                    voucher.wear,
                    voucher.seasonId,
                    voucher.nonce,
                    voucher.deadline
                )
            )
        );
    }

    function _consumeNonce(address player, uint256 nonce) private {
        (uint256 wordIndex, uint256 mask) = _noncePosition(nonce);
        uint256 word = _nonceBitmap[player][wordIndex];
        if (word & mask != 0) revert NonceAlreadyUsed(player, nonce);
        _nonceBitmap[player][wordIndex] = word | mask;
    }

    function _noncePosition(uint256 nonce) private pure returns (uint256 wordIndex, uint256 mask) {
        wordIndex = nonce >> 8;
        // 显式 uint256(1)：字面量做移位左操作数时 Solidity 的类型推导有坑，
        // 若被推导成小整数类型，高位 bitPos 会被截断成 0。
        uint256 bitPos = nonce & 0xff;
        mask = uint256(1) << bitPos;
    }
}
