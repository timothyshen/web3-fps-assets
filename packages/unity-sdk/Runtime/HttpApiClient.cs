using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Game.Web3
{
    /// <summary>
    /// 游戏后端 REST 的最小客户端：统一超时、认证头、错误映射。
    /// 被 <see cref="HttpGameAssetGateway"/> 与 <see cref="HttpTournamentGateway"/> 共用。
    ///
    /// 所有失败都转成 <see cref="GameAssetException"/>，调用方只需捕获一种异常。
    /// </summary>
    public sealed class HttpApiClient
    {
        private readonly string _baseUrl;
        private readonly Func<string> _accessTokenProvider;
        private readonly int _timeoutSeconds;

        /// <param name="baseUrl">形如 https://api.example.com（不带尾斜杠）</param>
        /// <param name="accessTokenProvider">
        /// 返回当前游戏会话 token。token 会刷新，所以传委托而不是字符串。
        /// </param>
        public HttpApiClient(string baseUrl, Func<string> accessTokenProvider, int timeoutSeconds = 10)
        {
            _baseUrl = baseUrl?.TrimEnd('/') ?? throw new ArgumentNullException(nameof(baseUrl));
            _accessTokenProvider = accessTokenProvider ?? throw new ArgumentNullException(nameof(accessTokenProvider));
            _timeoutSeconds = timeoutSeconds;
        }

        public Task<T> GetAsync<T>(string path, CancellationToken ct) where T : class
            => SendAsync<T>(UnityWebRequest.kHttpVerbGET, path, null, ct);

        public Task<T> PostAsync<T>(string path, string jsonBody, CancellationToken ct) where T : class
            => SendAsync<T>(UnityWebRequest.kHttpVerbPOST, path, jsonBody, ct);

        public Task<T> PutAsync<T>(string path, string jsonBody, CancellationToken ct) where T : class
            => SendAsync<T>(UnityWebRequest.kHttpVerbPUT, path, jsonBody, ct);

        /// <summary>URL 路径段转义。</summary>
        public static string Escape(string segment) => UnityWebRequest.EscapeURL(segment);

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

        /// <summary>发起不关心响应体的请求（如 204）。</summary>
        public async Task SendNoContentAsync(string verb, string path, string jsonBody, CancellationToken ct)
        {
            await SendAsync<EmptyResponse>(verb, path, jsonBody, ct);
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
