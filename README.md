# web3-fps-assets

Web3 资产层 —— Unity FPS 游戏的链上资产管理、奖励发放与交易。

本仓库只负责 **Web3 侧**。Unity 客户端的实时战斗（移动、射击、命中判定、网络同步）和权威游戏服务器在另外的仓库，本仓库通过明确定义的 HTTP 契约与之交互，不侵入战斗循环。

## 当前状态

**设计阶段。** 尚无合约或服务代码。先把边界、选型和数据流定下来，再落地实现。

## 文档

按顺序阅读：

| 文档 | 内容 |
|------|------|
| [01-scope-and-boundaries.md](docs/01-scope-and-boundaries.md) | 链上 / 链下职责划分，为什么战斗循环绝不碰链 |
| [02-chain-and-stack.md](docs/02-chain-and-stack.md) | 链选型对比与决策，技术栈 |
| [03-asset-model.md](docs/03-asset-model.md) | 皮肤 / 宝箱 / 货币的资产建模，元数据与外观契约 |
| [04-contracts.md](docs/04-contracts.md) | 合约架构、接口、权限与可升级性策略 |
| [05-offchain-services.md](docs/05-offchain-services.md) | 结算、签名、索引、Inventory API |
| [06-unity-integration.md](docs/06-unity-integration.md) | Unity 侧集成契约与钱包 UX |
| [07-security.md](docs/07-security.md) | 威胁模型与缓解措施 |
| [08-roadmap.md](docs/08-roadmap.md) | 分阶段路线图与开放问题 |

## 规划中的目录结构

```
contracts/          Foundry 工程（Solidity）
  src/
  test/
  script/
services/
  settlement/       对局结果 → 待领奖励
  voucher/          EIP-712 签名服务（密钥在 KMS）
  indexer/          链上事件 → inventory 物化视图
  api/              游戏服务器 / 客户端读取入口
packages/
  unity-sdk/        Unity 侧 C# 客户端（只调后端，不持私钥）
  shared-types/     跨服务的类型定义与 ABI
docs/
```

## 一句话原则

> 链是**所有权的最终仲裁者**，不是游戏状态的存储层。
> 任何需要在 16ms 内完成的事情，都不允许出现链调用。
