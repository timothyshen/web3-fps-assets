# 02 · 链选型与技术栈

## 评估标准（按权重）

| # | 标准 | 为什么重要 |
|---|------|-----------|
| 1 | **单笔成本** | 赛季结算可能有 10 万次 mint/claim。$0.01/笔 = $1000/赛季尚可；$0.5/笔 = 直接否决 |
| 2 | **二级市场流动性** | "自由流通"是产品承诺。没有买家的市场等于没有市场 |
| 3 | **钱包接入门槛** | 目标用户是 FPS 玩家，不是 DeFi 用户。要求助记词 = 转化率归零 |
| 4 | **Gas 赞助能力** | 玩家不应为领取奖励付费，需要成熟的 Paymaster / 协议级赞助 |
| 5 | **EVM 兼容** | Solidity + Foundry + 审计生态复用 |
| 6 | **峰值吞吐** | 赛季末领奖尖峰；Merkle drop 可大幅削峰 |
| 7 | **运营方信誉与安全史** | 桥被盗过的链会持续消耗玩家信任 |

## 候选对比

| 链 | 成本/笔 | 流动性 | 内置钱包 | Gas 赞助 | 风险点 |
|----|--------|--------|---------|---------|--------|
| **Base** | ~$0.001–0.01 | 强（OpenSea/Blur/Magic Eden 全支持） | Coinbase Smart Wallet（Passkey） | ERC-4337 Paymaster 生态成熟 | 与 DeFi 竞争区块空间，行情火热时费用抬升 |
| **Immutable zkEVM** | 协议层免 gas | 弱（基本只在 Immutable 自家市场） | Passport（成熟，专为游戏设计） | 原生免费 | 生态封闭；需接受平台协议费与上架审核；退出成本高 |
| **Ronin** | 极低 | 中（自有市场为主） | Ronin Wallet（成熟） | 有 | 2022 年桥被盗 $6.2 亿；验证者集中度高 |
| **Arbitrum Nova** | 极低 | 弱 | 无原生方案 | 需自建 | AnyTrust 的 DAC 信任假设；NFT 生态基本没有 |
| **Polygon PoS** | 极低 | 中偏强 | 无原生方案 | 需自建 | 向 AggLayer 迁移中，技术路线不确定 |
| **opBNB** | 极低 | 弱–中 | 无原生方案 | 需自建 | 生态集中于 BSC 系，NFT 深度不足 |
| **Sui / Aptos** | 低 | 弱（对 EVM 资产） | 有 | 有 | 对象模型确实更适合游戏资产，但 Solidity 技能与审计生态全部作废 |

## 决策：Base

**主选 Base**，理由按重要性排序：

1. **流动性决定了"自由流通"是否成立。** 这是产品的核心承诺，也是最不可妥协的一条。Base 的 NFT 资产在所有主流市场可交易，玩家不需要理解"我要去哪个专属市场卖"。Immutable 在成本上更优，但把资产锁在单一市场里，与承诺自相矛盾。
2. **Coinbase Smart Wallet 用 Passkey 登录**，没有助记词，玩家用系统生物识别即可，是目前对非加密用户最友好的路径之一，且不是托管钱包 —— 玩家真的持有。
3. ERC-4337 全栈成熟，Paymaster 可以按规则赞助（只赞助我们合约的 `claim` 和 `openCrate`，不赞助任意调用）。
4. 标准 EVM，Foundry + Slither + 主流审计机构都能直接用。

**代价与应对**：Base 费用会随网络拥堵浮动。应对是 Merkle drop 削峰（赛季奖励一次上链一个 root，成本 O(1)）+ Paymaster 设日预算上限，超限时降级为"玩家自付"或排队到低峰期。

**重新评估触发条件**（写下来，避免选型变成永久教条）：
- 月均 gas 赞助支出超过 $X（待定，建议按 ARPU 的 3% 设阈值）；
- 二级市场月成交量连续 3 个月低于总铸造量的 1%（说明流动性论点不成立，此时 Immutable 的成本优势胜出）。

**不做的事**：不做多链部署。多链会把 inventory 一致性、跨链桥、市场碎片化的复杂度全部引入，收益却只是营销故事。单链直到有明确的用户需求为止。

## 技术栈

| 层 | 选择 | 备注 |
|----|------|------|
| 合约语言 | Solidity 0.8.2x | |
| 合约框架 | Foundry | fuzz + invariant 测试是资产类合约的刚需 |
| 合约库 | OpenZeppelin Contracts (v5) | 不自己写 ERC-721/AccessControl |
| 账户抽象 | ERC-4337 + Coinbase Smart Wallet | |
| 索引 | 自建 indexer（viem `watchEvent` + Postgres）| 起步不用 The Graph：自建可控 reorg 处理与业务字段 |
| 后端服务 | Node/TypeScript（viem）或 Go | 与游戏后端技术栈对齐者优先 |
| 密钥管理 | AWS KMS / GCP KMS | 签名密钥永不落盘，见 07 |
| 所有者账户 | Safe 多签 3/5 + Timelock 48h | |
| 数据库 | Postgres | inventory 物化视图、pending_rewards、幂等键 |
| 队列 | Redis Streams / SQS | 结算与领奖异步化 |

## 网络环境

| 环境 | 链 | 用途 |
|------|-----|------|
| local | Anvil fork | 合约单测与本地联调 |
| dev | Base Sepolia | 全链路联调，可随意重置 |
| staging | Base Sepolia（独立部署） | 与游戏 staging 服对接，数据不重置 |
| prod | Base Mainnet | 审计通过后才部署 |
