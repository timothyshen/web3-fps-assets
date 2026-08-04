// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";
import {ITournamentEscrow} from "../src/interfaces/ITournamentEscrow.sol";

/// @notice 随机驱动赛事的完整生命周期，用于压偿付能力不变量。
/// @dev 含 warp，否则永远走不到结算/取消/超时这些依赖时间的状态。
contract EscrowHandler is Test {
    TournamentEscrow public immutable escrow;

    address public immutable organizer;
    address public immutable gameServer;
    address[4] public actors;

    uint256[] public tournamentIds;

    /// @dev ghost 变量：累计进出金额
    uint256 public totalIn;
    uint256 public totalOut;

    constructor(TournamentEscrow escrow_) {
        escrow = escrow_;
        organizer = makeAddr("inv_organizer");
        gameServer = makeAddr("inv_gameServer");
        actors = [makeAddr("inv_a"), makeAddr("inv_b"), makeAddr("inv_c"), makeAddr("inv_d")];
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _tournament(uint256 seed) private view returns (uint256 id, bool ok) {
        if (tournamentIds.length == 0) return (0, false);
        return (tournamentIds[seed % tournamentIds.length], true);
    }

    function createTournament(uint256 seed) external {
        if (tournamentIds.length >= 5) return;

        uint16[] memory payouts = new uint16[](2);
        payouts[0] = 6000;
        payouts[1] = 4000;

        ITournamentEscrow.TournamentParams memory p = ITournamentEscrow.TournamentParams({
            resultSubmitter: gameServer,
            entryFee: uint96(bound(seed, 0, 5 ether)),
            minParticipants: 2,
            maxParticipants: 4,
            registrationDeadline: uint64(block.timestamp + 1 + (seed % 3 days)),
            resultDeadline: uint64(block.timestamp + 1 + (seed % 3 days) + 1 days),
            organizerFeeBps: uint16(bound(seed, 0, 1000)),
            payoutBps: payouts
        });

        vm.prank(organizer);
        try escrow.createTournament(p) returns (uint256 id) {
            tournamentIds.push(id);
        } catch {}
    }

    function register(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        address actor = _actor(seed >> 8);
        uint96 fee = escrow.getTournament(id).entryFee;
        vm.deal(actor, uint256(fee) + 1 ether);

        uint256 before = address(escrow).balance;
        vm.prank(actor);
        try escrow.register{value: fee}(id) {
            totalIn += address(escrow).balance - before;
        } catch {}
    }

    function sponsor(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        address actor = _actor(seed >> 8);
        uint256 amount = bound(seed, 1, 3 ether);
        vm.deal(actor, amount);

        uint256 before = address(escrow).balance;
        vm.prank(actor);
        try escrow.sponsor{value: amount}(id) {
            totalIn += address(escrow).balance - before;
        } catch {}
    }

    function settle(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        // 找两个已报名的地址当赢家
        address[] memory winners = new address[](2);
        uint256 found;
        for (uint256 i = 0; i < actors.length && found < 2; ++i) {
            if (escrow.isRegistered(id, actors[i])) {
                winners[found++] = actors[i];
            }
        }
        if (found < 2) return;

        vm.prank(gameServer);
        try escrow.settle(id, winners, keccak256(abi.encode(id, seed))) {} catch {}
    }

    function cancel(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        address caller = seed % 2 == 0 ? organizer : _actor(seed >> 8);
        vm.prank(caller);
        try escrow.cancel(id) {} catch {}
    }

    function claimPrize(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        address actor = seed % 5 == 0 ? organizer : _actor(seed >> 8);
        uint256 before = address(escrow).balance;
        vm.prank(actor);
        try escrow.claimPrize(id) {
            totalOut += before - address(escrow).balance;
        } catch {}
    }

    function claimRefund(uint256 seed) external {
        (uint256 id, bool ok) = _tournament(seed);
        if (!ok) return;

        address actor = _actor(seed >> 8);
        uint256 before = address(escrow).balance;
        vm.prank(actor);
        try escrow.claimRefund(id) {
            totalOut += before - address(escrow).balance;
        } catch {}
    }

    /// @dev 推进时间，让结算 / 超时退款这些状态可达。
    function passTime(uint256 seed) external {
        vm.warp(block.timestamp + bound(seed, 1 hours, 2 days));
    }

    function tournamentCount() external view returns (uint256) {
        return tournamentIds.length;
    }
}

contract TournamentEscrowInvariantTest is Test {
    TournamentEscrow internal escrow;
    EscrowHandler internal handler;

    function setUp() public {
        escrow = new TournamentEscrow();
        handler = new EscrowHandler(escrow);
        targetContract(address(handler));
    }

    /// @notice 偿付能力：合约余额恒等于"收进来的减去付出去的"。
    ///         多付一 wei 或凭空少一 wei 都会在这里炸。
    function invariant_solvent() public view {
        assertEq(address(escrow).balance, handler.totalIn() - handler.totalOut());
    }

    /// @notice 付出去的永远不能超过收进来的 —— 合约不会凭空造钱。
    function invariant_neverPaysOutMoreThanTakenIn() public view {
        assertLe(handler.totalOut(), handler.totalIn());
    }

    /// @notice 每场赛事的 prizePool 都不超过合约总余额加已付出部分，
    ///         即账目不会被跨赛事串号污染。
    function invariant_poolAccountingIsConsistent() public view {
        uint256 count = handler.tournamentCount();
        uint256 openPools;

        for (uint256 i = 0; i < count; ++i) {
            uint256 id = handler.tournamentIds(i);
            ITournamentEscrow.Tournament memory t = escrow.getTournament(id);
            if (t.status == ITournamentEscrow.Status.Open) {
                openPools += t.prizePool;
            }
        }

        // 未结算赛事的资金必须还完整躺在合约里
        assertLe(openPools, address(escrow).balance);
    }
}
