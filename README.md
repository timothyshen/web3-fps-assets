# web3-fps-assets

Unity FPS 游戏的 Web3 资产层 —— 皮肤 NFT 的所有权、奖励发放与自由交易。

Hackathon 项目。本仓库只负责 Web3 侧；Unity 客户端与权威游戏服务器在别处，
通过 `api/openapi.yaml` 和 `IGameAssetGateway` 两个契约对接。

## 一句话原则

> 链是**所有权的最终仲裁者**，不是游戏状态的存储层。
> 任何需要在 16ms 内完成的事情，都不允许出现链调用。

## 状态

合约与抽象层已完成，`forge test` 130 个测试全绿（含 7 个 invariant）。
资产后端与 Web 应用待建，见 [docs/roadmap.md](docs/roadmap.md)。

## 目录

```
contracts/              Foundry 工程
  src/
    interfaces/         对外 ABI 契约
    GameAssetRegistry.sol   款式目录 + 发行上限（唯一强制点）
    WeaponSkin.sol          ERC-721，不可升级
    RewardDistributor.sol   EIP-712 voucher + 幂等直铸
    SkinMarket.sol          demo 市场
    MatchAttestation.sol    对局结果存证
    TournamentEscrow.sol    赛事奖池托管
  test/                 125 个测试，含 7 个 invariant
  script/               部署与灌数据
api/openapi.yaml        资产后端的 REST 契约（Web3 侧实现）
fixtures/               结果包哈希的跨语言参考向量
packages/unity-sdk/     给 Unity 的抽象层（拷 Runtime/ 进工程即可）
docs/
```

## 合约一览

| 合约 | 职责 | 可升级 |
|------|------|--------|
| `GameAssetRegistry` | 款式定义、发行上限强制、外观哈希承诺 | 否 |
| `WeaponSkin` | ERC-721 + Enumerable + EIP-2981 | **永不** |
| `RewardDistributor` | 唯一持有 MINTER_ROLE，两条发奖路径 | 否 |
| `SkinMarket` | 固定价格挂单，按 2981 分版税 | 否 |
| `MatchAttestation` | 对局结果抗篡改存证 | 否 |
| `TournamentEscrow` | 赛事奖池托管，组织者拿不走本金 | 否 |

`WeaponSkin` 不可升级是刻意的：持有所有权的合约一旦可升级，一次升级就能加进
`adminBurn`，"我们无法收回你的资产"就成了假话。

## 快速开始

首次克隆后要先装依赖 —— `contracts/lib/` 是第三方仓库，没有提交进来：

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
forge install foundry-rs/forge-std

forge test                    # 130 个测试
forge test --gas-report       # gas 明细
```

需要 Foundry（`curl -L https://foundry.paradigm.xyz | bash && foundryup`）。

部署到 Monad 测试网：

```bash
cp ../.env.example ../.env    # 填 PRIVATE_KEY 和 REWARD_SIGNER_ADDRESS
source ../.env

forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast
```

验证走 Sourcify 而非 Etherscan，命令见 [docs/contracts.md](docs/contracts.md)。

Unity 侧：把 `packages/unity-sdk/Runtime/` 拷进工程，先用 `MockGameAssetGateway`
开发，后端就绪后换成 `HttpGameAssetGateway`，其余代码不用改。

## 文档

| 文档 | 内容 |
|------|------|
| [architecture.md](docs/architecture.md) | 链上/链下边界、链选型、hackathon 砍了什么 |
| [contracts.md](docs/contracts.md) | 合约参考（对齐实现）、实测 gas、测试清单 |
| [onchain-features.md](docs/onchain-features.md) | 什么该上链什么不该、奖池托管与对局存证的设计 |
| [asset-model.md](docs/asset-model.md) | 为什么用 721、外观哈希承诺、未实现的部分 |
| [integration.md](docs/integration.md) | 资产后端要做什么、Unity 集成约束 |
| [security.md](docs/security.md) | 威胁模型，标注了哪些已挡住、哪些是刻意留的口子 |
| [roadmap.md](docs/roadmap.md) | 进度、下一步、待讨论的问题 |
