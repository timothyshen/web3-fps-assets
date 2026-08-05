using System.Threading;
using System.Threading.Tasks;

namespace Game.Web3
{
    /// <summary>
    /// 赛事与对局存证的读取接口，对应 PRD 第 6 节的 TournamentController 与
    /// MatchResultPresenter。
    ///
    /// 与 <see cref="IGameAssetGateway"/> 分开，是因为两者的生命周期不同：
    /// 资产网关在大厅高频使用，赛事只在赛事页用；拆开也避免任一接口无限膨胀。
    ///
    /// **Unity 不签名、不发交易。** 报名支付、赞助、领奖、退款全是链上交易，
    /// 这里只负责拿到 <see cref="TournamentIntent.actionUrl"/>，然后用
    /// <c>Application.OpenURL</c> 交给系统浏览器（PRD TRN-003）。
    ///
    /// 同样地，**客户端不自行计算最终奖金额**（PRD 第 6 节禁止项）——
    /// 金额一律取后端返回的 <see cref="Amount"/>，它同时带 wei 与格式化值。
    /// </summary>
    public interface ITournamentGateway
    {
        /// <summary>赛事列表。status 传 null 表示不过滤。</summary>
        Task<TournamentSummary[]> ListTournamentsAsync(
            string status = null, CancellationToken ct = default);

        /// <summary>
        /// 赛事详情。UI 必须展示 organizer、resultSubmitter、organizerFeeBps
        /// 与 payoutBps（PRD TRN-002）—— 这些是玩家报名前要审查的信任假设。
        /// </summary>
        Task<TournamentDetail> GetTournamentAsync(
            string tournamentId, CancellationToken ct = default);

        /// <summary>
        /// 生成链上操作的跳转意图。action 取 <see cref="TournamentAction"/> 常量。
        /// 后端只做可行性预检，真正的约束由合约强制。
        /// </summary>
        Task<TournamentIntent> CreateIntentAsync(
            string tournamentId, string action, CancellationToken ct = default);

        /// <summary>
        /// 赛后页用的对局记录与存证状态。
        /// 存证失败不应遮挡战绩展示（PRD MAT-006）。
        /// </summary>
        Task<MatchRecord> GetMatchAsync(string matchId, CancellationToken ct = default);
    }
}
