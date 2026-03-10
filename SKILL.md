---
name: gate-wallet-cli
description: Gate DEX 托管钱包 CLI 工具。支持 Gate/Google OAuth 登录、钱包资产查询、转账、Swap 兑换、市场数据、代币信息、链配置和 RPC 调用。当用户需要操作 Gate 钱包、查询链上资产、转账、兑换代币或查看行情时使用。
---

# Gate Wallet CLI

基于 MCP 协议的 Gate Web3 托管钱包 CLI，通过 Gate / Google OAuth 登录后管理链上资产。

## 启动

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli
pnpm cli              # 默认 test 环境
pnpm cli --env prod   # 指定环境：test / pre / prod
```

仅支持交互模式。Token 存内存，退出即失效。

---

## 认证

| 命令             | 说明                                |
| ---------------- | ----------------------------------- |
| `login`          | Gate OAuth 登录（默认，浏览器授权） |
| `login --google` | Google OAuth 登录                   |
| `status`         | 查看当前认证状态                    |
| `logout`         | 登出                                |

---

## 钱包查询

| 命令                                    | 说明                      |
| --------------------------------------- | ------------------------- |
| `balance`                               | 总资产余额（USD 计价）    |
| `address`                               | 各链钱包地址（EVM / SOL） |
| `tokens`                                | Token 列表和余额          |
| `sign-msg <32位hex> [--chain EVM\|SOL]` | 签名消息                  |
| `sign-tx <raw_tx>`                      | 签名原始交易              |

---

## 转账

| 命令                                                                     | 说明                       |
| ------------------------------------------------------------------------ | -------------------------- |
| `send --chain <chain> --to <addr> --amount <n> [--token <contract>]`     | 一键转账（预览→签名→广播） |
| `transfer --chain <chain> --to <addr> --amount <n> [--token <contract>]` | 仅预览不执行               |
| `gas [chain]`                                                            | Gas 费用估算               |
| `sol-tx --to <addr> --amount <n> [--mint <token>]`                       | 构建 Solana 未签名交易     |
| `send-tx --chain <chain> --hex <signed_tx> --to <addr>`                  | 广播已签名交易             |
| `tx-detail <tx_hash>`                                                    | 交易详情                   |
| `tx-history [--page <n>] [--limit <n>]`                                  | 交易历史                   |

### 转账示例

```
send --chain ETH --to 0x742d35Cc... --amount 0.1
send --chain SOL --to 5FHwkrdx... --amount 0.5
send --chain ETH --to 0x742d35Cc... --amount 100 --token 0xA0b86991...
```

> **send 涉及真实资金**，执行前必须向用户确认目标地址、金额、代币、链。

---

## Swap 兑换

| 命令                                                                               | 说明                            |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| `quote --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>` | 获取报价                        |
| `swap --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>`  | 一键兑换（报价→构建→签名→提交） |
| `swap-detail <order_id>`                                                           | 兑换详情                        |
| `swap-history [--page <n>] [--limit <n>]`                                          | 兑换历史                        |

额外参数：`--slippage <pct>`、`--native-in <0|1>`、`--native-out <0|1>`、`--wallet <addr>`、`--to-wallet <addr>`

原生代币地址用 `-`，并设 `--native-in 1` 或 `--native-out 1`。

### Swap 示例

```
# ETH → USDC（同链）
swap --from-chain 1 --to-chain 1 --from - --to 0xA0b86991... --amount 0.01 --native-in 1 --native-out 0 --slippage 0.5

# SOL → USDC
swap --from-chain 501 --to-chain 501 --from - --to EPjFWdd5... --amount 0.1 --native-in 1 --native-out 0 --slippage 1

# 跨链桥 ETH → BSC
swap --from-chain 1 --to-chain 56 --from - --to - --amount 0.01 --native-in 1 --native-out 1
```

> **swap 涉及真实资金**，建议先 `quote` 获取报价让用户确认。

---

## 市场数据

| 命令                                                                     | 说明              |
| ------------------------------------------------------------------------ | ----------------- |
| `kline --chain <chain> --address <addr> [--period <1m\|5m\|1h\|4h\|1d>]` | K 线数据          |
| `liquidity --chain <chain> --address <addr>`                             | 流动性池事件      |
| `tx-stats --chain <chain> --address <addr>`                              | 交易量统计        |
| `swap-tokens [--chain <chain>] [--search <keyword>]`                     | 可兑换 Token 列表 |
| `bridge-tokens [--src-chain <chain>] [--dest-chain <chain>]`             | 跨链桥 Token      |

---

## Token / DApp

| 命令                                                                 | 说明                    |
| -------------------------------------------------------------------- | ----------------------- |
| `token-info --chain <chain> --address <addr>`                        | Token 详情（价格/市值） |
| `token-risk --chain <chain> --address <addr>`                        | 安全审计                |
| `token-rank [--chain <chain>] [--limit <n>] [--direction asc\|desc]` | 涨跌幅排行              |
| `new-tokens [--chain <chain>] [--start <RFC3339>] [--end <RFC3339>]` | 按时间筛选新 Token      |

---

## 链 / RPC

| 命令                                                        | 说明                    |
| ----------------------------------------------------------- | ----------------------- |
| `chain-config [chain]`                                      | 链配置（RPC / chainID） |
| `rpc --chain <chain> --method <method> [--params '<json>']` | JSON-RPC 调用           |

---

## 高级

| 命令                 | 说明                  |
| -------------------- | --------------------- |
| `tools`              | 列出所有 MCP Tools    |
| `call <tool> [json]` | 直接调用任意 MCP Tool |

---

## 支持的链

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

---

## 使用说明

1. `pnpm cli` 启动交互模式，提示符下输入命令
2. 必须先 `login` 才能执行其他操作
3. Token 仅存内存，退出即失效，下次需重新登录
4. 涉及资金操作（send / swap）执行前必须向用户确认
5. 链名称不区分大小写
6. `token-risk` 结果务必清晰展示风险项
