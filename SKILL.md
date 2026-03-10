---
name: gate-wallet-cli
version: "1.0.0"
updated: "2026-03-09"
description: "Interact with Gate Web3 custodial wallet via MCP protocol. Supports Gate/Google OAuth login, wallet asset queries, transfers, swap/bridge, market data, token info, security audits, chain config and RPC calls. Use when the user asks about wallet balance, token transfers, swaps, market data, or token security on supported chains (ETH, SOL, BSC, Base, etc.)."
---

# Gate Wallet CLI

MCP 协议驱动的 Gate Web3 托管钱包 CLI。OAuth 登录后即可查资产、转账、Swap、查行情。

## Quick Start

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli
pnpm cli
```

仅支持交互模式。Token 存内存，退出即失效。需先 `login` 完成认证。

---

## Domain Knowledge

使用命令时需要了解的跨命令约束和关键概念。

### 认证模型

- 通过 Gate OAuth 或 Google OAuth 登录，获取 `mcp_token`
- Token 仅存内存，退出交互模式即失效，无本地持久化
- 所有需认证的命令（除 `tools`/`chain-config` 外）均自动注入 `mcp_token`
- 登录后自动获取 EVM 和 SOL 两条链的钱包地址

### 托管钱包架构

签名由服务端完成（非本地私钥），安全模型为：

```
OAuth 登录 → mcp_token → 服务端代签 → 链上广播
```

用户无需管理私钥/助记词。`sign-msg` 和 `sign-tx` 均为服务端签名。

### 金额格式

所有金额参数和返回值均为 **人类可读值**，非链上最小单位。

| ✅ 正确                   | ❌ 错误                              |
| ------------------------- | ------------------------------------ |
| `--amount 0.1`（0.1 ETH） | `--amount 100000000000000000`（wei） |
| `--amount 1`（1 SOL）     | `--amount 1000000000`（lamports）    |

### 原生代币处理

Swap 中原生代币（ETH/SOL/BNB）地址用 `-` 表示，并设置 `--native-in 1` 或 `--native-out 1`。

### 常见稳定币地址

| 链       | USDT                                           | USDC                                           |
| -------- | ---------------------------------------------- | ---------------------------------------------- |
| Ethereum | `0xdAC17F958D2ee523a2206206994597C13D831ec7`   | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`   |
| BSC      | `0x55d398326f99059fF775485246999027B3197955`   | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`   |
| Arbitrum | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`   | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`   |
| Solana   | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

其他代币请先用 `token-info` 查询合约地址。

---

## Commands

### 认证

| 命令             | 说明                                |
| ---------------- | ----------------------------------- |
| `login`          | Gate OAuth 登录（默认，浏览器授权） |
| `login --google` | Google OAuth 登录                   |
| `status`         | 查看当前认证状态                    |
| `logout`         | 登出（清除内存 token）              |

### 钱包查询

| 命令                                    | 说明                      |
| --------------------------------------- | ------------------------- |
| `balance`                               | 总资产余额（USD 计价）    |
| `address`                               | 各链钱包地址（EVM / SOL） |
| `tokens`                                | Token 列表和余额          |
| `sign-msg <32位hex> [--chain EVM\|SOL]` | 签名消息                  |
| `sign-tx <raw_tx>`                      | 签名原始交易              |

### 转账

| 命令                                                                     | 说明                       |
| ------------------------------------------------------------------------ | -------------------------- |
| `send --chain <chain> --to <addr> --amount <n> [--token <contract>]`     | 一键转账（预览→签名→广播） |
| `transfer --chain <chain> --to <addr> --amount <n> [--token <contract>]` | 仅预览不执行               |
| `gas [chain]`                                                            | Gas 费用估算               |
| `sol-tx --to <addr> --amount <n> [--mint <token>]`                       | 构建 Solana 未签名交易     |
| `send-tx --chain <chain> --hex <signed_tx> --to <addr>`                  | 广播已签名交易             |
| `tx-detail <tx_hash>`                                                    | 交易详情                   |
| `tx-history [--page <n>] [--limit <n>]`                                  | 交易历史                   |

### Swap 兑换

| 命令                                                                               | 说明                            |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| `quote --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>` | 获取报价                        |
| `swap --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>`  | 一键兑换（报价→构建→签名→提交） |
| `swap-detail <order_id>`                                                           | 兑换详情                        |
| `swap-history [--page <n>] [--limit <n>]`                                          | 兑换历史                        |

额外参数：`--slippage <pct>` · `--native-in <0|1>` · `--native-out <0|1>` · `--wallet <addr>` · `--to-wallet <addr>`

### 市场数据

| 命令                                                                     | 说明              |
| ------------------------------------------------------------------------ | ----------------- |
| `kline --chain <chain> --address <addr> [--period <1m\|5m\|1h\|4h\|1d>]` | K 线数据          |
| `liquidity --chain <chain> --address <addr>`                             | 流动性池事件      |
| `tx-stats --chain <chain> --address <addr>`                              | 交易量统计        |
| `swap-tokens [--chain <chain>] [--search <keyword>]`                     | 可兑换 Token 列表 |
| `bridge-tokens [--src-chain <chain>] [--dest-chain <chain>]`             | 跨链桥 Token      |

### Token / DApp

| 命令                                                                 | 说明                    |
| -------------------------------------------------------------------- | ----------------------- |
| `token-info --chain <chain> --address <addr>`                        | Token 详情（价格/市值） |
| `token-risk --chain <chain> --address <addr>`                        | 安全审计                |
| `token-rank [--chain <chain>] [--limit <n>] [--direction asc\|desc]` | 涨跌幅排行              |
| `new-tokens [--chain <chain>] [--start <RFC3339>] [--end <RFC3339>]` | 按时间筛选新 Token      |

### 链 / RPC

| 命令                                                        | 说明                    |
| ----------------------------------------------------------- | ----------------------- |
| `chain-config [chain]`                                      | 链配置（RPC / chainID） |
| `rpc --chain <chain> --method <method> [--params '<json>']` | JSON-RPC 调用           |

### 调试

| 命令                 | 说明                  |
| -------------------- | --------------------- |
| `tools`              | 列出所有 MCP Tools    |
| `call <tool> [json]` | 直接调用任意 MCP Tool |

---

## Typical Workflows

### 代币研究

```
token-info --chain eth --address 0x...    # 基本信息
token-risk --chain eth --address 0x...    # 安全审计
kline --chain eth --address 0x... --period 1h  # 价格走势
tx-stats --chain eth --address 0x...      # 交易活跃度
liquidity --chain eth --address 0x...     # 流动性
```

### 安全转账

```
balance                                    # 确认余额充足
gas ETH                                    # 估算手续费
transfer --chain ETH --to 0x... --amount 0.1  # 预览（不执行）
send --chain ETH --to 0x... --amount 0.1      # 确认后执行
tx-detail <hash>                           # 验证上链
```

### Swap 兑换

```
quote --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0  # 报价
swap --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0 --slippage 0.5  # 执行
swap-detail <order_id>                     # 跟踪状态
```

---

## Chain Identifiers

| 链        | Chain ID | 参数    |
| --------- | -------- | ------- |
| Ethereum  | 1        | ETH     |
| BSC       | 56       | BSC     |
| Polygon   | 137      | POLYGON |
| Arbitrum  | 42161    | ARB     |
| Base      | 8453     | BASE    |
| Optimism  | 10       | OP      |
| Avalanche | 43114    | AVAX    |
| Solana    | 501      | SOL     |

链名称不区分大小写。Swap 命令使用 Chain ID，其他命令使用参数名。

---

## Common Pitfalls

1. **未登录就操作**：除 `tools` / `chain-config` 外，所有命令需先 `login`
2. **原生代币地址**：Swap 中 ETH/SOL/BNB 等原生代币用 `-`，不是合约地址
3. **native-in/out 忘记设置**：原生代币必须设 `--native-in 1` 或 `--native-out 1`，否则 Swap 会失败
4. **sign-msg 格式**：必须为 32 位十六进制字符串（16 bytes），如 `aabbccddeeff00112233445566778899`
5. **报价过期**：`quote` 结果有时效性，超过 ~30s 价格可能变动，建议立即执行或重新报价
6. **余额不足**：转账/Swap 前用 `balance` 和 `tokens` 确认余额（含 Gas 费）
7. **SOL 转账需刷新 blockhash**：`send` 命令已自动处理，手动 `sign-tx` + `send-tx` 时注意 blockhash 时效
8. **滑点设置**：小额交易建议 `--slippage 0.5`（5%）到 `--slippage 1`（10%），大额交易适当降低

---

## Safety Rules

- **资金操作确认**：`send` / `swap` 涉及真实资金，执行前必须向用户确认目标地址、金额、代币、链
- **先预览再执行**：转账建议先 `transfer` 预览，Swap 建议先 `quote` 报价
- **风险审计**：交易不熟悉的代币前，先 `token-risk` 检查安全性，清晰展示风险项
- **Token 不持久化**：认证 token 仅存内存，退出即失效，无本地文件泄漏风险
- **签名由服务端完成**：用户无需暴露私钥，但需信任 Gate 托管服务
