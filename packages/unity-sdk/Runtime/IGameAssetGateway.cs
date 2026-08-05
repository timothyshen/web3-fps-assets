using System.Threading;
using System.Threading.Tasks;

namespace Game.Web3
{
    /// <summary>
    /// Unity 与 Web3 资产层之间的唯一接缝。
    ///
    /// 客户端只依赖这个接口，永远不直接接触链、RPC、私钥或合约 ABI。原因不是嫌麻烦：
    /// Unity 客户端是完全不可信环境（IL2CPP 可逆向、内存可 dump），而 FPS 又是外挂
    /// 工具的重点目标。任何放进客户端的密钥都等于公开。
    ///
    /// 所有链交互都发生在游戏后端。Unity 侧只是一个 REST 客户端。
    ///
    /// 使用约定：
    ///   - <see cref="GetPlayerAssetsAsync"/> 在**大厅**调用，不在对局中调用。
    ///     进入对局后资产快照已由服务器冻结，对局中不应有任何资产查询。
    ///   - 所有方法都可能抛 <see cref="GameAssetException"/>。资产层故障绝不应阻断
    ///     核心游戏体验 —— 调用方应捕获并降级到默认皮肤，而不是拦住玩家进游戏。
    /// </summary>
    public interface IGameAssetGateway
    {
        /// <summary>
        /// 链与合约配置。启动时拉一次即可。
        /// **客户端不得硬编码 chainId 或合约地址**，换网络时只改后端配置。
        /// </summary>
        Task<ChainConfig> GetConfigAsync(CancellationToken ct = default);

        /// <summary>玩家当前拥有的皮肤 + 待领取的奖励。大厅进入时调用一次。</summary>
        Task<PlayerAssets> GetPlayerAssetsAsync(CancellationToken ct = default);

        /// <summary>
        /// 发起钱包绑定。返回的 <see cref="WalletBindSession.BindUrl"/> 应当用
        /// <c>Application.OpenURL</c> 在**系统浏览器**中打开，不要用内嵌 WebView ——
        /// 内嵌 WebView 里游戏进程能读到页面内容，是钓鱼和凭据窃取的温床，
        /// 而且部分钱包会直接拒绝在 WebView 中工作。
        /// </summary>
        Task<WalletBindSession> BeginWalletBindAsync(CancellationToken ct = default);

        /// <summary>轮询绑定结果。建议 2 秒一次，最多轮询 5 分钟。</summary>
        Task<WalletBindStatus> PollWalletBindAsync(string sessionId, CancellationToken ct = default);

        /// <summary>
        /// 请求领取一个待领奖励。
        ///
        /// 后端有两种实现方式，Unity 侧不需要知道是哪种：
        ///   - push：后端直接铸造，返回的 <see cref="ClaimTicket.RequiresPlayerAction"/>
        ///     为 false，玩家零操作，直接轮询到 Claimed。
        ///   - pull：返回一个需要玩家在浏览器里确认的 URL，
        ///     <see cref="ClaimTicket.RequiresPlayerAction"/> 为 true。
        /// </summary>
        Task<ClaimTicket> RequestClaimAsync(string rewardId, CancellationToken ct = default);

        /// <summary>轮询领取进度，直到 Claimed 或 Failed。</summary>
        Task<RewardStatus> PollRewardAsync(string rewardId, CancellationToken ct = default);

        /// <summary>
        /// 提交出场配置。后端会校验每个 tokenId 确实属于该玩家。
        /// 客户端上报的皮肤信息服务器一律不采信 —— 这里只是"意图"，不是"事实"。
        /// </summary>
        Task SetLoadoutAsync(LoadoutRequest request, CancellationToken ct = default);
    }
}
