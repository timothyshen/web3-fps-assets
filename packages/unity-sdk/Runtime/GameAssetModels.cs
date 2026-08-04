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
        /// 链上 tokenId。**是 string 不是数值类型** —— uint256 放不进 C# 的 ulong，
        /// 用数值类型迟早溢出。所有链上大整数在 C# 侧一律走字符串。
        /// </summary>
        public string tokenId;

        /// <summary>款式 ID。决定加载哪个 AssetBundle。</summary>
        public uint skinDefId;

        /// <summary>该款式内的序号，从 1 开始。#1/500 有真实溢价，UI 应当展示。</summary>
        public uint serial;

        /// <summary>该款式的发行上限，用于展示 "#37 / 500"。</summary>
        public uint maxSupply;

        /// <summary>磨损 0..1。后端已从链上的万分比整数换算过。</summary>
        public float wear;

        /// <summary>稀有度 0..4。</summary>
        public int rarity;

        /// <summary>首发赛季。</summary>
        public uint seasonId;

        /// <summary>AssetBundle 下载地址。</summary>
        public string bundleUri;

        /// <summary>
        /// AssetBundle 的 keccak256 承诺（0x 前缀十六进制）。
        /// 客户端下载后必须本地校验，防止 CDN 被投毒或运营方事后偷改外观。
        /// 注意 keccak256 与 SHA3-256 的 padding 不同，不能混用标准库的 SHA3。
        /// </summary>
        public string contentHash;

        /// <summary>
        /// "confirmed" 或 "pending"。pending 表示链上交易尚未达到确认数，
        /// 不可用于 loadout，UI 应当明确标记为"确认中"。
        /// </summary>
        public string state;

        public bool IsConfirmed => state == "confirmed";
    }

    [Serializable]
    public class PendingReward
    {
        public string rewardId;
        public uint skinDefId;
        public int rarity;

        /// <summary>ISO-8601 过期时间。过期后奖励作废。</summary>
        public string expiresAt;
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
        /// UI 可以提示"资产同步中"，但**不应**因此阻止玩家进入游戏。
        /// </summary>
        public int stalenessSeconds;

        public bool HasWallet => !string.IsNullOrEmpty(wallet);
    }

    [Serializable]
    public class WalletBindSession
    {
        public string sessionId;

        /// <summary>用 Application.OpenURL 在系统浏览器中打开。</summary>
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

        /// <summary>
        /// true 表示需要玩家在浏览器里确认交易（pull 模式）；
        /// false 表示后端会直接铸造（push 模式），玩家只需等待。
        /// </summary>
        public bool requiresPlayerAction;

        /// <summary>requiresPlayerAction 为 true 时才有值。</summary>
        public string actionUrl;
    }

    [Serializable]
    public class RewardStatus
    {
        /// <summary>"claimable" | "claiming" | "claimed" | "failed" | "expired"</summary>
        public string state;

        /// <summary>state 为 claimed 时有值。</summary>
        public string tokenId;

        public string error;

        public bool IsTerminal => state == "claimed" || state == "failed" || state == "expired";
    }

    [Serializable]
    public class LoadoutRequest
    {
        /// <summary>按武器槽位排列的 tokenId。空字符串表示该槽位用默认皮肤。</summary>
        public string[] tokenIdsBySlot = Array.Empty<string>();
    }

    /// <summary>
    /// 资产层的所有失败都收敛到这一个异常类型。
    /// 调用方应当捕获它并降级，而不是让它冒泡到玩家面前。
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
