// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IGameAssetRegistry
/// @notice 皮肤款式的目录与稀缺性来源。所有发行上限在这里强制。
/// @dev 款式（skinDefId）是"哪一款皮肤"，与具体某一件（tokenId）分开。
///      发行上限只能下调、不能上调 —— 这是对玩家的稀缺性承诺，写在代码里比写在
///      白皮书里可信。
interface IGameAssetRegistry {
    /// @param maxSupply   发行上限，只能下调。降到 0 表示"停止发行"，款式本身仍然存在
    /// @param minted      累计铸造数（销毁不会回退此值，序号永不复用）
    /// @param rarity      稀有度 0..4
    /// @param frozen      冻结后 contentHash 永久不可变
    /// @param exists      款式是否已定义
    /// @param contentHash 外观资源包（AssetBundle）的 keccak256 承诺
    /// @dev exists 是独立字段而不是复用 `maxSupply != 0`：把"未定义"和"已停止发行"
    ///      这两个不同状态挤进同一个哨兵值，会让 reduceMaxSupply(id, 0) 静默抹掉
    ///      一个已存在的款式定义。
    struct SkinDefinition {
        uint32 maxSupply;
        uint32 minted;
        uint8 rarity;
        bool frozen;
        bool exists;
        bytes32 contentHash;
    }

    event SkinDefined(uint32 indexed skinDefId, uint32 maxSupply, uint8 rarity, bytes32 contentHash);
    event MaxSupplyReduced(uint32 indexed skinDefId, uint32 previousMax, uint32 newMax);
    event ContentHashUpdated(uint32 indexed skinDefId, bytes32 previousHash, bytes32 newHash);
    event SkinFrozen(uint32 indexed skinDefId);
    event SupplyConsumed(uint32 indexed skinDefId, uint32 serial);
    event MinterUpdated(address indexed previousMinter, address indexed newMinter);

    error SkinAlreadyDefined(uint32 skinDefId);
    error SkinNotDefined(uint32 skinDefId);
    error SkinIsFrozen(uint32 skinDefId);
    error SupplyExhausted(uint32 skinDefId, uint32 maxSupply);
    error InvalidMaxSupply(uint32 requested);
    error NotAuthorizedMinter(address caller);
    error ZeroAddress();

    /// @notice 定义一款新皮肤。skinDefId 一旦使用不可重定义。
    function defineSkin(uint32 skinDefId, uint32 maxSupply, uint8 rarity, bytes32 contentHash) external;

    /// @notice 下调发行上限。newMaxSupply 必须严格小于当前上限且不小于已铸造数。
    function reduceMaxSupply(uint32 skinDefId, uint32 newMaxSupply) external;

    /// @notice 更新外观资源哈希（例如修复贴图 bug）。冻结后不可调用。
    /// @dev 触发链上事件，任何人可审计外观变更历史。
    function updateContentHash(uint32 skinDefId, bytes32 newContentHash) external;

    /// @notice 永久锁定该款式的 contentHash。单向操作，不可撤销。
    function freeze(uint32 skinDefId) external;

    /// @notice 原子地占用一个发行额度并返回序号。仅授权的 minter 合约可调用。
    /// @return serial 该款式内的序号，从 1 开始
    function consumeSupply(uint32 skinDefId) external returns (uint32 serial);

    function getSkin(uint32 skinDefId) external view returns (SkinDefinition memory);
    function isDefined(uint32 skinDefId) external view returns (bool);
    function remainingSupply(uint32 skinDefId) external view returns (uint32);
}
