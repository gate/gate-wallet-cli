# Gate Wallet CLI

基于 MCP 协议的 Gate Web3 托管钱包命令行工具，通过 Google / Gate OAuth 登录后管理链上资产、查询行情、执行交易。

## 安装

```bash
pnpm install
```

## 快速开始

```bash
pnpm cli
```

进入交互模式后：

```
Gate Wallet CLI - Interactive Mode
Type 'login' to start, 'help' for all commands, 'exit' to quit.

gate-wallet> login
gate-wallet> balance
gate-wallet> exit
```

> **注意**：Token 仅保存在内存中，退出交互模式即失效，下次启动需重新登录。

## 登录 / 登出

```
# Gate OAuth 登录（默认，浏览器授权）
login

# Google OAuth 登录
login --google

# 查看登录状态
status

# 登出
logout
```

## 命令速查

### 钱包查询

| 命令      | 说明                          |
| --------- | ----------------------------- |
| `balance` | 查询总资产余额                |
| `address` | 查询各链钱包地址（EVM / SOL） |
| `tokens`  | 查询 Token 列表和余额         |

### 一键转账

| 命令                                                        | 说明                      |
| ----------------------------------------------------------- | ------------------------- |
| `send --chain ETH --to 0x... --amount 0.0001`               | ETH 原生币一键转账        |
| `send --chain SOL --to <address> --amount 0.001`            | SOL 原生币一键转账        |
| `send --chain ETH --to 0x... --amount 1 --token 0xdAC...`   | ERC20 代币转账（如 USDT） |
| `send --chain SOL --to <address> --amount 1 --token EPj...` | SPL 代币转账（如 USDC）   |

`send` 命令自动完成 **预览 → 签名 → 广播** 全流程。

### 交易操作（分步）

| 命令                                                      | 说明                                |
| --------------------------------------------------------- | ----------------------------------- |
| `gas [chain]`                                             | 查询 Gas 费用（默认 ETH，支持 SOL） |
| `transfer --chain ETH --to 0x... --amount 0.1`            | 转账预览（仅预览不发送）            |
| `sol-tx --to <address> --amount 0.001`                    | 构建 Solana 未签名转账交易          |
| `sign-msg <32位hex>`                                      | 签名消息（必须 32 hex chars）       |
| `sign-tx <raw_tx>`                                        | 签名原始交易                        |
| `send-tx --chain ETH --hex 0x... --to 0x... --amount 0.1` | 广播已签名交易                      |
| `tx-detail <tx_hash>`                                     | 查询链上交易详情                    |
| `tx-history --limit 3`                                    | 交易历史（支持分页）                |

### Swap 兑换

| 命令                                                     | 说明                                |
| -------------------------------------------------------- | ----------------------------------- |
| `quote --from-chain 1 --from - --to 0x... --amount 0.01` | 获取 Swap 报价                      |
| `swap --from-chain 1 --from - --to 0x... --amount 0.01`  | 一键兑换（Quote→Build→Sign→Submit） |
| `swap-detail <order_id>`                                 | 查询 Swap 交易详情                  |
| `swap-history --limit 3`                                 | Swap / Bridge 历史（支持分页）      |

### 行情数据

| 命令                                             | 说明                  |
| ------------------------------------------------ | --------------------- |
| `kline --chain eth --address 0x...`              | K 线数据              |
| `liquidity --chain eth --address 0x...`          | 流动性池事件          |
| `tx-stats --chain eth --address 0x...`           | 交易量统计            |
| `swap-tokens --chain eth`                        | 链上可兑换 Token 列表 |
| `bridge-tokens --src-chain eth --dest-chain bsc` | 跨链桥目标 Token      |

### Token 信息

| 命令                                                  | 说明                    |
| ----------------------------------------------------- | ----------------------- |
| `token-info --chain eth --address 0x...`              | Token 详情（价格/市值） |
| `token-risk --chain eth --address 0x...`              | 安全审计信息            |
| `token-rank --chain eth`                              | 涨跌幅排行榜            |
| `new-tokens --chain eth --start 2026-03-08T00:00:00Z` | 按时间筛选新 Token      |

### 链 / RPC

| 命令                                       | 说明          |
| ------------------------------------------ | ------------- |
| `chain-config [chain]`                     | 查询链配置    |
| `rpc --chain ETH --method eth_blockNumber` | JSON-RPC 调用 |

### 高级

| 命令                 | 说明                     |
| -------------------- | ------------------------ |
| `tools`              | 列出所有可用的 MCP Tools |
| `call <tool> [json]` | 直接调用任意 MCP Tool    |

## 操作示例

### 查看资产

```
gate-wallet> address
{
  "account_id": "6fb55bb0-...",
  "addresses": {
    "EVM": "0xdb918f36a1c282a042758b544c64ae5a1d5767a2",
    "SOL": "BTYzBJ5N7L9exV4UAvHnPhfmovz4tmbVvagar4U7bfxE"
  }
}

gate-wallet> balance
{
  "total_value": "$2.76"
}

gate-wallet> tokens
  ETH   0.0009585  $1.91
  SOL   0.006752   $0.566
  USDT  0.1978     $0.1978
  USDC  0.08429    $0.08429
```

### ETH 一键转账

```
gate-wallet> send --chain ETH --to 0x44a04fb1be798ceeeafaf7e8bd3ab6dd1ae8d044 --amount 0.0001
✔ 预览成功：Transfer 0.0001 ETH from 0xdb91...67a2 to 0x44a0...d044 on ETH
✔ 签名成功
✔ 交易已广播
  Hash: 0x952c9c05dbe52af3088a98363c2b893770b904e2fb2fd8c5bfa857dad28a9f68
```

### SOL 一键转账

```
gate-wallet> send --chain SOL --to 3dDNcfPbYQsnHiA7hw7ATSDXv1uYMbZ4AEPjdgUz2T6f --amount 0.001
✔ 预览成功：Transfer 0.001 SOL from BTYz...bfxE to 3dDN...2T6f on SOL
✔ 已获取最新 unsigned_tx
✔ 签名成功
✔ 交易已广播
  Hash: 3eLtpu1xoPM2Fodtjzw1wq1V3CRyPFCk74AvFtwrzsu5...
```

### ETH → USDT Swap

```
gate-wallet> swap --from-chain 1 --to-chain 1 --from - --to 0xdAC17F958D2ee523a2206206994597C13D831ec7 --amount 0.0001 --native-in 1 --native-out 0 --slippage 0.1
{
  "status": "submitted",
  "tx_hash": "0x894d9694...",
  "amount_in": "0.0001",
  "amount_out": "0.202504",
  "from_token": "ETH",
  "to_token": "USDT"
}

gate-wallet> swap-detail <tx_order_id>
```

### SOL → USDC Swap

```
gate-wallet> swap --from-chain 501 --to-chain 501 --from - --to EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --amount 0.001 --native-in 1 --native-out 0 --slippage 0.1
{
  "status": "submitted",
  "tx_hash": "1GPGnkBnggFCYf1RA6Gpq...",
  "amount_in": "0.001",
  "amount_out": "0.083644",
  "from_token": "SOL",
  "to_token": "USDC"
}
```

### 签名消息

```
# message 必须为 32 位十六进制字符串
gate-wallet> sign-msg aabbccddeeff00112233445566778899 --chain EVM
{
  "signature": "bfe6ad2679894cc8...",
  "publicKey": "03f79013efccab82..."
}
```

## Swap 参数说明

| 参数           | 说明                                           |
| -------------- | ---------------------------------------------- |
| `--from-chain` | 源链 ID（ETH=1, BSC=56, SOL=501）              |
| `--to-chain`   | 目标链 ID（同链 swap 与 from-chain 相同）      |
| `--from`       | 源 token 地址，原生币用 `-`                    |
| `--to`         | 目标 token 合约地址                            |
| `--amount`     | 兑换数量                                       |
| `--native-in`  | 源 token 是否原生币（1=是, 0=否）              |
| `--native-out` | 目标 token 是否原生币（1=是, 0=否）            |
| `--slippage`   | 滑点容忍度（0.03=3%, 0.1=10%，小额建议 5-10%） |

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

## 技术栈

- **Runtime**: Node.js + TypeScript
- **CLI Framework**: Commander.js
- **MCP**: `@modelcontextprotocol/sdk`
- **Auth**: Google / Gate OAuth 2.0
