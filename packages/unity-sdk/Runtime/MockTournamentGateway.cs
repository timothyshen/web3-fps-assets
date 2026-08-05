using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Game.Web3
{
    /// <summary>
    /// 赛事与存证的内存假实现。
    ///
    /// 预置了四场赛事，正好覆盖 PRD 要求 UI 必须能分别展示的四种终局：
    ///   - 报名中
    ///   - 已结算（有名次和可领奖金）
    ///   - 人数不足取消
    ///   - 提交方超时取消（可退款）
    /// 三种取消原因必须分别展示（PRD TRN-005），所以 mock 里都给全。
    /// </summary>
    public sealed class MockTournamentGateway : ITournamentGateway
    {
        private readonly Dictionary<string, TournamentDetail> _tournaments = new();
        private readonly Dictionary<string, MatchRecord> _matches = new();

        public int LatencyMs { get; set; } = 250;

        /// <summary>设为非 null 时所有调用都抛异常，用来验证降级路径。</summary>
        public GameAssetException FailureToInject { get; set; }

        public MockTournamentGateway(bool seedDemoData = true)
        {
            if (!seedDemoData) return;

            Add(Open());
            Add(Settled());
            Add(CancelledNotEnough());
            Add(CancelledTimeout());

            _matches["m_demo_1"] = new MatchRecord
            {
                matchId = "m_demo_1",
                resultHash = "0x" + new string('a', 64),
                canonicalJson = "{\"matchId\":\"m_demo_1\",\"version\":\"1.0\"}",
                attestation = new MatchAttestationInfo
                {
                    state = AttestationState.Attested,
                    txHash = "0x" + new string('b', 64),
                    explorerUrl = "https://testnet.monadexplorer.com/tx/0x" + new string('b', 64),
                    attestedAt = DateTime.UtcNow.ToString("o"),
                },
            };

            // 存证失败的场次：赛后页仍必须完整展示战绩（PRD MAT-006）
            _matches["m_demo_failed"] = new MatchRecord
            {
                matchId = "m_demo_failed",
                resultHash = "0x" + new string('c', 64),
                canonicalJson = "{\"matchId\":\"m_demo_failed\",\"version\":\"1.0\"}",
                attestation = new MatchAttestationInfo {state = AttestationState.Failed},
            };
        }

        private void Add(TournamentDetail t) => _tournaments[t.tournamentId] = t;

        public async Task<TournamentSummary[]> ListTournamentsAsync(
            string status = null, CancellationToken ct = default)
        {
            await SimulateAsync(ct);

            return _tournaments.Values
                .Where(t => status == null || t.status == status)
                .Select(ToSummary)
                .ToArray();
        }

        public async Task<TournamentDetail> GetTournamentAsync(
            string tournamentId, CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            return _tournaments.TryGetValue(tournamentId, out var t)
                ? t
                : throw new GameAssetException($"unknown tournament {tournamentId}", 404, "tournament_not_found");
        }

        public async Task<TournamentIntent> CreateIntentAsync(
            string tournamentId, string action, CancellationToken ct = default)
        {
            await SimulateAsync(ct);

            if (!_tournaments.TryGetValue(tournamentId, out var t))
            {
                throw new GameAssetException($"unknown tournament {tournamentId}", 404, "tournament_not_found");
            }

            // 与真后端一样做可行性预检；最终约束仍在合约
            var allowed = action switch
            {
                TournamentAction.Register or TournamentAction.Sponsor => t.status == TournamentStatus.Open,
                TournamentAction.ClaimPrize => t.status == TournamentStatus.Settled,
                TournamentAction.ClaimRefund => t.status == TournamentStatus.Cancelled,
                _ => false,
            };

            if (!allowed)
            {
                throw new GameAssetException(
                    $"action {action} not allowed in status {t.status}", 409, "action_not_allowed");
            }

            return new TournamentIntent
            {
                tournamentId = tournamentId,
                action = action,
                actionUrl = $"https://example.invalid/tournaments/{tournamentId}/{action}",
                expiresAt = DateTime.UtcNow.AddMinutes(10).ToString("o"),
            };
        }

        public async Task<MatchRecord> GetMatchAsync(string matchId, CancellationToken ct = default)
        {
            await SimulateAsync(ct);
            return _matches.TryGetValue(matchId, out var m)
                ? m
                : throw new GameAssetException($"unknown match {matchId}", 404, "match_not_found");
        }

        // ----------------------------------------------------------------

        private async Task SimulateAsync(CancellationToken ct)
        {
            if (LatencyMs > 0) await Task.Delay(LatencyMs, ct);
            ct.ThrowIfCancellationRequested();
            if (FailureToInject != null) throw FailureToInject;
        }

        private static TournamentSummary ToSummary(TournamentDetail t) => new()
        {
            tournamentId = t.tournamentId,
            title = t.title,
            status = t.status,
            entryFee = t.entryFee,
            prizePool = t.prizePool,
            participantCount = t.participantCount,
            minParticipants = t.minParticipants,
            maxParticipants = t.maxParticipants,
            registrationDeadline = t.registrationDeadline,
            isRegistered = t.isRegistered,
        };

        private static Amount Mon(string wei, string formatted) =>
            new() {wei = wei, formatted = formatted, symbol = "MON"};

        private static TournamentDetail Base(string id, string title, string status) => new()
        {
            tournamentId = id,
            title = title,
            status = status,
            entryFee = Mon("1000000000000000000", "1.0"),
            prizePool = Mon("3000000000000000000", "3.0"),
            participantCount = 3,
            minParticipants = 3,
            maxParticipants = 8,
            registrationDeadline = DateTime.UtcNow.AddHours(6).ToString("o"),
            resultDeadline = DateTime.UtcNow.AddDays(1).ToString("o"),
            isRegistered = true,
            organizer = "0x2222222222222222222222222222222222222222",
            resultSubmitter = "0x3333333333333333333333333333333333333333",
            organizerFeeBps = 500,
            payoutBps = new[] {5000, 3000, 2000},
            myClaimable = Mon("0", "0.0"),
            myRefundable = Mon("0", "0.0"),
        };

        private static TournamentDetail Open()
        {
            var t = Base("t_open", "周末快速赛", TournamentStatus.Open);
            t.participantCount = 5;
            return t;
        }

        private static TournamentDetail Settled()
        {
            var t = Base("t_settled", "第 2 赛季资格赛", TournamentStatus.Settled);
            t.resultHash = "0x" + new string('a', 64);
            t.winners = new[]
            {
                new TournamentWinner
                {
                    rank = 1, wallet = "0x1111111111111111111111111111111111111111",
                    playerId = "p_mock_123", amount = Mon("1425000000000000000", "1.425"),
                },
                new TournamentWinner
                {
                    rank = 2, wallet = "0x4444444444444444444444444444444444444444",
                    playerId = "p_b", amount = Mon("855000000000000000", "0.855"),
                },
                new TournamentWinner
                {
                    rank = 3, wallet = "0x5555555555555555555555555555555555555555",
                    playerId = "p_c", amount = Mon("570000000000000000", "0.57"),
                },
            };
            t.myClaimable = Mon("1425000000000000000", "1.425");
            return t;
        }

        private static TournamentDetail CancelledNotEnough()
        {
            var t = Base("t_cancel_short", "深夜场（人数不足）", TournamentStatus.Cancelled);
            t.participantCount = 1;
            t.cancelReason = CancelReason.NotEnoughParticipants;
            t.myRefundable = Mon("1000000000000000000", "1.0");
            return t;
        }

        private static TournamentDetail CancelledTimeout()
        {
            var t = Base("t_cancel_timeout", "邀请赛（结果超时）", TournamentStatus.Cancelled);
            t.cancelReason = CancelReason.ResultDeadlinePassed;
            t.myRefundable = Mon("1000000000000000000", "1.0");
            return t;
        }
    }
}
