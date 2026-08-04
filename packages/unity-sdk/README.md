# unity-sdk

给 Unity 项目的抽象层。**这是 Web3 侧与游戏侧之间唯一需要对齐的东西。**

## 交给 Unity 的东西

把 `Runtime/` 整个目录拷进 Unity 工程（例如 `Assets/Plugins/GameWeb3/`）。没有外部依赖，
不需要 UniTask、Nethereum 或任何 web3 库。

| 文件 | 作用 |
|------|------|
| `IGameAssetGateway.cs` | Unity 代码唯一应该依赖的接口 |
| `GameAssetModels.cs` | DTO（`[Serializable]`，可直接用 `JsonUtility`） |
| `MockGameAssetGateway.cs` | 全内存假实现，**Unity 从第一天就能用** |
| `HttpGameAssetGateway.cs` | 真实实现，调游戏后端 REST |
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
IGameAssetGateway gateway = useMockBackend
    ? new MockGameAssetGateway()
    : new HttpGameAssetGateway("https://api.example.com", () => session.AccessToken);
```

大厅里读库存：

```csharp
async Task RefreshWardrobeAsync(CancellationToken ct)
{
    try
    {
        var assets = await gateway.GetPlayerAssetsAsync(ct);

        foreach (var item in assets.items)
        {
            if (!item.IsConfirmed) continue;      // 确认中的资产不能上场
            wardrobe.Add(item);
        }

        if (!assets.HasWallet) ShowBindWalletPrompt();
    }
    catch (GameAssetException ex)
    {
        // 关键：资产层故障绝不能拦住玩家进游戏
        Debug.LogWarning($"asset layer unavailable: {ex.Message}");
        wardrobe.FallBackToDefaultSkins();
    }
}
```

加载皮肤时校验哈希：

```csharp
var bytes = await cdn.DownloadAsync(item.bundleUri, ct);

if (!Keccak256.Verify(bytes, item.contentHash))
{
    // 可能是 CDN 缓存不一致（运维常态），也可能是 CDN 被投毒（安全事件）。
    // 降级渲染 + 上报，不要崩溃，也不要拒绝进入游戏。
    telemetry.ReportAssetHashMismatch(item.skinDefId, item.contentHash);
    return fallback.GetDefaultSkin(item.skinDefId);
}
```

> `Keccak256` 需要 Unity 侧自己引一个实现。**注意 keccak256 与 SHA3-256 的
> padding 不同**，直接用标准库的 SHA3 会永远校验失败 —— 这是最常见的踩坑点。

## 给 Unity 侧的硬约束

这几条不是建议，破坏了会出安全问题或体验问题：

1. **对局中不调用任何 gateway 方法。** 只在大厅调。进入对局后资产快照已由游戏
   服务器冻结，中途卖掉 NFT 也不影响本局渲染。
2. **`tokenId` 一律当字符串处理。** uint256 放不进 `ulong`，用数值类型迟早溢出。
3. **绑定钱包用 `Application.OpenURL` 开系统浏览器**，不要用内嵌 WebView。
   内嵌 WebView 里游戏进程能读到页面内容，是钓鱼和凭据窃取的温床，而且部分钱包
   会直接拒绝在 WebView 里工作。
4. **其他玩家的皮肤由游戏服务器下发**，不要让客户端去查别人的库存，也不要相信
   其他客户端自报的皮肤 ID —— 否则任何人都能改内存穿上传说皮肤。
5. **所有 gateway 调用都要有 catch 和降级路径。** 见上面的例子。

## 后端契约

`HttpGameAssetGateway` 对应的 REST 契约在 [`../../api/openapi.yaml`](../../api/openapi.yaml)。
Web3 侧负责实现它。接口若要变更，先改 openapi.yaml 和这个接口，再改两边实现。

## 并行开发

Unity 侧不需要等合约部署、后端上线、测试网出块 —— `MockGameAssetGateway` 模拟了
完整的状态流转（含延迟、绑定等待、领奖动画时序），衣柜和领奖 UI 可以直接做完。

```csharp
var mock = new MockGameAssetGateway
{
    LatencyMs = 400,          // 模拟慢网络
    BindPollsRequired = 5,    // 验证绑定等待态
};

// 验证降级路径
mock.FailureToInject = new GameAssetException("backend down", 503);
```
