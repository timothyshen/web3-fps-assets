using System;
using System.Text;
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
    /// 玩家账号的一个属性，账号才是身份。
    /// </summary>
    public sealed class HttpGameAssetGateway : IGameAssetGateway
    {
        private readonly string _baseUrl;
        private readonly Func<string> _accessTokenProvider;
        private readonly int _timeoutSeconds;

        /// <param name="baseUrl">形如 https://api.example.com（不带尾斜杠）</param>
        /// <param name="accessTokenProvider">返回当前游戏会话 token；token 会刷新，所以传委托而不是字符串</param>
        public HttpGameAssetGateway(string baseUrl, Func<string> accessTokenProvider, int timeoutSeconds = 10)
        {
            _baseUrl = baseUrl?.TrimEnd('/') ?? throw new ArgumentNullException(nameof(baseUrl));
            _accessTokenProvider = accessTokenProvider ?? throw new ArgumentNullException(nameof(accessTokenProvider));
            _timeoutSeconds = timeoutSeconds;
        }

        public Task<PlayerAssets> GetPlayerAssetsAsync(CancellationToken ct = default)
            => SendAsync<PlayerAssets>(UnityWebRequest.kHttpVerbGET, "/v1/assets", null, ct);

        public Task<WalletBindSession> BeginWalletBindAsync(CancellationToken ct = default)
            => SendAsync<WalletBindSession>(UnityWebRequest.kHttpVerbPOST, "/v1/wallet/bind", null, ct);

        public Task<WalletBindStatus> PollWalletBindAsync(string sessionId, CancellationToken ct = default)
        {
            if (string.IsNullOrEmpty(sessionId)) throw new ArgumentException("sessionId is required", nameof(sessionId));
            return SendAsync<WalletBindStatus>(
                UnityWebRequest.kHttpVerbGET,
                $"/v1/wallet/bind/{UnityWebRequest.EscapeURL(sessionId)}",
                null,
                ct);
        }

        public Task<ClaimTicket> RequestClaimAsync(string rewardId, CancellationToken ct = default)
        {
            if (string.IsNullOrEmpty(rewardId)) throw new ArgumentException("rewardId is required", nameof(rewardId));
            return SendAsync<ClaimTicket>(
                UnityWebRequest.kHttpVerbPOST,
                $"/v1/rewards/{UnityWebRequest.EscapeURL(rewardId)}/claim",
                null,
                ct);
        }

        public Task<RewardStatus> PollRewardAsync(string rewardId, CancellationToken ct = default)
        {
            if (string.IsNullOrEmpty(rewardId)) throw new ArgumentException("rewardId is required", nameof(rewardId));
            return SendAsync<RewardStatus>(
                UnityWebRequest.kHttpVerbGET,
                $"/v1/rewards/{UnityWebRequest.EscapeURL(rewardId)}",
                null,
                ct);
        }

        public async Task SetLoadoutAsync(LoadoutRequest request, CancellationToken ct = default)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            await SendAsync<EmptyResponse>(
                UnityWebRequest.kHttpVerbPUT, "/v1/loadout", JsonUtility.ToJson(request), ct);
        }

        // ----------------------------------------------------------------

        [Serializable]
        private class EmptyResponse { }

        [Serializable]
        private class ErrorResponse
        {
            public string code;
            public string message;
        }

        private async Task<T> SendAsync<T>(string verb, string path, string jsonBody, CancellationToken ct)
            where T : class
        {
            using var request = new UnityWebRequest(_baseUrl + path, verb)
            {
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = _timeoutSeconds,
            };

            if (jsonBody != null)
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(jsonBody));
                request.SetRequestHeader("Content-Type", "application/json");
            }

            request.SetRequestHeader("Accept", "application/json");

            var token = _accessTokenProvider();
            if (!string.IsNullOrEmpty(token))
            {
                request.SetRequestHeader("Authorization", "Bearer " + token);
            }

            try
            {
                await request.SendWebRequest().AwaitAsync(ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new GameAssetException($"{verb} {path} failed: {ex.Message}");
            }

            if (request.result != UnityWebRequest.Result.Success)
            {
                throw BuildException(verb, path, request);
            }

            var body = request.downloadHandler.text;
            if (typeof(T) == typeof(EmptyResponse) || string.IsNullOrWhiteSpace(body))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<T>(body);
            }
            catch (Exception ex)
            {
                throw new GameAssetException(
                    $"{verb} {path} returned unparseable body: {ex.Message}", (int)request.responseCode);
            }
        }

        private static GameAssetException BuildException(string verb, string path, UnityWebRequest request)
        {
            var status = (int)request.responseCode;
            var raw = request.downloadHandler?.text;

            if (!string.IsNullOrWhiteSpace(raw))
            {
                try
                {
                    var parsed = JsonUtility.FromJson<ErrorResponse>(raw);
                    if (parsed != null && !string.IsNullOrEmpty(parsed.code))
                    {
                        return new GameAssetException(
                            $"{verb} {path}: {parsed.message ?? parsed.code}", status, parsed.code);
                    }
                }
                catch
                {
                    // 错误体不是预期结构，落到下面的通用分支
                }
            }

            return new GameAssetException($"{verb} {path} failed with HTTP {status}: {request.error}", status);
        }
    }
}
