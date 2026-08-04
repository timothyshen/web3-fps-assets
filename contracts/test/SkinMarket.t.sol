// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./BaseTest.t.sol";
import {ISkinMarket} from "../src/interfaces/ISkinMarket.sol";

contract SkinMarketTest is BaseTest {
    uint256 internal tokenId;

    function setUp() public override {
        super.setUp();
        tokenId = _mintTo(player, SKIN_AK, keccak256("r1"));

        vm.prank(player);
        skin.setApprovalForAll(address(market), true);

        vm.deal(buyer, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function _list(uint96 price) internal {
        vm.prank(player);
        market.list(tokenId, price);
    }

    // ---- 挂单 ----

    function test_list_storesListing() public {
        _list(1 ether);

        ISkinMarket.Listing memory listing = market.getListing(tokenId);
        assertEq(listing.seller, player);
        assertEq(listing.price, 1 ether);
        assertTrue(market.isActive(tokenId));
    }

    function test_list_rejectsZeroPrice() public {
        vm.prank(player);
        vm.expectRevert(ISkinMarket.ZeroPrice.selector);
        market.list(tokenId, 0);
    }

    function test_list_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISkinMarket.NotTokenOwner.selector, tokenId, stranger));
        market.list(tokenId, 1 ether);
    }

    function test_list_requiresApproval() public {
        uint256 other = _mintTo(stranger, SKIN_AK, keccak256("r2"));

        vm.prank(stranger);
        vm.expectRevert(ISkinMarket.MarketNotApproved.selector);
        market.list(other, 1 ether);
    }

    function test_cancel_onlySeller() public {
        _list(1 ether);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISkinMarket.NotTokenOwner.selector, tokenId, stranger));
        market.cancel(tokenId);

        vm.prank(player);
        market.cancel(tokenId);
        assertEq(market.getListing(tokenId).seller, address(0));
    }

    // ---- 购买与分账 ----

    function test_buy_splitsRoyaltyAndProceeds() public {
        _list(1 ether);

        uint256 sellerBefore = player.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(buyer);
        market.buy{value: 1 ether}(tokenId);

        assertEq(skin.ownerOf(tokenId), buyer);
        assertEq(treasury.balance - treasuryBefore, 0.05 ether, "5% royalty");
        assertEq(player.balance - sellerBefore, 0.95 ether, "seller proceeds");
        assertEq(address(market).balance, 0, "market must not retain funds");
        assertEq(market.getListing(tokenId).seller, address(0), "listing cleared");
    }

    function test_buy_refundsOverpayment() public {
        _list(1 ether);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        market.buy{value: 3 ether}(tokenId);

        assertEq(buyerBefore - buyer.balance, 1 ether, "only the listed price should be charged");
    }

    function test_buy_rejectsUnderpayment() public {
        _list(1 ether);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(ISkinMarket.InsufficientPayment.selector, uint96(1 ether), 0.5 ether)
        );
        market.buy{value: 0.5 ether}(tokenId);
    }

    function test_buy_rejectsUnlisted() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISkinMarket.NotListed.selector, tokenId));
        market.buy{value: 1 ether}(tokenId);
    }

    function test_buy_cannotBuyTwice() public {
        _list(1 ether);

        vm.prank(buyer);
        market.buy{value: 1 ether}(tokenId);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISkinMarket.NotListed.selector, tokenId));
        market.buy{value: 1 ether}(tokenId);
    }

    // ---- 僵尸挂单 ----

    /// @dev 卖家挂单后把 NFT 转走，挂单必须失效而不是让买家白付钱。
    function test_buy_revertsOnStaleListing() public {
        _list(1 ether);

        vm.prank(player);
        skin.transferFrom(player, stranger, tokenId);

        assertFalse(market.isActive(tokenId));

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ISkinMarket.ListingStale.selector, tokenId));
        market.buy{value: 1 ether}(tokenId);
    }

    /// @dev 卖家撤销授权后，挂单在前端应被过滤掉。
    function test_isActive_falseAfterApprovalRevoked() public {
        _list(1 ether);

        vm.prank(player);
        skin.setApprovalForAll(address(market), false);

        assertFalse(market.isActive(tokenId));
    }

    function test_isActive_falseAfterBurn() public {
        _list(1 ether);

        vm.prank(player);
        skin.burn(tokenId);

        assertFalse(market.isActive(tokenId), "burned token must not look active");
    }

    // ---- 完整流通闭环 ----

    /// @dev demo 主线：奖励铸造 → 挂单 → 成交 → 买家可再次转售。
    function test_fullTradeLoop() public {
        _list(1 ether);

        vm.prank(buyer);
        market.buy{value: 1 ether}(tokenId);
        assertEq(skin.ownerOf(tokenId), buyer);

        // 买家成为新卖家
        vm.startPrank(buyer);
        skin.setApprovalForAll(address(market), true);
        market.list(tokenId, 2 ether);
        vm.stopPrank();

        uint256 treasuryBefore = treasury.balance;

        vm.prank(stranger);
        market.buy{value: 2 ether}(tokenId);

        assertEq(skin.ownerOf(tokenId), stranger);
        assertEq(treasury.balance - treasuryBefore, 0.1 ether, "royalty on every resale");
    }

    function testFuzz_accountingBalances(uint96 price) public {
        price = uint96(bound(price, 1, 100 ether));
        vm.deal(buyer, uint256(price) + 1 ether);

        vm.prank(player);
        market.list(tokenId, price);

        uint256 sellerBefore = player.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(buyer);
        market.buy{value: price}(tokenId);

        uint256 royalty = treasury.balance - treasuryBefore;
        uint256 proceeds = player.balance - sellerBefore;

        assertEq(royalty + proceeds, price, "every wei must be accounted for");
        assertEq(address(market).balance, 0);
    }
}
