using System;

namespace Game.Web3
{
    /// <summary>
    /// 一件皮肤。字段与后端 JSON 一一对应，可直接用 Unity 的 JsonUtility 反序列化。
    /// </summary>
    [Serializable]
    public class SkinItem
    {
        /// <summary>
        /// 链上 tokenId。**是 string 不是数值类型**（PRD AST-002）——
        /// uint256 放不进 C# 的 ulong，用数值类型迟早溢出。
        /// C#、JSON、日志、存档里一律按十进制字符串处理。
        /// </summary>
        public string tokenId;

        /// <summary>款式 ID。决定加载哪个 AssetBundle。</summary>
        public uint skinDefId;

        /// <summary>展示名称，后端已按玩家语言本地化。</summary>
        public string name;

        /// <summary>该款式内的序号，从 1 开始。#37/500 有真实溢价，UI 应当展示。</summary>
        public uint serial;

        /// <summary>该款式的发行上限，用于展示 "#37 / 500"。</summary>
        public uint maxSupply;

        /// <summary>磨损 0..1。后端已从链上的万分比整数换算过。</summary>
        public float wear;

        /// <summary>稀有度 0..4。</summary>
        public int rarity;

        /// <summary>首发赛季。</summary>
        public uint seasonId;

        /// <summary>
        /// 缩略图/资源键，从本地资源目录或 CDN 取预览图。
        /// 不是完整 URL —— 避免客户端被投毒。
        /// </summary>
        public string previewKey;

        /// <summary>AssetBundle 下载地址。</summary>
        public string bundleUri;

        /// <summary>
        /// AssetBundle 的 keccak256 承诺（0x 前缀十六进制）。
        /// 客户端下载后必须本地校验；不一致时降级默认资源并告警（PRD NFR-008），
        /// 不崩溃、不拦截匹配。
        /// 注意 keccak256 与 SHA3-256 的 padding 不同，不能混用标准库的 SHA3。
        /// </summary>
        public string contentHash;

        /// <summary>
        /// "confirmed" 或 "pending"。pending 表示链上尚未达到最终确认策略，
        /// **不可用于正式 loadout**（PRD AST-004），UI 应标记为"链上确认中"。
        /// </summary>
        public string state;

        public bool IsConfirmed => state == "confirmed";
    }

    /// <summary>
    /// 奖励状态机（PRD RWD-004）。字符串常量而非 enum，
    /// 因为 Unity 的 JsonUtility 对 enum 反序列化不友好，且后端新增状态时不会炸。
    /// </summary>
    public static class RewardState
    {
        /// <summary>对局结算已产生，尚未进入风控判定。</summary>
        public const string Earned = "earned";

        /// <summary>反作弊/风控未放行，不可领取（PRD RWD-001）。</summary>
        public const string Held = "held";

        /// <summary>可领取。</summary>
        public const string Claimable = "claimable";

        /// <summary>后端处理中（签名 / 构造交易）。</summary>
        public const string Processing = "processing";

        /// <summary>交易已提交，等待链上最终确认。</summary>
        public const string PendingChain = "pending_chain";

        /// <summary>已确认，NFT 可装备。</summary>
        public const string Confirmed = "confirmed";

        /// <summary>失败，可重试。</summary>
        public const string Failed = "failed";

        /// <summary>是否处于"还在动"的中间态，UI 应继续轮询。</summary>
        public static bool IsInFlight(string state) =>
            state == Processing || state == PendingChain;

        /// <summary>是否已到终态，可以停止轮询。</summary>
        public static bool IsTerminal(string state) =>
            state == Confirmed || state == Failed;
    }

    [Serializable]
    public class PendingReward
    {
        public string rewardId;
        public uint skinDefId;
        public string name;
        public int rarity;

        /// <summary>见 <see cref="RewardState"/>。</summary>
        public string state;

        /// <summary>ISO-8601 过期时间。过期后奖励作废。</summary>
        public string expiresAt;

        public bool IsClaimable => state == RewardState.Claimable;

        /// <summary>被风控扣住，UI 应解释原因而不是显示"领取"按钮。</summary>
        public bool IsHeld => state == RewardState.Held;
    }

    /// <summary>大厅一次性拉取的全部资产状态。</summary>
    [Serializable]
    public class PlayerAssets
    {
        public string playerId;

        /// <summary>已绑定的钱包地址；未绑定时为空字符串。</summary>
        public string wallet;

        public SkinItem[] items = Array.Empty<SkinItem>();
        public PendingReward[] pendingRewards = Array.Empty<PendingReward>();

        /// <summary>
        /// 后端数据相对链上的滞后秒数。明显偏大时（比如 &gt; 60）说明索引落后，
        /// UI 可以提示"同步中"，但**不应**因此阻止玩家进入游戏（PRD NFR-002）。
        /// </summary>
        public int stalenessSeconds;

        public bool HasWallet => !string.IsNullOrEmpty(wallet);
    }

    [Serializable]
    public class WalletBindSession
    {
        public string sessionId;

        /// <summary>用 Application.OpenURL 在系统浏览器中打开（PRD ACC-003）。</summary>
        public string bindUrl;

        /// <summary>ISO-8601 过期时间。</summary>
        public string expiresAt;
    }

    [Serializable]
    public class WalletBindStatus
    {
        /// <summary>"pending" | "bound" | "expired" | "failed"</summary>
        public string state;

        public string wallet;
        public string error;

        public bool IsBound => state == "bound";
        public bool IsTerminal => state != "pending";
    }

    [Serializable]
    public class ClaimTicket
    {
        public string rewardId;

        /// <summary>见 <see cref="RewardState"/>。</summary>
        public string state;

        /// <summary>
        /// true 表示需要玩家在浏览器里确认交易（pull 模式）；
        /// false 表示后端会直接铸造（push 模式），玩家只需等待。MVP 默认 false。
        /// </summary>
        public bool requiresPlayerAction;

        /// <summary>requiresPlayerAction 为 true 时才有值。</summary>
        public string actionUrl;
    }

    [Serializable]
    public class RewardStatus
    {
        public string rewardId;

        /// <summary>见 <see cref="RewardState"/>。</summary>
        public string state;

        /// <summary>state 为 confirmed 时有值。</summary>
        public string tokenId;

        /// <summary>
        /// 交易哈希，进入 pending_chain 后有值。
        /// UI 可据此跳区块浏览器；也是排查问题的关键线索（PRD NFR-006）。
        /// </summary>
        public string txHash;

        public string error;

        public bool IsTerminal => RewardState.IsTerminal(state);

        /// <summary>只有 confirmed 才能装备（PRD RWD-006）。</summary>
        public bool CanEquip => state == RewardState.Confirmed;
    }

    [Serializable]
    public class LoadoutRequest
    {
        /// <summary>按武器槽位排列的 tokenId。空字符串表示该槽位用默认皮肤。</summary>
        public string[] tokenIdsBySlot = Array.Empty<string>();
    }

    /// <summary>
    /// 链与合约配置。**客户端不得硬编码 chainId 或合约地址**，一律从这里读。
    /// </summary>
    [Serializable]
    public class ChainConfig
    {
        public int chainId;
        public string chainName;

        /// <summary>
        /// true 时 UI 必须显式标注"测试网"，避免玩家把测试资产误认为真实货币
        /// （PRD TRN-008）。
        /// </summary>
        public bool isTestnet;

        public string nativeSymbol;
        public string explorerBaseUrl;
        public string marketplaceUrl;
    }

    /// <summary>
    /// 金额。**同时携带原始 wei 与格式化值**（PRD TRN-008）——
    /// 客户端不做单位换算，也不用 float 表示金额。
    /// </summary>
    [Serializable]
    public class Amount
    {
        /// <summary>十进制字符串。绝不能用 long/double —— 精度会丢。</summary>
        public string wei;

        public string formatted;
        public string symbol;

        public override string ToString() => $"{formatted} {symbol}";
    }

    /// <summary>
    /// 资产层的所有失败都收敛到这一个异常类型。
    /// 调用方应当捕获它并降级，而不是让它冒泡到玩家面前（PRD NFR-002）。
    /// </summary>
    public class GameAssetException : Exception
    {
        /// <summary>HTTP 状态码；网络层失败时为 0。</summary>
        public int StatusCode { get; }

        /// <summary>后端返回的机器可读错误码，如 "wallet_not_bound"。</summary>
        public string Code { get; }

        public GameAssetException(string message, int statusCode = 0, string code = null)
            : base(message)
        {
            StatusCode = statusCode;
            Code = code;
        }
    }
}
