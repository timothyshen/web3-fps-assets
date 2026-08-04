// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IGameAssetRegistry} from "./interfaces/IGameAssetRegistry.sol";

/// @title GameAssetRegistry
/// @notice 皮肤款式目录 + 发行上限的唯一强制点。
/// @dev 供应上限的强制放在这里而不是 NFT 合约里，是为了让 NFT 合约保持极简。
///      即使铸造权限被完全攻破，攻击者也无法铸造超过 maxSupply 的数量 —— 这是
///      整个系统对"无限增发"这一最高危风险的最后一道防线。
contract GameAssetRegistry is IGameAssetRegistry, Ownable {
    mapping(uint32 skinDefId => SkinDefinition) private _skins;

    /// @notice 唯一被允许调用 consumeSupply 的地址（WeaponSkin 合约）。
    address public minter;

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    // --------------------------------------------------------------------
    // 管理
    // --------------------------------------------------------------------

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    /// @inheritdoc IGameAssetRegistry
    function defineSkin(uint32 skinDefId, uint32 maxSupply, uint8 rarity, bytes32 contentHash)
        external
        onlyOwner
    {
        if (maxSupply == 0) revert InvalidMaxSupply(maxSupply);
        if (_skins[skinDefId].exists) revert SkinAlreadyDefined(skinDefId);

        _skins[skinDefId] = SkinDefinition({
            maxSupply: maxSupply,
            minted: 0,
            rarity: rarity,
            frozen: false,
            exists: true,
            contentHash: contentHash
        });

        emit SkinDefined(skinDefId, maxSupply, rarity, contentHash);
    }

    /// @inheritdoc IGameAssetRegistry
    /// @dev 允许降到 0 —— 那表示"这款不再发行了"，款式定义本身仍然可读。
    function reduceMaxSupply(uint32 skinDefId, uint32 newMaxSupply) external onlyOwner {
        SkinDefinition storage s = _requireDefined(skinDefId);
        // 严格小于当前上限（不可上调），且不能低于已铸造数（不能让既有资产超发）
        if (newMaxSupply >= s.maxSupply || newMaxSupply < s.minted) revert InvalidMaxSupply(newMaxSupply);

        emit MaxSupplyReduced(skinDefId, s.maxSupply, newMaxSupply);
        s.maxSupply = newMaxSupply;
    }

    /// @inheritdoc IGameAssetRegistry
    function updateContentHash(uint32 skinDefId, bytes32 newContentHash) external onlyOwner {
        SkinDefinition storage s = _requireDefined(skinDefId);
        if (s.frozen) revert SkinIsFrozen(skinDefId);

        emit ContentHashUpdated(skinDefId, s.contentHash, newContentHash);
        s.contentHash = newContentHash;
    }

    /// @inheritdoc IGameAssetRegistry
    function freeze(uint32 skinDefId) external onlyOwner {
        SkinDefinition storage s = _requireDefined(skinDefId);
        if (s.frozen) revert SkinIsFrozen(skinDefId);

        s.frozen = true;
        emit SkinFrozen(skinDefId);
    }

    // --------------------------------------------------------------------
    // 铸造
    // --------------------------------------------------------------------

    /// @inheritdoc IGameAssetRegistry
    function consumeSupply(uint32 skinDefId) external returns (uint32 serial) {
        if (msg.sender != minter) revert NotAuthorizedMinter(msg.sender);

        SkinDefinition storage s = _requireDefined(skinDefId);
        uint32 minted = s.minted;
        if (minted >= s.maxSupply) revert SupplyExhausted(skinDefId, s.maxSupply);

        unchecked {
            serial = minted + 1; // minted < maxSupply <= type(uint32).max，不会溢出
        }
        s.minted = serial;

        emit SupplyConsumed(skinDefId, serial);
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc IGameAssetRegistry
    function getSkin(uint32 skinDefId) external view returns (SkinDefinition memory) {
        return _requireDefined(skinDefId);
    }

    /// @inheritdoc IGameAssetRegistry
    function isDefined(uint32 skinDefId) external view returns (bool) {
        return _skins[skinDefId].exists;
    }

    /// @inheritdoc IGameAssetRegistry
    function remainingSupply(uint32 skinDefId) external view returns (uint32) {
        SkinDefinition storage s = _requireDefined(skinDefId);
        unchecked {
            return s.maxSupply - s.minted; // 不变量保证 minted <= maxSupply
        }
    }

    // --------------------------------------------------------------------
    // 内部
    // --------------------------------------------------------------------

    function _requireDefined(uint32 skinDefId) private view returns (SkinDefinition storage s) {
        s = _skins[skinDefId];
        if (!s.exists) revert SkinNotDefined(skinDefId);
    }
}
