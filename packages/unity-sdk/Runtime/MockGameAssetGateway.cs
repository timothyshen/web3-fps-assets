using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Game.Web3
{
    /// <summary>
    /// 全内存的假实现，行为与真后端一致（含延迟、状态流转、失败注入）。
    ///
    /// 存在的意义：Unity 那边不需要等合约部署、后端上线、测试网出块，就能把
    /// 衣柜、绑定钱包、领奖动画全部做完。两边只对齐 IGameAssetGateway 这一个接口。
    ///
    /// 在 Unity 里切换实现：
    ///   IGameAssetGateway gateway = useMock
    ///       ? new MockGameAssetGateway()
    ///       : new HttpGameAssetGateway(apiBaseUrl, () => session.AccessToken);
    /// </summary>
    public sealed class MockGameAssetGateway : IGameAssetGateway
    {
        private readonly List<SkinItem> _items = new();
        private readonly List<PendingReward> _pending = new();
        private readonly Dictionary<string, RewardStatus> _rewardStates = new();

        private string _wallet = string.Empty;
        private string _bindSessionId;
        private int _bindPollCount;
        private uint _nextSerial = 38;

        /// <summary>模拟网络延迟，毫秒。设为 0 可让测试跑得快些。</summary>
        public int LatencyMs { get; set; } = 250;

        /// <summary>绑定钱包需要轮询几次才成功，用来验证 UI 的等待态。</summary>
        public int BindPollsRequired { get; set; } = 3;

        /// <summary>设为非 null 时，所有调用都抛这个异常，用来验证降级路径。</summary>
        public GameAssetException FailureToInject { get; set; }

        public MockGameAssetGateway(bool seedDemoData = true)
        {
            if (!seedDemoData) return;

            _items.Add(MakeItem(1042, 37, 500, 0.0731f, 4, "Frostbite AK-47"));
            _items.Add(MakeItem(1010, 214, 2500, 0.4120f, 1, "Desert Tan M4"));

            _pending.Add(new PendingReward
            {
                rewardId = "rw_demo_1",
                skinDefId = 1077,
                rarity = 4,
                expiresAt = DateTime.UtcNow.AddDays(7).ToString("o"),
            });
            _rewardStates["rw_demo_1"] = new RewardStatus {state = "claimable"};
        }

        // ----------------------------------------------------------------

        public async Task<PlayerAssets> GetPlayerAssetsAsync(CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            return new PlayerAssets
            {
                playerId = "p_mock_123",
                wallet = _wallet,
                items = _items.ToArray(),
                pendingRewards = _pending.ToArray(),
                stalenessSeconds = 2,
            };
        }

        public async Task<WalletBindSession> BeginWalletBindAsync(CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            _bindSessionId = "bind_" + Guid.NewGuid().ToString("N")[..8];
            _bindPollCount = 0;

            return new WalletBindSession
            {
                sessionId = _bindSessionId,
                bindUrl = "https://example.invalid/bind/" + _bindSessionId,
                expiresAt = DateTime.UtcNow.AddMinutes(5).ToString("o"),
            };
        }

        public async Task<WalletBindStatus> PollWalletBindAsync(string sessionId, CancellationToken ct = default)
        {
            await SimulateAsync(ct);

            if (sessionId != _bindSessionId)
            {
                return new WalletBindStatus {state = "expired"};
            }

            if (++_bindPollCount < BindPollsRequired)
            {
                return new WalletBindStatus {state = "pending"};
            }

            _wallet = "0x1111111111111111111111111111111111111111";
            return new WalletBindStatus {state = "bound", wallet = _wallet};
        }

        public async Task<ClaimTicket> RequestClaimAsync(string rewardId, CancellationToken ct = default)
        {
            await SimulateAsync(ct);

            if (!_rewardStates.ContainsKey(rewardId))
            {
                throw new GameAssetException($"unknown reward {rewardId}", 404, "reward_not_found");
            }

            if (string.IsNullOrEmpty(_wallet))
            {
                throw new GameAssetException("wallet must be bound before claiming", 409, "wallet_not_bound");
            }

            // 模拟 push 模式：后端直接铸造，玩家零操作
            _rewardStates[rewardId] = new RewardStatus {state = "claiming"};
            _ = CompleteClaimAfterDelayAsync(rewardId);

            return new ClaimTicket {rewardId = rewardId, requiresPlayerAction = false};
        }

        public async Task<RewardStatus> PollRewardAsync(string rewardId, CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            return _rewardStates.TryGetValue(rewardId, out var status)
                ? status
                : throw new GameAssetException($"unknown reward {rewardId}", 404, "reward_not_found");
        }

        public async Task SetLoadoutAsync(LoadoutRequest request, CancellationToken ct = default)
        {
            await SimulateAsync(ct);

            var owned = _items.Select(i => i.tokenId).ToHashSet();
            foreach (var tokenId in request.tokenIdsBySlot.Where(t => !string.IsNullOrEmpty(t)))
            {
                if (!owned.Contains(tokenId))
                {
                    // 真后端也会这样拒绝 —— 客户端上报的皮肤一律不可信
                    throw new GameAssetException($"player does not own {tokenId}", 403, "not_owned");
                }
            }
        }

        // ----------------------------------------------------------------

        private async Task CompleteClaimAfterDelayAsync(string rewardId)
        {
            await Task.Delay(Math.Max(LatencyMs * 4, 400));

            var reward = _pending.FirstOrDefault(p => p.rewardId == rewardId);
            if (reward == null) return;

            var item = MakeItem(reward.skinDefId, _nextSerial++, 100, 0.012f, reward.rarity, "Claimed Skin");
            _items.Add(item);
            _pending.Remove(reward);
            _rewardStates[rewardId] = new RewardStatus {state = "claimed", tokenId = item.tokenId};
        }

        private async Task SimulateAsync(CancellationToken ct)
        {
            if (LatencyMs > 0) await Task.Delay(LatencyMs, ct);
            ct.ThrowIfCancellationRequested();
            if (FailureToInject != null) throw FailureToInject;
        }

        private static SkinItem MakeItem(
            uint skinDefId, uint serial, uint maxSupply, float wear, int rarity, string label)
        {
            // 与链上一致：tokenId = (skinDefId << 32) | serial
            var tokenId = ((ulong)skinDefId << 32) | serial;

            return new SkinItem
            {
                tokenId = tokenId.ToString(),
                skinDefId = skinDefId,
                serial = serial,
                maxSupply = maxSupply,
                wear = wear,
                rarity = rarity,
                seasonId = 2,
                bundleUri = $"https://cdn.example.invalid/skin/{skinDefId}/v1.bundle",
                contentHash = "0x" + label.GetHashCode().ToString("x8").PadLeft(64, '0'),
                state = "confirmed",
            };
        }
    }
}
