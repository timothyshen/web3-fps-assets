using System;
using System.Threading;
using System.Threading.Tasks;

namespace Game.Web3
{
    /// <summary>
    /// 赛事与对局存证的 REST 实现。契约见 api/openapi.yaml。
    /// </summary>
    public sealed class HttpTournamentGateway : ITournamentGateway
    {
        private readonly HttpApiClient _http;

        public HttpTournamentGateway(string baseUrl, Func<string> accessTokenProvider, int timeoutSeconds = 10)
        {
            _http = new HttpApiClient(baseUrl, accessTokenProvider, timeoutSeconds);
        }

        /// <summary>与资产网关共用同一个客户端。</summary>
        public HttpTournamentGateway(HttpApiClient http)
        {
            _http = http ?? throw new ArgumentNullException(nameof(http));
        }

        /// <remarks>
        /// JsonUtility 无法反序列化根级数组，所以后端返回的是 {items, nextCursor} 对象。
        /// </remarks>
        [Serializable]
        private class TournamentListResponse
        {
            public TournamentSummary[] items = Array.Empty<TournamentSummary>();
            public string nextCursor;
        }

        public async Task<TournamentSummary[]> ListTournamentsAsync(
            string status = null, CancellationToken ct = default)
        {
            var path = "/v1/tournaments";
            if (!string.IsNullOrEmpty(status))
            {
                path += "?status=" + HttpApiClient.Escape(status);
            }

            var response = await _http.GetAsync<TournamentListResponse>(path, ct);
            return response?.items ?? Array.Empty<TournamentSummary>();
        }

        public Task<TournamentDetail> GetTournamentAsync(
            string tournamentId, CancellationToken ct = default)
        {
            Require(tournamentId, nameof(tournamentId));
            return _http.GetAsync<TournamentDetail>(
                $"/v1/tournaments/{HttpApiClient.Escape(tournamentId)}", ct);
        }

        public Task<TournamentIntent> CreateIntentAsync(
            string tournamentId, string action, CancellationToken ct = default)
        {
            Require(tournamentId, nameof(tournamentId));
            Require(action, nameof(action));

            return _http.PostAsync<TournamentIntent>(
                $"/v1/tournaments/{HttpApiClient.Escape(tournamentId)}/intents/{HttpApiClient.Escape(action)}",
                null,
                ct);
        }

        public Task<MatchRecord> GetMatchAsync(string matchId, CancellationToken ct = default)
        {
            Require(matchId, nameof(matchId));
            return _http.GetAsync<MatchRecord>($"/v1/matches/{HttpApiClient.Escape(matchId)}", ct);
        }

        private static void Require(string value, string name)
        {
            if (string.IsNullOrEmpty(value)) throw new ArgumentException($"{name} is required", name);
        }
    }
}
