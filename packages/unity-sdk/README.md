# unity-sdk

给 Unity 项目的抽象层。**这是 Web3 侧与游戏侧之间唯一需要对齐的东西。**

对应 `Unity3D Web3 FPS 游戏侧需求 v1.0` 的第 6、7 节。

## 交给 Unity 的东西

把 `Runtime/` 整个目录拷进 Unity 工程（例如 `Assets/Plugins/GameWeb3/`）。没有外部依赖，
不需要 UniTask、Nethereum 或任何 web3 库。

| 文件 | 作用 |
|------|------|
| `IGameAssetGateway.cs` | 资产、钱包、奖励 —— 大厅与衣柜依赖它 |
| `ITournamentGateway.cs` | 赛事与对局存证 —— 赛事页与赛后页依赖它 |
| `GameAssetModels.cs` | 资产/奖励 DTO + `RewardState` 状态常量 |
| `TournamentModels.cs` | 赛事/存证 DTO + 状态常量 |
| `MockGameAssetGateway.cs` | 全内存假实现，**Unity 从第一天就能用** |
| `MockTournamentGateway.cs` | 同上，预置四种赛事终局 |
| `HttpGameAssetGateway.cs` / `HttpTournamentGateway.cs` | 真实实现 |
| `HttpApiClient.cs` | 两个网关共用的 REST 客户端 |
| `UnityWebRequestAwaiter.cs` | 让 `UnityWebRequest` 支持 `await`，无外部依赖 |

## 为什么 Unity 不直接连链

不是嫌麻烦，是安全：

1. Unity 客户端是完全不可信环境 —— IL2CPP 可逆向，内存可 dump。任何放进客户端的
   私钥都等于公开。
2. FPS 是外挂工具的重点目标。客户端里一旦有钱包，作弊工具会顺手加上盗号功能。
3. 客户端直连 RPC 会把 RPC key 和调用逻辑暴露出去。

所以链路是 **Unity → 游戏后端 → 链**，Unity 侧只是个 REST 客户端。

## 接入

```csharp
// 启动时选一个实现，之后全项目只见接口
IGameAssetGateway assets = useMockBackend
    ? new MockGameAssetGateway()
    : new HttpGameAssetGateway(apiBaseUrl, () => session.AccessToken);

ITournamentGateway tournaments = useMockBackend
    ? new MockTournamentGateway()
    : new HttpTournamentGateway(apiBaseUrl, () => session.AccessToken);
```

真实环境下两个网关可以共用一个 `HttpApiClient`：

```csharp
var http = new HttpApiClient(apiBaseUrl, () => session.AccessToken);
IGameAssetGateway assets = new HttpGameAssetGateway(http);
ITournamentGateway tournaments = new HttpTournamentGateway(http);
```

### 启动时拉配置

**不要硬编码 chainId 或合约地址。**

```csharp
var config = await assets.GetConfigAsync(ct);
if (config.isTestnet)
{
    // 必须显式标注，避免玩家把测试网资产误认为真实货币
    ShowNetworkBadge($"{config.chainName} · 测试网");
}
```

### 大厅读库存

```csharp
async Task RefreshWardrobeAsync(CancellationToken ct)
{
    try
    {
        var player = await assets.GetPlayerAssetsAsync(ct);

        foreach (var item in player.items)
        {
            // 只有 confirmed 能进正式 loadout；pending 可展示为"链上确认中"
            wardrobe.Add(item, equippable: item.IsConfirmed);
        }

        if (player.stalenessSeconds > 60) ShowSyncingHint();
        if (!player.HasWallet) ShowBindWalletPrompt();
    }
    catch (GameAssetException ex)
    {
        // 关键：资产层故障绝不能拦住玩家进游戏
        Debug.LogWarning($"asset layer unavailable: {ex.Message}");
        wardrobe.FallBackToDefaultSkins();
    }
}
```

### 奖励状态机

七个状态，用 `RewardState` 常量而不是裸字符串：

```
earned → held → claimable → processing → pending_chain → confirmed
                                                       ↘ failed
```

```csharp
var ticket = await assets.RequestClaimAsync(rewardId, ct);

if (ticket.requiresPlayerAction)
{
    Application.OpenURL(ticket.actionUrl);   // pull 路径，玩家在浏览器确认
}

// 退避轮询直到终态
RewardStatus status;
do
{
    await Task.Delay(pollInterval, ct);
    status = await assets.PollRewardAsync(rewardId, ct);
    UpdateRewardCard(status);
} while (!status.IsTerminal);

if (status.CanEquip) await RefreshWardrobeAsync(ct);
```

两个容易做错的地方：

- **`held` 不是"可领取"** —— 它表示被反作弊/风控扣住了。UI 要解释原因，
  而不是显示一个点了会报错的领取按钮。
- **确认前不能标为可装备** —— 只有 `confirmed` 才行。`pending_chain` 意味着交易
  已提交但还没最终确认。

### 赛事

```csharp
var detail = await tournaments.GetTournamentAsync(id, ct);

// 报名前必须展示这些 —— 玩家要能事前审查自己在信任谁
ShowTrustInfo(
    organizer: detail.organizer,
    resultSubmitter: detail.resultSubmitter,   // 唯一能提交名次的地址
    organizerFeeBps: detail.organizerFeeBps,   // 合约硬上限 10%
    payoutBps: detail.payoutBps);

// 报名 = 链上交易，Unity 不签名
var intent = await tournaments.CreateIntentAsync(id, TournamentAction.Register, ct);
Application.OpenURL(intent.actionUrl);
```

赛事取消时**三种原因必须分别展示**（`CancelReason` 常量）——
"人数不足"和"提交方超时"对玩家意味着完全不同的事。

金额一律用后端返回的 `Amount`（同时带 wei 与格式化值），
**不要自己算最终奖金额**，也不要用 float 表示金额。

### 加载皮肤时校验哈希

```csharp
var bytes = await cdn.DownloadAsync(item.bundleUri, ct);

if (!Keccak256.Verify(bytes, item.contentHash))
{
    // 可能是 CDN 缓存不一致（运维常态），也可能是 CDN 被投毒（安全事件）。
    // 降级渲染 + 上报，不崩溃，也不拒绝进入游戏。
    telemetry.ReportAssetHashMismatch(item.skinDefId, item.contentHash);
    return fallback.GetDefaultSkin(item.skinDefId);
}
```

> `Keccak256` 需要 Unity 侧自己引一个实现。**注意 keccak256 与 SHA3-256 的
> padding 不同**，直接用标准库的 SHA3 会永远校验失败 —— 这是最常见的踩坑点。

## 给 Unity 侧的硬约束

破坏了会出安全问题或体验问题：

1. **对局中不调用任何 gateway 方法。** 只在大厅调。进入对局后资产快照已由游戏
   服务器冻结，中途卖掉 NFT 也不影响本局渲染。
2. **`tokenId` 一律当十进制字符串处理。** uint256 放不进 `ulong`，
   C#、JSON、日志、存档里都不要转成数值类型。
3. **绑定钱包用 `Application.OpenURL` 开系统浏览器**，不要用内嵌 WebView。
   内嵌 WebView 里游戏进程能读到页面内容，是钓鱼与凭据窃取的温床，且部分钱包
   会直接拒绝在 WebView 里工作。
4. **其他玩家的皮肤由游戏服务器下发**，不要相信其他客户端自报的 tokenId ——
   否则任何人都能改内存穿上传说皮肤。
5. **所有 gateway 调用都要有 catch 和降级路径。**
6. **所有异步调用传 `CancellationToken`**，场景销毁时取消。

## 后端契约

REST 契约在 [`../../api/openapi.yaml`](../../api/openapi.yaml)。
接口若要变更，先改 openapi.yaml 和这里的接口，再改两边实现。

对局结果哈希的跨语言参考向量在 [`../../fixtures/`](../../fixtures/README.md) ——
C# 侧若要自行核验 `resultHash`，必须先过那组向量。

## 并行开发

两个 Mock 都模拟了完整的状态流转（延迟、绑定等待、领奖七态、赛事四种终局、
失败注入）。Unity 侧不需要等合约部署、后端上线、测试网出块。

```csharp
var mock = new MockGameAssetGateway
{
    LatencyMs = 400,          // 模拟慢网络
    BindPollsRequired = 5,    // 验证绑定等待态
    RewardStepMs = 800,       // 验证领奖各中间态的 UI
};

// 验证降级路径
mock.FailureToInject = new GameAssetException("backend down", 503);
```

验收标准（PRD AC-14）：**从 Mock 切到 Http 只改实现与配置，上层 UI 和控制器一行不动。**
