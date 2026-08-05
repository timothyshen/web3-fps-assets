using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Game.Web3
{
    /// <summary>
    /// 走游戏后端 REST 的真实实现。接口契约见 api/openapi.yaml。
    ///
    /// 认证用游戏自己的会话 token（与登录态一致），不是钱包签名 —— 钱包只是
    /// 玩家账号的一个属性，playerId 才是身份（PRD ACC-001）。
    /// </summary>
    public sealed class HttpGameAssetGateway : IGameAssetGateway
    {
        private readonly HttpApiClient _http;

        /// <param name="baseUrl">形如 https://api.example.com（不带尾斜杠）</param>
        /// <param name="accessTokenProvider">返回当前游戏会话 token</param>
        public HttpGameAssetGateway(string baseUrl, Func<string> accessTokenProvider, int timeoutSeconds = 10)
        {
            _http = new HttpApiClient(baseUrl, accessTokenProvider, timeoutSeconds);
        }

        /// <summary>允许外部复用同一个客户端（例如与 HttpTournamentGateway 共享配置）。</summary>
        public HttpGameAssetGateway(HttpApiClient http)
        {
            _http = http ?? throw new ArgumentNullException(nameof(http));
        }

        public Task<ChainConfig> GetConfigAsync(CancellationToken ct = default)
            => _http.GetAsync<ChainConfig>("/v1/config", ct);

        public Task<PlayerAssets> GetPlayerAssetsAsync(CancellationToken ct = default)
            => _http.GetAsync<PlayerAssets>("/v1/assets", ct);

        public Task<WalletBindSession> BeginWalletBindAsync(CancellationToken ct = default)
            => _http.PostAsync<WalletBindSession>("/v1/wallet/bind", null, ct);

        public Task<WalletBindStatus> PollWalletBindAsync(string sessionId, CancellationToken ct = default)
        {
            Require(sessionId, nameof(sessionId));
            return _http.GetAsync<WalletBindStatus>(
                $"/v1/wallet/bind/{HttpApiClient.Escape(sessionId)}", ct);
        }

        public Task<ClaimTicket> RequestClaimAsync(string rewardId, CancellationToken ct = default)
        {
            Require(rewardId, nameof(rewardId));
            return _http.PostAsync<ClaimTicket>(
                $"/v1/rewards/{HttpApiClient.Escape(rewardId)}/claim", null, ct);
        }

        public Task<RewardStatus> PollRewardAsync(string rewardId, CancellationToken ct = default)
        {
            Require(rewardId, nameof(rewardId));
            return _http.GetAsync<RewardStatus>(
                $"/v1/rewards/{HttpApiClient.Escape(rewardId)}", ct);
        }

        public Task SetLoadoutAsync(LoadoutRequest request, CancellationToken ct = default)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            return _http.SendNoContentAsync(
                UnityWebRequest.kHttpVerbPUT, "/v1/loadout", JsonUtility.ToJson(request), ct);
        }

        private static void Require(string value, string name)
        {
            if (string.IsNullOrEmpty(value)) throw new ArgumentException($"{name} is required", name);
        }
    }
}
