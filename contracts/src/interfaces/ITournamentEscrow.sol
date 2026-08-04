// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ITournamentEscrow
/// @notice 赛事奖池托管：报名费进合约，比赛结束按名次自动分账。
///
/// @dev **这个合约解决什么、不解决什么，必须说清楚。**
///
///      解决：组织者卷款跑路。报名费一旦进合约，组织者**拿不走本金** ——
///      他只能拿到创建赛事时就公开声明、且有上限的抽成。分账比例在开赛前
///      写死，事后改不了。
///
///      不解决：结果提交方说谎。`resultSubmitter` 报什么名次，合约就按什么
///      分钱。合约无法判断谁真的赢了。
///
///      因此这里的设计原则是**让信任假设变得显式且可预先审查**：
///      - `resultSubmitter` 在创建赛事时确定，报名前就能看到自己在信任谁；
///      - 报名后不可更换提交方；
///      - 结果与 resultHash 一起上链，事后可对照对局存证核验；
///      - 提交方失踪也不会锁死资金 —— 过了 resultDeadline 任何人都能触发
///        取消，全额退款。这条是整个合约里最重要的活性保证。
///
///      所有出款都是 pull（玩家自己来领），不是 push。原因：push 给 N 个赢家
///      时，只要有一个是收款会 revert 的合约，全部人的钱都卡住。
interface ITournamentEscrow {
    enum Status {
        None,
        Open,
        Settled,
        Cancelled
    }

    /// @param resultSubmitter    唯一有权提交名次的地址（游戏服务器）
    /// @param entryFee           报名费，可为 0（纯赞助赛）
    /// @param minParticipants    低于此人数则赛事作废、全额退款
    /// @param maxParticipants    报满即可提前结算
    /// @param registrationDeadline 报名截止
    /// @param resultDeadline     结果提交截止；超时后任何人可触发退款
    /// @param organizerFeeBps    组织者抽成，上限 MAX_ORGANIZER_FEE_BPS
    /// @param payoutBps          按名次的分配比例，payoutBps[0] 是冠军，总和须为 10000
    struct TournamentParams {
        address resultSubmitter;
        uint96 entryFee;
        uint32 minParticipants;
        uint32 maxParticipants;
        uint64 registrationDeadline;
        uint64 resultDeadline;
        uint16 organizerFeeBps;
        uint16[] payoutBps;
    }

    struct Tournament {
        address organizer;
        uint96 entryFee;
        address resultSubmitter;
        uint32 maxParticipants;
        uint32 minParticipants;
        uint16 organizerFeeBps;
        Status status;
        uint64 registrationDeadline;
        uint64 resultDeadline;
        uint32 participantCount;
        uint256 prizePool;
    }

    event TournamentCreated(
        uint256 indexed tournamentId,
        address indexed organizer,
        address indexed resultSubmitter,
        uint96 entryFee,
        uint64 registrationDeadline,
        uint64 resultDeadline
    );
    event Registered(uint256 indexed tournamentId, address indexed player, uint256 amount);
    event Sponsored(uint256 indexed tournamentId, address indexed sponsor, uint256 amount);
    event Settled(uint256 indexed tournamentId, bytes32 indexed resultHash, uint256 prizePool);
    event PrizeAssigned(uint256 indexed tournamentId, address indexed winner, uint8 rank, uint256 amount);
    event Cancelled(uint256 indexed tournamentId, address indexed triggeredBy, string reason);
    event PrizeClaimed(uint256 indexed tournamentId, address indexed winner, uint256 amount);
    event RefundClaimed(uint256 indexed tournamentId, address indexed payer, uint256 amount);

    error TournamentNotFound(uint256 tournamentId);
    error WrongStatus(uint256 tournamentId, Status actual, Status expected);
    error RegistrationClosed(uint256 tournamentId);
    error TournamentFull(uint256 tournamentId);
    error AlreadyRegistered(uint256 tournamentId, address player);
    error IncorrectEntryFee(uint96 expected, uint256 sent);
    error NotResultSubmitter(address caller);
    error TooEarlyToSettle(uint256 tournamentId);
    error ResultDeadlinePassed(uint256 tournamentId);
    error NotEnoughParticipants(uint32 actual, uint32 required);
    error WinnerCountMismatch(uint256 expected, uint256 actual);
    error WinnerNotRegistered(address winner);
    error DuplicateWinner(address winner);
    error CancelNotAllowed(uint256 tournamentId);
    error NothingToClaim(uint256 tournamentId, address account);
    error InvalidPayoutSplit(uint256 sumBps);
    error InvalidParams(string field);
    error TransferFailed(address to, uint256 amount);
    error ZeroAddress();

    /// @notice 创建赛事。任何人都可以当组织者。
    function createTournament(TournamentParams calldata params) external returns (uint256 tournamentId);

    /// @notice 报名并支付报名费。
    function register(uint256 tournamentId) external payable;

    /// @notice 向奖池追加赞助。报名期内任何人可调用，取消时可退。
    function sponsor(uint256 tournamentId) external payable;

    /// @notice 提交最终名次并锁定分账。仅 resultSubmitter。
    /// @param winners   按名次排列，长度须等于 payoutBps 长度
    /// @param resultHash 对局结果的哈希，与 MatchAttestation 上的存证对应
    function settle(uint256 tournamentId, address[] calldata winners, bytes32 resultHash) external;

    /// @notice 取消赛事并开放退款。三种情况允许：
    ///         1. 组织者在报名截止前主动取消；
    ///         2. 报名截止后人数不足 minParticipants（任何人可触发）；
    ///         3. 超过 resultDeadline 仍未结算（任何人可触发）—— 活性逃生舱。
    function cancel(uint256 tournamentId) external;

    /// @notice 领取奖金。赛事结算后由获奖者/组织者各自调用。
    function claimPrize(uint256 tournamentId) external;

    /// @notice 赛事取消后领回报名费 / 赞助款。
    function claimRefund(uint256 tournamentId) external;

    function getTournament(uint256 tournamentId) external view returns (Tournament memory);
    function getPayoutBps(uint256 tournamentId) external view returns (uint16[] memory);
    function isRegistered(uint256 tournamentId, address player) external view returns (bool);
    function prizeOf(uint256 tournamentId, address account) external view returns (uint256);
    function refundableOf(uint256 tournamentId, address account) external view returns (uint256);

    /// @notice 当前是否满足取消条件，供前端展示"可触发退款"。
    function canCancel(uint256 tournamentId, address caller) external view returns (bool);
}
