// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISkinMarket
/// @notice 极简的固定价格挂单市场，原生币计价（Monad 上是 MON），按 EIP-2981 分版税。
/// @dev 存在的理由：hackathon demo 需要一个当场可演示的完整交易闭环，
///      而测试网的第三方市场（OpenSea 等）索引不稳定、经常看不到刚铸造的 NFT。
///      主网上线时应改为直接依赖 Seaport —— 自建市场做不出流动性。
interface ISkinMarket {
    /// @dev seller(160) + price(96) 打包进 1 个 slot
    struct Listing {
        address seller;
        uint96 price;
    }

    event Listed(uint256 indexed tokenId, address indexed seller, uint96 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint96 price,
        address royaltyReceiver,
        uint256 royaltyAmount
    );

    error ZeroPrice();
    error NotListed(uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error MarketNotApproved();
    error ListingStale(uint256 tokenId);
    error InsufficientPayment(uint96 price, uint256 sent);
    error InvalidRoyalty(uint256 royaltyAmount, uint96 price);
    error TransferFailed(address to, uint256 amount);
    error ZeroAddress();

    /// @notice 挂单。需先对本合约 setApprovalForAll。
    function list(uint256 tokenId, uint96 price) external;

    /// @notice 撤单。仅卖家本人。
    function cancel(uint256 tokenId) external;

    /// @notice 购买。多付的部分自动退还。
    function buy(uint256 tokenId) external payable;

    function getListing(uint256 tokenId) external view returns (Listing memory);

    /// @notice 挂单是否仍然可成交（卖家仍持有且授权仍在）。
    /// @dev 卖家可能在挂单后把 NFT 转走或撤销授权，此时挂单变成"僵尸单"。
    ///      前端应用此方法过滤展示。
    function isActive(uint256 tokenId) external view returns (bool);
}
