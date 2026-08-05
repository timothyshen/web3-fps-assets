using System;

namespace Game.Web3
{
    /// <summary>赛事状态，与合约一致。Settled 与 Cancelled 为终态（PRD TRN-004）。</summary>
    public static class TournamentStatus
    {
        public const string Open = "open";
        public const string Settled = "settled";
        public const string Cancelled = "cancelled";

        public static bool IsTerminal(string status) => status == Settled || status == Cancelled;
    }

    /// <summary>赛事取消原因，三种必须分别展示（PRD TRN-005）。</summary>
    public static class CancelReason
    {
        /// <summary>组织者在报名截止前主动取消。</summary>
        public const string OrganizerCancelled = "organizer_cancelled";

        /// <summary>报名截止后人数不足最低要求。</summary>
        public const string NotEnoughParticipants = "not_enough_participants";

        /// <summary>结果提交超时，任何人都可触发的退款逃生舱。</summary>
        public const string ResultDeadlinePassed = "result_deadline_passed";
    }

    [Serializable]
    public class TournamentSummary
    {
        public string tournamentId;
        public string title;

        /// <summary>见 <see cref="TournamentStatus"/>。</summary>
        public string status;

        public Amount entryFee;
        public Amount prizePool;
        public int participantCount;
        public int minParticipants;
        public int maxParticipants;
        public string registrationDeadline;

        /// <summary>当前玩家是否已报名。</summary>
        public bool isRegistered;

        public bool IsOpen => status == TournamentStatus.Open;
        public bool IsFull => participantCount >= maxParticipants;
    }

    [Serializable]
    public class TournamentWinner
    {
        public int rank;
        public string wallet;
        public string playerId;
        public Amount amount;
    }

    [Serializable]
    public class TournamentDetail
    {
        public string tournamentId;
        public string title;
        public string status;
        public Amount entryFee;
        public Amount prizePool;
        public int participantCount;
        public int minParticipants;
        public int maxParticipants;
        public string registrationDeadline;
        public bool isRegistered;

        /// <summary>组织者地址。UI 必须展示（PRD TRN-002）。</summary>
        public string organizer;

        /// <summary>
        /// 唯一有权提交名次的地址。**报名前必须展示** —— 托管合约挡得住
        /// "组织者卷款跑路"，挡不住"提交方说谎"，所以玩家需要事前知道自己在信任谁。
        /// 报名后此地址不可更换。
        /// </summary>
        public string resultSubmitter;

        /// <summary>组织者抽成基点，合约硬上限 1000（10%）。</summary>
        public int organizerFeeBps;

        /// <summary>按名次的分配比例，索引 0 是冠军，总和 10000。</summary>
        public int[] payoutBps = Array.Empty<int>();

        /// <summary>超过此时间未结算，任何人可触发取消并全额退款。</summary>
        public string resultDeadline;

        /// <summary>status 为 cancelled 时有值，见 <see cref="CancelReason"/>。</summary>
        public string cancelReason;

        /// <summary>status 为 settled 时有值，引用同一赛事的最终对局结果包。</summary>
        public string resultHash;

        /// <summary>顺序与 payoutBps 名次一一对应（PRD TRN-006）。</summary>
        public TournamentWinner[] winners = Array.Empty<TournamentWinner>();

        /// <summary>当前玩家可领取的奖金。</summary>
        public Amount myClaimable;

        /// <summary>当前玩家可退回的报名费/赞助款。</summary>
        public Amount myRefundable;

        public bool IsCancelled => status == TournamentStatus.Cancelled;
        public bool IsSettled => status == TournamentStatus.Settled;
    }

    /// <summary>赛事链上操作的类型。</summary>
    public static class TournamentAction
    {
        public const string Register = "register";
        public const string Sponsor = "sponsor";
        public const string ClaimPrize = "claim-prize";
        public const string ClaimRefund = "claim-refund";
    }

    /// <summary>
    /// 链上操作的跳转意图。报名支付、赞助、领奖、退款都是链上交易，
    /// Unity 不签名，只拿 actionUrl 跳系统浏览器（PRD TRN-003）。
    /// </summary>
    [Serializable]
    public class TournamentIntent
    {
        public string tournamentId;
        public string action;
        public string actionUrl;
        public string expiresAt;
    }

    /// <summary>对局存证状态（PRD MAT-007）。</summary>
    public static class AttestationState
    {
        public const string Pending = "pending";
        public const string Attested = "attested";
        public const string Failed = "failed";
    }

    [Serializable]
    public class MatchAttestationInfo
    {
        /// <summary>见 <see cref="AttestationState"/>。</summary>
        public string state;

        public string txHash;
        public string explorerUrl;
        public string attestedAt;

        public bool IsVerified => state == AttestationState.Attested;
    }

    /// <summary>
    /// 赛后页需要的对局记录。
    /// </summary>
    /// <remarks>
    /// 存证失败**不遮挡战绩**（PRD MAT-006 / 失败降级矩阵）——
    /// 只影响"已验证"标识，赛后页、排行、下一局都不受影响。
    /// </remarks>
    [Serializable]
    public class MatchRecord
    {
        public string matchId;

        /// <summary>结果包的 keccak256（0x 前缀）。</summary>
        public string resultHash;

        /// <summary>
        /// 已按 RFC 8785 规范化的结果包字节。
        /// 要自行核验时**直接对这个字符串的 UTF-8 字节算 keccak256**，
        /// 不要先反序列化再自己序列化 —— 那样几乎必然对不上。
        /// </summary>
        public string canonicalJson;

        public MatchAttestationInfo attestation;
    }
}
