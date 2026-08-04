// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IWeaponSkin
/// @notice 武器皮肤 NFT 的游戏侧扩展接口。
/// @dev 实现合约同时实现 IERC721 / IERC721Enumerable / IERC2981 / IAccessControl，
///      此接口只声明游戏特有的部分，避免与标准接口的菱形继承。
///
///      刻意不存在的方法：adminTransfer / adminBurn / setTransferEnabled。
///      任何一个都会让"玩家真正拥有"这句话失效。
interface IWeaponSkin {
    /// @dev 整个结构打包进 1 个 storage slot（32+32+16+32+64 = 176 bits）
    /// @param skinDefId 款式 ID，指向 IGameAssetRegistry
    /// @param serial    该款式内的序号，从 1 开始
    /// @param wear      磨损，0..10000（万分比），铸造后不可变
    /// @param seasonId  首发赛季
    /// @param mintedAt  铸造时的区块时间戳
    struct SkinData {
        uint32 skinDefId;
        uint32 serial;
        uint16 wear;
        uint32 seasonId;
        uint64 mintedAt;
    }

    event SkinMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint32 indexed skinDefId,
        uint32 serial,
        uint16 wear,
        uint32 seasonId
    );
    event BaseURIUpdated(string previousBaseURI, string newBaseURI);

    error WearOutOfRange(uint16 wear);
    error TokenDoesNotExist(uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error ZeroAddress();

    /// @notice 铸造一件皮肤。仅 MINTER_ROLE。供应上限由 registry 强制。
    /// @return tokenId (skinDefId << 32) | serial
    function mint(address to, uint32 skinDefId, uint16 wear, uint32 seasonId)
        external
        returns (uint256 tokenId);

    /// @notice 持有者销毁自己的资产。没有管理员销毁通道。
    /// @dev 销毁不回退 registry 的 minted 计数，序号永不复用。
    function burn(uint256 tokenId) external;

    function skinData(uint256 tokenId) external view returns (SkinData memory);

    /// @notice 列出某地址持有的全部 tokenId。
    /// @dev 基于 ERC721Enumerable，让 web 端和后端无需自建索引服务即可读取库存。
    ///      O(n) 循环，仅供链下 view 调用，不要在交易中使用。
    function tokensOfOwner(address owner) external view returns (uint256[] memory);

    /// @notice 从 tokenId 反解出款式与序号，无需读 storage。
    function decodeTokenId(uint256 tokenId) external pure returns (uint32 skinDefId, uint32 serial);
}
