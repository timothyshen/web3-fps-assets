// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";
import {ITournamentEscrow} from "../src/interfaces/ITournamentEscrow.sol";

/// @notice 收款会 revert 的合约，用于验证一个坏收款人不会拖垮所有人。
contract RejectingReceiver {
    receive() external payable {
        revert("no thanks");
    }

    function register(TournamentEscrow escrow, uint256 id, uint256 fee) external {
        escrow.register{value: fee}(id);
    }

    function claimPrize(TournamentEscrow escrow, uint256 id) external {
        escrow.claimPrize(id);
    }
}

contract TournamentEscrowTest is Test {
    TournamentEscrow internal escrow;

    address internal organizer = makeAddr("organizer");
    address internal gameServer = makeAddr("gameServer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal stranger = makeAddr("stranger");

    uint96 internal constant ENTRY_FEE = 1 ether;
    uint64 internal regDeadline;
    uint64 internal resultDeadline;

    function setUp() public {
        escrow = new TournamentEscrow();

        regDeadline = uint64(block.timestamp + 1 days);
        resultDeadline = uint64(block.timestamp + 3 days);

        for (uint256 i = 0; i < 5; ++i) {
            vm.deal(_player(i), 10 ether);
        }
        vm.deal(stranger, 10 ether);
    }

    function _player(uint256 i) internal view returns (address) {
        address[5] memory players = [alice, bob, carol, dave, organizer];
        return players[i];
    }

    function _defaultParams() internal view returns (ITournamentEscrow.TournamentParams memory p) {
        uint16[] memory payouts = new uint16[](3);
        payouts[0] = 5000; // 50%
        payouts[1] = 3000; // 30%
        payouts[2] = 2000; // 20%

        p = ITournamentEscrow.TournamentParams({
            resultSubmitter: gameServer,
            entryFee: ENTRY_FEE,
            minParticipants: 3,
            maxParticipants: 4,
            registrationDeadline: regDeadline,
            resultDeadline: resultDeadline,
            organizerFeeBps: 0,
            payoutBps: payouts
        });
    }

    function _create() internal returns (uint256 id) {
        vm.prank(organizer);
        id = escrow.createTournament(_defaultParams());
    }

    function _createAndFill() internal returns (uint256 id) {
        id = _create();
        vm.prank(alice);
        escrow.register{value: ENTRY_FEE}(id);
        vm.prank(bob);
        escrow.register{value: ENTRY_FEE}(id);
        vm.prank(carol);
        escrow.register{value: ENTRY_FEE}(id);
    }

    function _winners() internal view returns (address[] memory w) {
        w = new address[](3);
        w[0] = alice;
        w[1] = bob;
        w[2] = carol;
    }

    // --------------------------------------------------------------------
    // 创建
    // --------------------------------------------------------------------

    function test_create_storesParams() public {
        uint256 id = _create();
        ITournamentEscrow.Tournament memory t = escrow.getTournament(id);

        assertEq(t.organizer, organizer);
        assertEq(t.resultSubmitter, gameServer);
        assertEq(t.entryFee, ENTRY_FEE);
        assertEq(uint8(t.status), uint8(ITournamentEscrow.Status.Open));
        assertEq(escrow.getPayoutBps(id).length, 3);
    }

    function test_create_rejectsPayoutNotSummingTo10000() public {
        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.payoutBps[0] = 4000; // 总和变成 9000

        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.InvalidPayoutSplit.selector, uint256(9000)));
        escrow.createTournament(p);
    }

    /// @dev 组织者抽成有硬上限，且写死在代码里不可配置。
    function test_create_rejectsExcessiveOrganizerFee() public {
        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.organizerFeeBps = 1001; // > 10%

        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.InvalidParams.selector, "organizerFeeBps"));
        escrow.createTournament(p);
    }

    /// @dev 不能承诺发 3 个名次却只要求 2 人参赛。
    function test_create_rejectsMinParticipantsBelowRankCount() public {
        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.minParticipants = 2;

        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.InvalidParams.selector, "minParticipants"));
        escrow.createTournament(p);
    }

    function test_create_rejectsResultDeadlineBeforeRegistration() public {
        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.resultDeadline = p.registrationDeadline;

        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.InvalidParams.selector, "resultDeadline"));
        escrow.createTournament(p);
    }

    // --------------------------------------------------------------------
    // 报名
    // --------------------------------------------------------------------

    function test_register_accumulatesPool() public {
        uint256 id = _createAndFill();

        assertEq(escrow.getTournament(id).prizePool, 3 ether);
        assertEq(escrow.getTournament(id).participantCount, 3);
        assertEq(address(escrow).balance, 3 ether);
        assertTrue(escrow.isRegistered(id, alice));
    }

    function test_register_rejectsWrongFee() public {
        uint256 id = _create();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ITournamentEscrow.IncorrectEntryFee.selector, ENTRY_FEE, 0.5 ether)
        );
        escrow.register{value: 0.5 ether}(id);
    }

    function test_register_rejectsDouble() public {
        uint256 id = _create();

        vm.startPrank(alice);
        escrow.register{value: ENTRY_FEE}(id);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.AlreadyRegistered.selector, id, alice));
        escrow.register{value: ENTRY_FEE}(id);
        vm.stopPrank();
    }

    function test_register_rejectsAfterDeadline() public {
        uint256 id = _create();
        vm.warp(regDeadline + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.RegistrationClosed.selector, id));
        escrow.register{value: ENTRY_FEE}(id);
    }

    function test_register_rejectsWhenFull() public {
        uint256 id = _createAndFill();
        vm.prank(dave);
        escrow.register{value: ENTRY_FEE}(id); // 第 4 人，满员

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.TournamentFull.selector, id));
        escrow.register{value: ENTRY_FEE}(id);
    }

    function test_sponsor_addsToPool() public {
        uint256 id = _createAndFill();

        vm.prank(stranger);
        escrow.sponsor{value: 5 ether}(id);

        assertEq(escrow.getTournament(id).prizePool, 8 ether);
        assertEq(escrow.refundableOf(id, stranger), 5 ether);
    }

    // --------------------------------------------------------------------
    // 结算与领奖
    // --------------------------------------------------------------------

    function test_settle_splitsByRank() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("match-result"));

        // 奖池 3 ether，无组织者抽成
        assertEq(escrow.prizeOf(id, alice), 1.5 ether); // 50%
        assertEq(escrow.prizeOf(id, bob), 0.9 ether); // 30%
        assertEq(escrow.prizeOf(id, carol), 0.6 ether); // 20%
    }

    function test_claimPrize_paysOut() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        uint256 before = alice.balance;
        vm.prank(alice);
        escrow.claimPrize(id);

        assertEq(alice.balance - before, 1.5 ether);
        assertEq(escrow.prizeOf(id, alice), 0, "claim must zero the credit");
    }

    function test_claimPrize_cannotDoubleClaim() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        vm.startPrank(alice);
        escrow.claimPrize(id);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.NothingToClaim.selector, id, alice));
        escrow.claimPrize(id);
        vm.stopPrank();
    }

    /// @dev 整个奖池必须被分光，合约里不留残值。
    function test_settle_leavesNoDust() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        vm.prank(alice);
        escrow.claimPrize(id);
        vm.prank(bob);
        escrow.claimPrize(id);
        vm.prank(carol);
        escrow.claimPrize(id);

        assertEq(address(escrow).balance, 0, "pool must be fully distributed");
    }

    function test_settle_organizerFeeIsCapped() public {
        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.organizerFeeBps = 1000; // 上限 10%

        vm.prank(organizer);
        uint256 id = escrow.createTournament(p);

        vm.prank(alice);
        escrow.register{value: ENTRY_FEE}(id);
        vm.prank(bob);
        escrow.register{value: ENTRY_FEE}(id);
        vm.prank(carol);
        escrow.register{value: ENTRY_FEE}(id);

        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        assertEq(escrow.prizeOf(id, organizer), 0.3 ether, "10% of 3 ether");
        // 剩下 2.7 按 50/30/20 分
        assertEq(escrow.prizeOf(id, alice), 1.35 ether);
        assertEq(escrow.prizeOf(id, bob), 0.81 ether);
        assertEq(escrow.prizeOf(id, carol), 0.54 ether);
    }

    // ---- 结算的权限与时序 ----

    function test_settle_onlyResultSubmitter() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        vm.prank(organizer); // 组织者也不行
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.NotResultSubmitter.selector, organizer));
        escrow.settle(id, _winners(), keccak256("r"));
    }

    function test_settle_rejectsBeforeRegistrationCloses() public {
        uint256 id = _createAndFill(); // 3 人，未满 4 人

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.TooEarlyToSettle.selector, id));
        escrow.settle(id, _winners(), keccak256("r"));
    }

    /// @dev 报满后可提前开赛结算，不必等报名截止。
    function test_settle_allowedEarlyWhenFull() public {
        uint256 id = _createAndFill();
        vm.prank(dave);
        escrow.register{value: ENTRY_FEE}(id); // 满 4 人

        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        assertEq(uint8(escrow.getTournament(id).status), uint8(ITournamentEscrow.Status.Settled));
    }

    function test_settle_rejectsAfterResultDeadline() public {
        uint256 id = _createAndFill();
        vm.warp(resultDeadline + 1);

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.ResultDeadlinePassed.selector, id));
        escrow.settle(id, _winners(), keccak256("r"));
    }

    function test_settle_rejectsUnregisteredWinner() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        address[] memory w = _winners();
        w[1] = stranger;

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.WinnerNotRegistered.selector, stranger));
        escrow.settle(id, w, keccak256("r"));
    }

    /// @dev 同一个人不能占两个名次多拿钱。
    function test_settle_rejectsDuplicateWinner() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        address[] memory w = _winners();
        w[2] = alice;

        vm.prank(gameServer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.DuplicateWinner.selector, alice));
        escrow.settle(id, w, keccak256("r"));
    }

    function test_settle_rejectsWrongWinnerCount() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        address[] memory w = new address[](2);
        w[0] = alice;
        w[1] = bob;

        vm.prank(gameServer);
        vm.expectRevert(
            abi.encodeWithSelector(ITournamentEscrow.WinnerCountMismatch.selector, uint256(3), uint256(2))
        );
        escrow.settle(id, w, keccak256("r"));
    }

    function test_settle_cannotSettleTwice() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        vm.startPrank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));
        vm.expectRevert(
            abi.encodeWithSelector(
                ITournamentEscrow.WrongStatus.selector,
                id,
                ITournamentEscrow.Status.Settled,
                ITournamentEscrow.Status.Open
            )
        );
        escrow.settle(id, _winners(), keccak256("r2"));
        vm.stopPrank();
    }

    // --------------------------------------------------------------------
    // 组织者拿不走本金
    // --------------------------------------------------------------------

    /// @dev 这是整个合约存在的理由 —— 逐条验证组织者没有任何提款路径。
    function test_organizerCannotTouchPrincipal() public {
        uint256 id = _createAndFill();

        // 没有 withdraw / sweep / emergencyWithdraw 之类的方法
        string[4] memory backdoors = [
            "withdraw(uint256)",
            "sweep(address)",
            "emergencyWithdraw(uint256)",
            "setPrizePool(uint256,uint256)"
        ];
        for (uint256 i = 0; i < backdoors.length; ++i) {
            vm.prank(organizer);
            (bool ok,) =
                address(escrow).call(abi.encodeWithSelector(bytes4(keccak256(bytes(backdoors[i]))), id, id));
            assertFalse(ok, backdoors[i]);
        }

        // 抽成为 0 时，结算后组织者一分钱都领不到
        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        assertEq(escrow.prizeOf(id, organizer), 0);
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.NothingToClaim.selector, id, organizer));
        escrow.claimPrize(id);

        assertEq(address(escrow).balance, 3 ether, "principal still in escrow for winners");
    }

    /// @dev 组织者也不能事后换掉结果提交方来操纵结果。
    function test_noWayToChangeResultSubmitter() public {
        uint256 id = _createAndFill();

        vm.prank(organizer);
        (bool ok,) = address(escrow)
            .call(abi.encodeWithSignature("setResultSubmitter(uint256,address)", id, organizer));
        assertFalse(ok);
        assertEq(escrow.getTournament(id).resultSubmitter, gameServer);
    }

    // --------------------------------------------------------------------
    // 取消与退款（活性保证）
    // --------------------------------------------------------------------

    function test_cancel_byOrganizerBeforeDeadline() public {
        uint256 id = _createAndFill();

        vm.prank(organizer);
        escrow.cancel(id);

        assertEq(uint8(escrow.getTournament(id).status), uint8(ITournamentEscrow.Status.Cancelled));

        uint256 before = alice.balance;
        vm.prank(alice);
        escrow.claimRefund(id);
        assertEq(alice.balance - before, ENTRY_FEE);
    }

    function test_cancel_byAnyoneWhenNotEnoughParticipants() public {
        uint256 id = _create();
        vm.prank(alice);
        escrow.register{value: ENTRY_FEE}(id); // 只有 1 人，minParticipants = 3

        vm.warp(regDeadline + 1);

        assertTrue(escrow.canCancel(id, stranger));
        vm.prank(stranger); // 路人也能触发
        escrow.cancel(id);

        vm.prank(alice);
        escrow.claimRefund(id);
        assertEq(address(escrow).balance, 0);
    }

    /// @dev 最重要的活性保证：结果提交方失踪，资金不会永久锁死。
    function test_cancel_escapeHatchWhenSubmitterVanishes() public {
        uint256 id = _createAndFill();

        // 游戏服务器再也没提交结果
        vm.warp(resultDeadline + 1);

        assertTrue(escrow.canCancel(id, stranger), "anyone must be able to trigger the escape hatch");

        vm.prank(stranger);
        escrow.cancel(id);

        vm.prank(alice);
        escrow.claimRefund(id);
        vm.prank(bob);
        escrow.claimRefund(id);
        vm.prank(carol);
        escrow.claimRefund(id);

        assertEq(address(escrow).balance, 0, "everyone got their money back");
    }

    function test_cancel_rejectedWhileStillInProgress() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1); // 报名已截止、人数够、结果期未过

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.CancelNotAllowed.selector, id));
        escrow.cancel(id);
    }

    function test_cancel_organizerCannotCancelAfterRegistrationCloses() public {
        uint256 id = _createAndFill();
        vm.warp(regDeadline + 1);

        // 组织者不能在报名截止后反悔（否则可以看到形势不妙就掀桌）
        vm.prank(organizer);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.CancelNotAllowed.selector, id));
        escrow.cancel(id);
    }

    function test_refund_includesSponsorship() public {
        uint256 id = _createAndFill();
        vm.prank(stranger);
        escrow.sponsor{value: 2 ether}(id);

        vm.prank(organizer);
        escrow.cancel(id);

        uint256 before = stranger.balance;
        vm.prank(stranger);
        escrow.claimRefund(id);
        assertEq(stranger.balance - before, 2 ether, "sponsors get their money back too");
    }

    function test_refund_cannotDoubleClaim() public {
        uint256 id = _createAndFill();
        vm.prank(organizer);
        escrow.cancel(id);

        vm.startPrank(alice);
        escrow.claimRefund(id);
        vm.expectRevert(abi.encodeWithSelector(ITournamentEscrow.NothingToClaim.selector, id, alice));
        escrow.claimRefund(id);
        vm.stopPrank();
    }

    // --------------------------------------------------------------------
    // 一个坏收款人不能拖垮所有人
    // --------------------------------------------------------------------

    /// @dev 这就是出款用 pull 而非 push 的理由：如果结算时批量转账，
    ///      只要有一个赢家是收款会 revert 的合约，所有人的钱都卡住。
    function test_rejectingReceiverDoesNotBlockOthers() public {
        RejectingReceiver bad = new RejectingReceiver();
        vm.deal(address(bad), 10 ether);

        uint256 id = _create();
        bad.register(escrow, id, ENTRY_FEE);
        vm.prank(bob);
        escrow.register{value: ENTRY_FEE}(id);
        vm.prank(carol);
        escrow.register{value: ENTRY_FEE}(id);

        vm.warp(regDeadline + 1);

        address[] memory w = new address[](3);
        w[0] = address(bad); // 冠军是那个收不了钱的合约
        w[1] = bob;
        w[2] = carol;

        vm.prank(gameServer);
        escrow.settle(id, w, keccak256("r"));

        // 坏收款人自己领不到
        vm.expectRevert();
        bad.claimPrize(escrow, id);

        // 但其他人不受影响
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        escrow.claimPrize(id);
        assertEq(bob.balance - bobBefore, 0.9 ether);

        vm.prank(carol);
        escrow.claimPrize(id);

        // 坏收款人的份额留在合约里，不影响任何人
        assertEq(escrow.prizeOf(id, address(bad)), 1.5 ether);
    }

    // --------------------------------------------------------------------
    // 分账精度
    // --------------------------------------------------------------------

    /// @dev 任意奖池金额下，分出去的总额都必须精确等于奖池，一 wei 不多不少。
    function testFuzz_settlementIsExact(uint96 entryFee, uint16 feeBps) public {
        entryFee = uint96(bound(entryFee, 1, 1_000 ether));
        feeBps = uint16(bound(feeBps, 0, escrow.MAX_ORGANIZER_FEE_BPS()));

        ITournamentEscrow.TournamentParams memory p = _defaultParams();
        p.entryFee = entryFee;
        p.organizerFeeBps = feeBps;

        vm.prank(organizer);
        uint256 id = escrow.createTournament(p);

        address[3] memory players = [alice, bob, carol];
        for (uint256 i = 0; i < 3; ++i) {
            vm.deal(players[i], uint256(entryFee));
            vm.prank(players[i]);
            escrow.register{value: entryFee}(id);
        }

        uint256 pool = uint256(entryFee) * 3;
        vm.warp(regDeadline + 1);
        vm.prank(gameServer);
        escrow.settle(id, _winners(), keccak256("r"));

        uint256 total = escrow.prizeOf(id, alice) + escrow.prizeOf(id, bob) + escrow.prizeOf(id, carol)
            + escrow.prizeOf(id, organizer);

        assertEq(total, pool, "every wei must be assigned");
    }
}
