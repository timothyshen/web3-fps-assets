// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ISkinMarket} from "./interfaces/ISkinMarket.sol";

/// @title SkinMarket
/// @notice 极简固定价格市场：挂单 / 撤单 / 购买，原生币计价（Monad 上是 MON），按 EIP-2981 分版税。
/// @dev 存在的理由见 ISkinMarket。这是 demo 用的最小可行市场，不是要跟 Seaport 竞争。
///
///      刻意的简化（上主网前需要重新评估）：
///      - 直接 push 转账而非 pull payment。卖家若是 receive 会 revert 的合约，
///        交易会失败。对 EOA 玩家无影响。
///      - 无出价（bid）、无拍卖、无批量购买。
///      - 无平台手续费，收入完全来自 EIP-2981 版税。
contract SkinMarket is ISkinMarket, ReentrancyGuard {
    IERC721 public immutable collection;

    mapping(uint256 tokenId => Listing) private _listings;

    constructor(address collection_) {
        if (collection_ == address(0)) revert ZeroAddress();
        collection = IERC721(collection_);
    }

    // --------------------------------------------------------------------
    // 挂单
    // --------------------------------------------------------------------

    /// @inheritdoc ISkinMarket
    function list(uint256 tokenId, uint96 price) external {
        if (price == 0) revert ZeroPrice();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (!collection.isApprovedForAll(msg.sender, address(this))) revert MarketNotApproved();

        _listings[tokenId] = Listing({seller: msg.sender, price: price});

        emit Listed(tokenId, msg.sender, price);
    }

    /// @inheritdoc ISkinMarket
    function cancel(uint256 tokenId) external {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) revert NotListed(tokenId);
        if (listing.seller != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        delete _listings[tokenId];

        emit Cancelled(tokenId, msg.sender);
    }

    // --------------------------------------------------------------------
    // 购买
    // --------------------------------------------------------------------

    /// @inheritdoc ISkinMarket
    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) revert NotListed(tokenId);
        if (msg.value < listing.price) revert InsufficientPayment(listing.price, msg.value);

        // 卖家可能在挂单后把 NFT 转走或撤销授权，挂单变成僵尸单。
        if (collection.ownerOf(tokenId) != listing.seller) revert ListingStale(tokenId);

        // effects：先清挂单，再做任何外部调用
        delete _listings[tokenId];

        (address royaltyReceiver, uint256 royaltyAmount) =
            IERC2981(address(collection)).royaltyInfo(tokenId, listing.price);

        // 防御恶意/错误的 royaltyInfo 实现吃掉全部货款
        if (royaltyAmount >= listing.price) revert InvalidRoyalty(royaltyAmount, listing.price);
        if (royaltyReceiver == address(0)) royaltyAmount = 0;

        uint256 sellerProceeds = listing.price - royaltyAmount;

        // interactions
        collection.safeTransferFrom(listing.seller, msg.sender, tokenId);

        if (royaltyAmount != 0) _send(royaltyReceiver, royaltyAmount);
        _send(listing.seller, sellerProceeds);

        uint256 refund = msg.value - listing.price;
        if (refund != 0) _send(msg.sender, refund);

        emit Sold(tokenId, listing.seller, msg.sender, listing.price, royaltyReceiver, royaltyAmount);
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc ISkinMarket
    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    /// @inheritdoc ISkinMarket
    function isActive(uint256 tokenId) external view returns (bool) {
        Listing memory listing = _listings[tokenId];
        if (listing.seller == address(0)) return false;

        // ownerOf 对已销毁的 token 会 revert，用 try 兜住
        try collection.ownerOf(tokenId) returns (address currentOwner) {
            if (currentOwner != listing.seller) return false;
        } catch {
            return false;
        }

        return collection.isApprovedForAll(listing.seller, address(this));
    }

    // --------------------------------------------------------------------
    // 内部
    // --------------------------------------------------------------------

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }
}
