# 跨语言测试夹具

三方（Solidity / TypeScript 后端 / C# Unity）对着同一组输入输出校准 `resultHash` 的实现。

| 文件 | 内容 |
|------|------|
| `match-result-v1.canonical.json` | 已按 RFC 8785 规范化的 MatchResult 字节，**642 字节，无尾随换行** |
| `match-result-v1.expected.json` | 期望的 `resultHash` 与 `matchIdKey` |

## 哈希规则（PRD MAT-003）

```
resultHash = keccak256( JCS(matchResult) 的 UTF-8 字节 )
matchIdKey = keccak256( matchId 的 UTF-8 字节 )
```

**规范化那步不能省。** JSON 序列化在键序、Unicode 转义、数字格式上各语言实现各不相同，
不规范化的话 C# 和 TS 算出的哈希几乎必然对不上 —— 而且这种不一致要到联调那天才会暴露。
PRD 的 AC-08 正是测这个。

RFC 8785 的要点：

- 对象键按 **UTF-16 码元**升序排列（不是按字节，也不是按 locale）
- 无任何无意义空白
- 数字用最短往返表示（整数就是整数，不带 `.0`、不用指数）
- 字符串只做最小转义

数组顺序**不由 JCS 决定**，是业务规则：`players` 必须按 `playerId` 升序（PRD 7.2）。
这条得自己保证，规范化不会替你排。

## 各语言怎么用

**TypeScript / Node**

```ts
import canonicalize from 'canonicalize'   // RFC 8785 实现
import { keccak256, toUtf8Bytes } from 'ethers'

const resultHash = keccak256(toUtf8Bytes(canonicalize(matchResult)!))
```

**C# / Unity** —— 注意 `JsonUtility` 不能用（不保证键序，也不做 JCS），
需要一个真正的 JCS 实现 + keccak256（**不是** `System.Security.Cryptography.SHA3_256`，
padding 不同）。

**Solidity** —— 见 `contracts/test/MatchResultHash.t.sol`，它直接读这里的夹具做断言。

## 新增实现的自检

```
1. 读 match-result-v1.canonical.json 的原始字节
2. 算 keccak256
3. 必须等于 match-result-v1.expected.json 里的 resultHash
```

如果你的实现是先反序列化再自己规范化再哈希，那还要额外验证：**规范化输出的字节
必须与夹具文件逐字节相同**。只对比哈希会漏掉"我的规范化实现有 bug，但恰好这个
样本没触发"的情况。

## 改夹具的规矩

改了 `match-result-v1.canonical.json` 就必须同步更新 `expected.json` 和
`MatchResultHash.t.sol` 里的常量，并通知所有实现方重新校准。

**最容易踩的坑是编辑器自动加尾随换行** —— 多一个 `\n` 哈希就全变了。
`test_fixtureHasNoTrailingNewline` 会拦住这个。
