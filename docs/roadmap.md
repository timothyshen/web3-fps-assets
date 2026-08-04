# 进度与后续

## 已完成

| 部分 | 状态 |
|------|------|
| `GameAssetRegistry` —— 款式目录 + 发行上限 | 完成，测试覆盖 |
| `WeaponSkin` —— ERC-721 + Enumerable + 2981 | 完成，测试覆盖 |
| `RewardDistributor` —— voucher + 幂等直铸 | 完成，测试覆盖 |
| `SkinMarket` —— demo 市场 | 完成，测试覆盖 |
| 部署 + 灌数据脚本 | 完成，未在测试网实跑 |
| `IGameAssetGateway` + Mock + Http 实现 | 完成 |
| `api/openapi.yaml` 后端契约 | 完成 |

`forge test` 72 个测试全绿，含 4 个 invariant。

## 下一步（按依赖顺序）

### 1. 测试网实跑（半天）

脚本写好了但没在真链上跑过，先把这个闭环打通：

- [ ] 拿 Base Sepolia 测试币
- [ ] `Deploy.s.sol` 实际部署 + Etherscan 验证
- [ ] `SeedSkins.s.sol` 灌 5 款皮肤
- [ ] `cast` 手动走一遍 mintDirect → tokensOfOwner → list → buy

**验收**：在区块浏览器上能看到一件皮肤从铸造到易手的完整轨迹。

### 2. 资产后端（1–2 天）

四个端点，一个 Node/TS 服务，不拆微服务：

- [ ] `GET /v1/assets` —— 读 `tokensOfOwner` + 缓存
- [ ] `POST /v1/wallet/bind` + 轮询 —— SIWE 验签
- [ ] `POST /v1/rewards/{id}/claim` —— 调 `mintDirect`
- [ ] `POST /internal/v1/entitlement-check`
- [ ] `tokenURI` 指向的元数据 API

**验收**：Unity 侧把 `MockGameAssetGateway` 换成 `HttpGameAssetGateway`，
其余代码一行不改，功能一致。这是抽象层是否合格的唯一标准。

### 3. Web 应用（1–2 天，你的主场）

- [ ] 钱包连接（Coinbase Smart Wallet / wagmi）
- [ ] 绑定页面（SIWE 签名）
- [ ] 衣柜展示（读 `tokensOfOwner`）
- [ ] 挂单 / 购买（`SkinMarket`）

### 4. Demo 串联（半天）

- [ ] Unity 大厅接 `HttpGameAssetGateway`
- [ ] 打一局 → 后端发奖 → 大厅出现新皮肤 → Web 上挂单 → 另一个账号买走
- [ ] 演示脚本与话术

## 与游戏侧的依赖

Web3 侧无法独立完成的，需要尽早对齐：

| 依赖 | 何时需要 |
|------|---------|
| **玩家账号体系（playerId）** | **最早** —— 奖励绑定在 playerId 上，影响账号系统设计 |
| 对局结果推送接口 | 第 2 步 |
| 皮肤 AssetBundle 打包 + 哈希产出 | 第 4 步（demo 可先用占位资源） |
| 大厅 UI（衣柜、领奖、绑钱包） | 第 4 步 |

## 已决定的事

不再讨论，除非有新信息：

- **不发同质化代币。** 已确认。
- **不做多链。** 复杂度远超收益。
- **不自建生产级市场。** demo 用 `SkinMarket`，主网走 Seaport。
- **资产合约不可升级。** 可升级 = "无法收回你的资产"是假话。
- **版税用 EIP-2981 且不强制。** 宁可少收，不破坏自由流通。
- **Unity 不碰私钥、不连链。** 安全底线。

## 还需要讨论的

1. **奖励用 push 还是 pull？** 当前两条路径都实现了。push（后端直铸）demo 体验
   最顺，玩家零操作；pull（voucher）省 gas 且未领取的不上链。建议 demo 用 push，
   真实运营时高价值奖励切 pull。
2. **hackathon 要不要接 Paymaster？** 接了玩家全程零 gas，演示效果好；不接的话
   push 模式下玩家本来也不用付 gas，只有 Web 端挂单/购买需要。**建议不接** ——
   投入产出比不高，push 模式已经能演示"零门槛"。
3. **`maxSupply` 定多少？** 上链后只能降不能升，定太高无法回收。demo 用
   `SeedSkins.s.sol` 里的 100–10000 分层即可，真实发行需要经济模型输入。
4. **Web 应用和游戏用同一套账号吗？** 影响 SIWE 绑定流程的设计。

## 明确不做

- 宝箱 / 开箱（随机数安全 + 多地区博彩合规，见 asset-model.md）
- 赛季 Merkle drop（规模没到）
- 质押 / 挖矿 / 收益玩法（与定位冲突，且引入证券风险）
- 链上战斗记录（成本高、无人消费）
