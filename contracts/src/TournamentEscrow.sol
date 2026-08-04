// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITournamentEscrow} from "./interfaces/ITournamentEscrow.sol";

/// @title TournamentEscrow
/// @notice 赛事奖池托管。报名费进合约，组织者拿不走本金。
/// @dev 信任模型与设计取舍见 ITournamentEscrow 的注释。
///
///      三条贯穿全合约的规则：
///      1. **出款一律 pull**（claimPrize / claimRefund），绝不在结算时批量 push。
///      2. **组织者的抽成有硬上限且创建时就公开**，报名者事前可见。
///      3. **任何状态都有出口** —— 提交方失踪、人数不足、组织者反悔，
///         都能走到退款，资金不会永久锁死。
contract TournamentEscrow is ITournamentEscrow, ReentrancyGuard {
    /// @notice 组织者抽成上限 10%。写死在代码里，不可配置。
    uint16 public constant MAX_ORGANIZER_FEE_BPS = 1_000;

    /// @notice 分账名次数量上限，用于给结算时的去重循环封顶。
    uint256 public constant MAX_PAYOUT_RANKS = 32;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    uint256 public tournamentCount;

    mapping(uint256 => Tournament) private _tournaments;
    mapping(uint256 => uint16[]) private _payoutBps;
    mapping(uint256 => mapping(address => bool)) private _registered;

    /// @dev 结算后的应领奖金（含组织者抽成）
    mapping(uint256 => mapping(address => uint256)) private _prize;

    /// @dev 取消后的应退金额（报名费 + 赞助款统一记在这里）
    mapping(uint256 => mapping(address => uint256)) private _refundable;

    // --------------------------------------------------------------------
    // 创建
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    function createTournament(TournamentParams calldata params) external returns (uint256 tournamentId) {
        if (params.resultSubmitter == address(0)) revert ZeroAddress();
        if (params.organizerFeeBps > MAX_ORGANIZER_FEE_BPS) revert InvalidParams("organizerFeeBps");
        if (params.registrationDeadline <= block.timestamp) revert InvalidParams("registrationDeadline");
        if (params.resultDeadline <= params.registrationDeadline) revert InvalidParams("resultDeadline");

        uint256 ranks = params.payoutBps.length;
        if (ranks == 0 || ranks > MAX_PAYOUT_RANKS) revert InvalidParams("payoutBps.length");
        if (params.maxParticipants < params.minParticipants) revert InvalidParams("maxParticipants");
        // 不能承诺发 3 个名次却只要求 2 人参赛
        if (params.minParticipants < ranks) revert InvalidParams("minParticipants");

        uint256 sumBps;
        for (uint256 i = 0; i < ranks; ++i) {
            sumBps += params.payoutBps[i];
        }
        if (sumBps != BPS_DENOMINATOR) revert InvalidPayoutSplit(sumBps);

        unchecked {
            tournamentId = ++tournamentCount;
        }

        _tournaments[tournamentId] = Tournament({
            organizer: msg.sender,
            entryFee: params.entryFee,
            resultSubmitter: params.resultSubmitter,
            maxParticipants: params.maxParticipants,
            minParticipants: params.minParticipants,
            organizerFeeBps: params.organizerFeeBps,
            status: Status.Open,
            registrationDeadline: params.registrationDeadline,
            resultDeadline: params.resultDeadline,
            participantCount: 0,
            prizePool: 0
        });
        _payoutBps[tournamentId] = params.payoutBps;

        emit TournamentCreated(
            tournamentId,
            msg.sender,
            params.resultSubmitter,
            params.entryFee,
            params.registrationDeadline,
            params.resultDeadline
        );
    }

    // --------------------------------------------------------------------
    // 入金
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    function register(uint256 tournamentId) external payable {
        Tournament storage t = _requireStatus(tournamentId, Status.Open);

        if (block.timestamp > t.registrationDeadline) revert RegistrationClosed(tournamentId);
        if (t.participantCount >= t.maxParticipants) revert TournamentFull(tournamentId);
        if (_registered[tournamentId][msg.sender]) revert AlreadyRegistered(tournamentId, msg.sender);
        if (msg.value != t.entryFee) revert IncorrectEntryFee(t.entryFee, msg.value);

        _registered[tournamentId][msg.sender] = true;
        unchecked {
            ++t.participantCount;
        }
        t.prizePool += msg.value;
        _refundable[tournamentId][msg.sender] += msg.value;

        emit Registered(tournamentId, msg.sender, msg.value);
    }

    /// @inheritdoc ITournamentEscrow
    function sponsor(uint256 tournamentId) external payable {
        Tournament storage t = _requireStatus(tournamentId, Status.Open);

        if (block.timestamp > t.registrationDeadline) revert RegistrationClosed(tournamentId);
        if (msg.value == 0) revert InvalidParams("msg.value");

        t.prizePool += msg.value;
        _refundable[tournamentId][msg.sender] += msg.value;

        emit Sponsored(tournamentId, msg.sender, msg.value);
    }

    // --------------------------------------------------------------------
    // 结算
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    /// @dev 拆成 _validateSettle / _assignPrizes 两个内部函数，是为了避免
    ///      "stack too deep"。也可以开 via_ir 绕过，但那会改变已实测的 gas 数字
    ///      并显著拖慢编译 —— 拆函数的代价更小。
    function settle(uint256 tournamentId, address[] calldata winners, bytes32 resultHash) external {
        Tournament storage t = _requireStatus(tournamentId, Status.Open);

        _validateSettle(t, tournamentId, winners.length);

        // effects 先行：状态改完再进入分账
        t.status = Status.Settled;

        uint256 pool = t.prizePool;
        _assignPrizes(tournamentId, winners, pool, t.organizerFeeBps, t.organizer);

        emit Settled(tournamentId, resultHash, pool);
    }

    function _validateSettle(Tournament storage t, uint256 tournamentId, uint256 winnerCount) private view {
        if (msg.sender != t.resultSubmitter) revert NotResultSubmitter(msg.sender);

        // 报名截止后才能结算；报满则可提前开赛
        bool registrationOver = block.timestamp > t.registrationDeadline;
        bool isFull = t.participantCount >= t.maxParticipants;
        if (!registrationOver && !isFull) revert TooEarlyToSettle(tournamentId);

        // 超时后不再接受结果，只能走退款 —— 否则提交方可以无限期扣着钱
        if (block.timestamp > t.resultDeadline) revert ResultDeadlinePassed(tournamentId);

        if (t.participantCount < t.minParticipants) {
            revert NotEnoughParticipants(t.participantCount, t.minParticipants);
        }

        uint256 rankCount = _payoutBps[tournamentId].length;
        if (winnerCount != rankCount) revert WinnerCountMismatch(rankCount, winnerCount);
    }

    function _assignPrizes(
        uint256 tournamentId,
        address[] calldata winners,
        uint256 pool,
        uint16 organizerFeeBps,
        address organizer
    ) private {
        uint16[] storage payouts = _payoutBps[tournamentId];

        uint256 organizerFee = (pool * organizerFeeBps) / BPS_DENOMINATOR;
        uint256 distributable = pool - organizerFee;
        uint256 assigned;

        for (uint256 i = 0; i < winners.length; ++i) {
            address winner = winners[i];
            if (!_registered[tournamentId][winner]) revert WinnerNotRegistered(winner);

            // MAX_PAYOUT_RANKS 保证这个 O(n^2) 去重是有界的
            for (uint256 j = 0; j < i; ++j) {
                if (winners[j] == winner) revert DuplicateWinner(winner);
            }

            uint256 amount = (distributable * payouts[i]) / BPS_DENOMINATOR;
            assigned += amount;
            _prize[tournamentId][winner] += amount;

            emit PrizeAssigned(tournamentId, winner, uint8(i + 1), amount);
        }

        // 整除余下的尘埃归冠军，保证 sum(_prize) == prizePool，合约里不留残值
        uint256 dust = distributable - assigned;
        if (dust != 0) {
            _prize[tournamentId][winners[0]] += dust;
        }

        if (organizerFee != 0) {
            _prize[tournamentId][organizer] += organizerFee;
        }
    }

    // --------------------------------------------------------------------
    // 取消
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    function cancel(uint256 tournamentId) external {
        Tournament storage t = _requireStatus(tournamentId, Status.Open);

        string memory reason;

        if (msg.sender == t.organizer && block.timestamp <= t.registrationDeadline) {
            reason = "organizer_cancelled";
        } else if (block.timestamp > t.registrationDeadline && t.participantCount < t.minParticipants) {
            reason = "not_enough_participants";
        } else if (block.timestamp > t.resultDeadline) {
            // 活性逃生舱：提交方失踪也不会锁死资金
            reason = "result_deadline_passed";
        } else {
            revert CancelNotAllowed(tournamentId);
        }

        t.status = Status.Cancelled;

        emit Cancelled(tournamentId, msg.sender, reason);
    }

    // --------------------------------------------------------------------
    // 出款（一律 pull）
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    function claimPrize(uint256 tournamentId) external nonReentrant {
        _requireStatus(tournamentId, Status.Settled);

        uint256 amount = _prize[tournamentId][msg.sender];
        if (amount == 0) revert NothingToClaim(tournamentId, msg.sender);

        _prize[tournamentId][msg.sender] = 0;
        _send(msg.sender, amount);

        emit PrizeClaimed(tournamentId, msg.sender, amount);
    }

    /// @inheritdoc ITournamentEscrow
    function claimRefund(uint256 tournamentId) external nonReentrant {
        _requireStatus(tournamentId, Status.Cancelled);

        uint256 amount = _refundable[tournamentId][msg.sender];
        if (amount == 0) revert NothingToClaim(tournamentId, msg.sender);

        _refundable[tournamentId][msg.sender] = 0;
        _send(msg.sender, amount);

        emit RefundClaimed(tournamentId, msg.sender, amount);
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc ITournamentEscrow
    function getTournament(uint256 tournamentId) external view returns (Tournament memory) {
        Tournament memory t = _tournaments[tournamentId];
        if (t.status == Status.None) revert TournamentNotFound(tournamentId);
        return t;
    }

    /// @inheritdoc ITournamentEscrow
    function getPayoutBps(uint256 tournamentId) external view returns (uint16[] memory) {
        return _payoutBps[tournamentId];
    }

    /// @inheritdoc ITournamentEscrow
    function isRegistered(uint256 tournamentId, address player) external view returns (bool) {
        return _registered[tournamentId][player];
    }

    /// @inheritdoc ITournamentEscrow
    function prizeOf(uint256 tournamentId, address account) external view returns (uint256) {
        return _prize[tournamentId][account];
    }

    /// @inheritdoc ITournamentEscrow
    function refundableOf(uint256 tournamentId, address account) external view returns (uint256) {
        return _refundable[tournamentId][account];
    }

    /// @inheritdoc ITournamentEscrow
    function canCancel(uint256 tournamentId, address caller) external view returns (bool) {
        Tournament storage t = _tournaments[tournamentId];
        if (t.status != Status.Open) return false;

        if (caller == t.organizer && block.timestamp <= t.registrationDeadline) return true;
        if (block.timestamp > t.registrationDeadline && t.participantCount < t.minParticipants) {
            return true;
        }
        return block.timestamp > t.resultDeadline;
    }

    // --------------------------------------------------------------------
    // 内部
    // --------------------------------------------------------------------

    function _requireStatus(uint256 tournamentId, Status expected)
        private
        view
        returns (Tournament storage t)
    {
        t = _tournaments[tournamentId];
        if (t.status == Status.None) revert TournamentNotFound(tournamentId);
        if (t.status != expected) revert WrongStatus(tournamentId, t.status, expected);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }
}
