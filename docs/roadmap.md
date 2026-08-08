# 进度与后续

## 已完成

| 部分 | 状态 |
|------|------|
| `GameAssetRegistry` —— 款式目录 + 发行上限 | 完成，测试覆盖 |
| `WeaponSkin` —— ERC-721 + Enumerable + 2981 | 完成，测试覆盖 |
| `RewardDistributor` —— voucher + 幂等直铸 | 完成，测试覆盖 |
| `SkinMarket` —— demo 市场 | 完成，测试覆盖 |
| `TournamentEscrow` —— 赛事奖池托管 | 完成，含偿付能力 invariant |
| `MatchAttestation` —— 对局结果存证 | 完成，测试覆盖 |
| 部署 + 灌数据脚本 | 完成，未在测试网实跑 |
| `IGameAssetGateway` + Mock + Http 实现 | 完成 |
| `api/openapi.yaml` 后端契约 | 完成 |
| `backend/` 资产后端：openapi 全端点 + SIWE 验签 + `mintDirect` 幂等直铸 + 存证重试队列 + T6 终局性窗口 + held 审核门 + `tokenURI` 元数据 | 完成，55 测试（41 项对真实 anvil 端到端：真签名绑定、领奖到链上确认、重复领奖不双铸、存证 `verify()`） |
| `web/` Web 应用：钱包连接（注入式 + 可选 Privy）、SIWE 绑定页、衣柜、市场、赛事列表/详情/操作落地页 | 完成，tsc 严格 + 构建零错误 |
| `backend/scripts/deploy-local.sh` 本地一键部署 + 灌数据 + setBaseURI | 完成，anvil 实测 |

`forge test` 130 个测试全绿，含 7 个 invariant。原第 2、3 步（后端、Web 应用）
已完成并超出原清单（赛事页、终局性窗口、审核门、元数据服务）；验收标准
"Unity 换 `HttpGameAssetGateway` 其余代码不改"由 Unity 侧 PR 的契约镜像保障，
待实机联调最终确认。

## 下一步（按依赖顺序）

### 1. 测试网实跑 —— ✅ 已完成（2026-08-08，上线运行中）

- [x] 六合约部署至 Monad 测试网（地址见 `backend/deployments.monad-testnet.json`）
- [x] `SeedSkins.s.sol` 灌 5 款皮肤；`setBaseURI` 已指向公网后端（tx `0x455f…42da`）
- [x] 后端上线 Railway：`https://web3-fps-assets-production.up.railway.app`（Dockerfile + `/app/data` 卷，`CONFIRMATION_BLOCKS=2`）
- [x] Web 上线 Vercel：`https://web3-fps-assets.vercel.app`（SPA 深链接重写已配）
- [x] 生产环境全链路 E2E 通过：登录 → 真实 SIWE 绑定 → 内部端点推对局 → 链上存证 `attested` → 领奖真实铸造（tokenId 4475355922433）→ 终局窗口后 confirmed → 衣柜显示 → 公网 tokenURI 元数据解析
- [ ] Sourcify 合约验证（可选，便于浏览器读源码）
- [ ] `cast`/Web 手动走一遍 list → buy（市场页挂单易手轨迹）

**验收**：在区块浏览器上能看到一件皮肤从铸造到易手的完整轨迹（铸造已达成，易手待市场页实操）。

### 2. Demo 串联（半天，依赖游戏侧）

- [ ] Unity 大厅接 `HttpGameAssetGateway`（登录先用 demo `/v1/auth/login` 换 JWT，`SetAccessToken` 注入）
- [ ] 打一局 → 游戏服务器推 `/internal/v1/matches` → 后端发奖 → 大厅出现新皮肤 → Web 上挂单 → 另一个账号买走
- [ ] 演示脚本与话术

前置：游戏侧 v1.8.0 PR（契约镜像 + 61 个 EditMode 用例）需在 Unity 环境验证合入。

### 3. 契约整理（小，demo 后）

- [ ] `ChainConfig`：unity-sdk 平铺 `nativeSymbol` vs openapi 嵌套 `nativeCurrency{}`，二选一（后端暂发两者超集兼容）
- [ ] openapi 引用的 fixtures 文件名笔误（实际为 `match-result-v1.canonical/expected.json`）
- [ ] 把实际采用的附加状态码（400 schema 校验、404 未知赛事 intent、503 `chain_unavailable`）与 `rewardSlots[].slot` 的 uint8 约束补进 openapi

### 4. 产品确认（不阻塞演示）

- [ ] 反作弊 `rejected` 的对局**完全不产生奖励**（铸造不可逆，风控置于铸前）——需确认
- [ ] 奖励 → 皮肤款式的指派规则（当前为 5 款种子皮肤的确定性 demo 策略）

## 与游戏侧的依赖

Web3 侧无法独立完成的，需要尽早对齐：

| 依赖 | 状态 |
|------|---------|
| **玩家账号体系（playerId）** | demo 解法已就位（`/v1/auth/login` 发 JWT，明确标注生产替换）；真实账号体系仍待游戏侧对齐 |
| 对局结果推送接口 | 后端已实现 `/internal/v1/matches`（哈希校验 + 幂等 + 409 冲突），待游戏服务器接入 |
| 皮肤 AssetBundle 打包 + 哈希产出 | 仍待游戏侧（demo 可先用占位资源；元数据图片同为占位方案） |
| 大厅 UI（衣柜、领奖、绑钱包） | 游戏侧包已有功能型大厅并镜像本仓库契约（v1.8.0 PR），待实机验证 |

## 已决定的事

不再讨论，除非有新信息：

- **不发同质化代币。** 已确认。
- **不做多链。** 复杂度远超收益。
- **不自建生产级市场。** demo 用 `SkinMarket`，主网走 Seaport。
- **资产合约不可升级。** 可升级 = "无法收回你的资产"是假话。
- **版税用 EIP-2981 且不强制。** 宁可少收，不破坏自由流通。
- **Unity 不碰私钥、不连链。** 安全底线。

## 还需要讨论的

1. **奖励用 push 还是 pull？** 合约两条路径都实现了；demo 已按 push 落地
   （后端直铸，玩家零操作）。真实运营时高价值奖励切 pull（voucher）仍是开放项。
2. **要不要接 gas 代付？** **建议不接。** push 模式下玩家本来就不付 gas，
   只有 Web 端挂单/购买需要，而 Monad 的 gas 成本本身很低 —— 给测试地址打点
   测试网 MON 就够演示了。省下的时间投到别处更划算。
3. **`maxSupply` 定多少？** 上链后只能降不能升，定太高无法回收。demo 用
   `SeedSkins.s.sol` 里的 100–10000 分层即可，真实发行需要经济模型输入。
4. **Web 应用和游戏用同一套账号吗？** 影响 SIWE 绑定流程的设计。

## 明确不做

- 宝箱 / 开箱（随机数安全 + 多地区博彩合规，见 asset-model.md）
- 赛季 Merkle drop（规模没到）
- 质押 / 挖矿 / 收益玩法（与定位冲突，且引入证券风险）
- 链上战斗记录（成本高、无人消费）
