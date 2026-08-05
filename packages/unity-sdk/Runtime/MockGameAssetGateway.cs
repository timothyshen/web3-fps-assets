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
    /// 领奖会真实走一遍 claimable → processing → pending_chain → confirmed，
    /// 这样 UI 的状态机不会在联调时才第一次被验证（PRD AC-07）。
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

        /// <summary>领奖每个中间态停留多久，用来验证 UI 的进度展示。</summary>
        public int RewardStepMs { get; set; } = 600;

        /// <summary>设为非 null 时，所有调用都抛这个异常，用来验证降级路径。</summary>
        public GameAssetException FailureToInject { get; set; }

        public MockGameAssetGateway(bool seedDemoData = true)
        {
            if (!seedDemoData) return;

            _items.Add(MakeItem(1042, 37, 500, 0.0731f, 4, "霜蚀 AK-47"));
            _items.Add(MakeItem(1010, 214, 2500, 0.4120f, 1, "沙漠迷彩 M4"));

            // 一个可领取的
            AddPendingReward("rw_demo_1", 1077, 4, "耀斑 AWP", RewardState.Claimable);

            // 一个被风控扣住的 —— UI 必须能正确解释这种状态而不是显示领取按钮
            AddPendingReward("rw_demo_held", 1025, 2, "都市迷彩 AWP", RewardState.Held);
        }

        private void AddPendingReward(string rewardId, uint skinDefId, int rarity, string name, string state)
        {
            _pending.Add(new PendingReward
            {
                rewardId = rewardId,
                skinDefId = skinDefId,
                name = name,
                rarity = rarity,
                state = state,
                expiresAt = DateTime.UtcNow.AddDays(7).ToString("o"),
            });
            _rewardStates[rewardId] = new RewardStatus {rewardId = rewardId, state = state};
        }

        // ----------------------------------------------------------------

        public async Task<ChainConfig> GetConfigAsync(CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            return new ChainConfig
            {
                chainId = 10143,
                chainName = "Monad Testnet",
                isTestnet = true,
                nativeSymbol = "MON",
                explorerBaseUrl = "https://testnet.monadexplorer.com",
                marketplaceUrl = "https://example.invalid/market",
            };
        }

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

            if (!_rewardStates.TryGetValue(rewardId, out var status))
            {
                throw new GameAssetException($"unknown reward {rewardId}", 404, "reward_not_found");
            }

            if (string.IsNullOrEmpty(_wallet))
            {
                throw new GameAssetException("wallet must be bound before claiming", 409, "wallet_not_bound");
            }

            if (status.state == RewardState.Held)
            {
                throw new GameAssetException(
                    "reward is held by anti-cheat review", 409, "reward_held");
            }

            // 幂等：已在处理中或已完成时，直接回当前状态，不重复启动流程
            if (status.state != RewardState.Claimable)
            {
                return new ClaimTicket
                {
                    rewardId = rewardId, state = status.state, requiresPlayerAction = false,
                };
            }

            status.state = RewardState.Processing;
            _ = AdvanceClaimAsync(rewardId);

            // MVP 默认 push 路径：后端直铸，玩家零操作
            return new ClaimTicket
            {
                rewardId = rewardId, state = RewardState.Processing, requiresPlayerAction = false,
            };
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

            var equippable = _items
                .Where(i => i.IsConfirmed)
                .Select(i => i.tokenId)
                .ToHashSet();

            foreach (var tokenId in request.tokenIdsBySlot.Where(t => !string.IsNullOrEmpty(t)))
            {
                if (!equippable.Contains(tokenId))
                {
                    // 真后端也会这样拒绝 —— 客户端上报的皮肤一律不可信（PRD NFR-004）
                    throw new GameAssetException(
                        $"player does not own or cannot equip {tokenId}", 403, "not_owned");
                }
            }
        }

        // ----------------------------------------------------------------

        /// <summary>processing → pending_chain → confirmed，逐步推进。</summary>
        private async Task AdvanceClaimAsync(string rewardId)
        {
            var status = _rewardStates[rewardId];

            await Task.Delay(RewardStepMs);
            status.state = RewardState.PendingChain;
            status.txHash = "0x" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");

            var reward = _pending.FirstOrDefault(p => p.rewardId == rewardId);
            if (reward != null) reward.state = RewardState.PendingChain;

            await Task.Delay(RewardStepMs);

            if (reward != null)
            {
                var item = MakeItem(
                    reward.skinDefId, _nextSerial++, 100, 0.012f, reward.rarity, reward.name);
                _items.Add(item);
                _pending.Remove(reward);
                status.tokenId = item.tokenId;
            }

            status.state = RewardState.Confirmed;
        }

        private async Task SimulateAsync(CancellationToken ct)
        {
            if (LatencyMs > 0) await Task.Delay(LatencyMs, ct);
            ct.ThrowIfCancellationRequested();
            if (FailureToInject != null) throw FailureToInject;
        }

        private static SkinItem MakeItem(
            uint skinDefId, uint serial, uint maxSupply, float wear, int rarity, string name)
        {
            // 与链上一致：tokenId = (skinDefId << 32) | serial
            var tokenId = ((ulong)skinDefId << 32) | serial;

            return new SkinItem
            {
                tokenId = tokenId.ToString(),
                skinDefId = skinDefId,
                name = name,
                serial = serial,
                maxSupply = maxSupply,
                wear = wear,
                rarity = rarity,
                seasonId = 2,
                previewKey = $"skin_{skinDefId}_preview",
                bundleUri = $"https://cdn.example.invalid/skin/{skinDefId}/v1.bundle",
                contentHash = "0x" + skinDefId.ToString("x").PadLeft(64, '0'),
                state = "confirmed",
            };
        }
    }
}
