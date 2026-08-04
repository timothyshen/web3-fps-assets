# 威胁模型

按"攻击者能拿到什么"排序。标注了哪些已经在代码里挡住、哪些是 hackathon 阶段
刻意留的口子。

## T1 · 无限铸造（最高危）

**影响**：签名密钥或 MINTER 权限被攻破 → 铸造任意数量稀有皮肤 → 抛售 →
资产经济归零，且**不可逆**。

**纵深防御**，任何一层单独失效都不致命：

| 层 | 措施 | 状态 |
|----|------|------|
| 合约 | `GameAssetRegistry.maxSupply` 硬上限，`consumeSupply` 原子递增 | 已实现 |
| 合约 | `maxSupply` 只可下调不可上调 | 已实现，fuzz 覆盖 |
| 合约 | admin 没有 `MINTER_ROLE`，所有铸造经 RewardDistributor | 已实现 |
| 密钥 | 签名私钥进 KMS | **未做**，当前在环境变量 |
| 服务 | 每日签名限额 + 单玩家限额 | **未做** |
| 监控 | 链上 mint 速率异常告警 | **未做** |
| 治理 | Safe 多签 + Timelock | **未做**，当前 admin 是单 EOA |

关键认知：即使签名密钥**完全泄露**，攻击者也只能把已定义款式铸到上限为止。
`test_compromisedSignerCannotExceedMaxSupply` 就是在断言这一点。这是 hackathon
阶段能给出的最强保证 —— 上面那些"未做"项都是运营基建，而这条是架构性的。

## T2 · 签名重放

**已挡住**，测试覆盖完整：

| 攻击 | 防护 |
|------|------|
| 同一 voucher 重复提交 | nonce bitmap |
| 测试网签名拿到主网用 | EIP-712 domain 含 chainId + verifyingContract |
| 篡改 player / wear / skinDefId / nonce / deadline | 签名失效 |
| 过期后使用 | `deadline` 强制 |

对应测试：`test_claim_revertsOnReplay`、`test_claim_revertsOnCrossChainReplay`、
`test_claim_revertsOnTamperedFields`、`test_claim_revertsAfterDeadline`。

## T3 · 客户端伪造资产

**攻击**：改内存 / 改封包，显示为持有传说皮肤，或在 loadout 里塞未拥有的 tokenId。

**防护**：
- 客户端上报的皮肤信息一律不采信，游戏服务器通过 `entitlement-check` 独立校验；
- 其他玩家看到的外观来自服务器下发，不来自该玩家客户端；
- 本地改内存最多骗自己，无实际收益，不投入成本对抗。

## T4 · 女巫刷奖

**攻击**：批量注册小号 / 机器人刷对局，套取可交易的 NFT。

这是所有"玩游戏赚资产"模式的结构性弱点，**必须在链下解决，链上无能为力**。

**hackathon 阶段没有防护。** demo 环境下不是问题，但如果要上真实用户，
最低限度需要：

- 奖励绑定 playerId 而非钱包地址（注册门槛即女巫门槛）—— 这条**已经这么设计了**；
- 反作弊评分未达阈值的对局进 `held` 状态，人工复核后才可领取；
- 高价值奖励延迟到赛季末批量发放，给风控留识别窗口；
- 新账号资格冷却期 + 单账号日/周上限。

关键认知：**一旦 mint 上链就不可撤回**。所有风控都必须发生在 mint 之前。
这就是为什么主网版本必须有 `held → claimable` 的人工闸门。

## T5 · 元数据 / 外观篡改

**已部分挡住**：`contentHash` 上链承诺 + 客户端本地校验 + `updateContentHash`
触发链上事件供审计 + `freeze` 永久锁定。

**未做**：Timelock（当前 admin 改哈希立即生效，主网上应加 48h 延迟给玩家反应
时间）、IPFS pin。

## T6 · 链重组

**未做**。当前乐观显示，不等确认数。

Base 是 OP Stack，L2 reorg 罕见但不是不可能。主网版本需要：12 确认才进入可用
库存、indexer 逐块校验 blockHash 并支持幂等回滚。`SkinItem.state` 字段
（`confirmed` / `pending`）已经预留了这个语义，客户端也已经按它过滤 loadout。

## T7 · 市场相关

**已挡住**：
- `SkinMarket.buy` 有 `nonReentrant` + checks-effects-interactions；
- 僵尸挂单检测（卖家已转走 NFT → `ListingStale`）；
- 恶意 `royaltyInfo` 吃掉全部货款 → `InvalidRoyalty` 拒绝；
- 多付自动退还，`testFuzz_accountingBalances` 断言每一 wei 都有去处。

**已知限制**：直接 push 转账，卖家若是 `receive` 会 revert 的合约则交易失败。
对 EOA 玩家无影响，主网版本应改 pull payment。

## T8 · 密钥与运维

| 密钥 | hackathon | 主网应当 |
|------|-----------|---------|
| admin | 单个 EOA | Safe 3/5 + Timelock 48h |
| REWARD_SIGNER | 环境变量 | AWS/GCP KMS，不可导出 |
| 部署密钥 | 同 admin | 硬件钱包，部署后立即移交 |

`Deploy` 脚本已经支持 `ADMIN_ADDRESS != deployer` 时自动移交并撤销部署者权限 ——
主网部署必须走这条路径。

## 上主网前的检查清单

hackathon 不需要做，但如果这个项目要继续：

- [ ] 外部审计，High/Critical 全部修复并复审
- [ ] admin 换成 Safe 多签 + Timelock
- [ ] 签名密钥进 KMS，加签名限额与速率监控
- [ ] 反作弊闸门（`held → claimable`）
- [ ] reorg 处理与确认数门槛
- [ ] 元数据 IPFS pin
- [ ] `SkinMarket` 换成 Seaport，或改 pull payment
- [ ] 确认开箱功能的地区合规范围（若要做开箱）
- [ ] 用户协议明确"NFT 所有权 ≠ 游戏账号所有权，游戏内可用性依赖运营"
- [ ] Bug bounty
