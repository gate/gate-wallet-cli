# Gate Wallet CLI

基于 MCP 协议的 Gate Web3 托管钱包命令行工具，通过 Google / Gate OAuth 登录后管理链上资产、查询行情、执行交易。

## 安装

### 方式一：npm 全局安装（推荐）

```bash
npm install -g gate-wallet-cli
```

安装后即可全局使用：

```bash
gate-wallet login           # Gate OAuth 登录
gate-wallet balance          # 查询余额
gate-wallet --help           # 查看所有命令
```

### 方式二：npx 免安装运行

```bash
npx gate-wallet-cli login
npx gate-wallet-cli balance
```

### 方式三：从源码开发

```bash
git clone <repo-url>
cd gate-wallet-cli/cli
pnpm install
pnpm cli login               # 开发模式运行
```

## 快速开始

### 单命令模式

```bash
gate-wallet login              # Gate OAuth 登录
gate-wallet login --google     # Google OAuth 登录
gate-wallet balance            # 查询余额
gate-wallet gas SOL            # 查询 Gas
```

### 交互模式

```bash
gate-wallet
```

```
Gate Wallet CLI - Interactive Mode
Type 'login' to start, 'help' for all commands, 'exit' to quit.

gate-wallet> login
gate-wallet> balance
gate-wallet> exit
```

登录成功后 token 自动保存到 `~/.gate-wallet/auth.json`，下次启动无需重复登录，30 天有效。

## 配置

所有配置和凭证存储在用户目录下的 `~/.gate-wallet/` 中：

```
~/.gate-wallet/
├── auth.json       # OAuth token（自动生成）
├── openapi.json    # OpenAPI AK/SK 凭证
└── .env            # 环境变量（可选，如 MCP_URL）
```

### 环境变量

可通过 `~/.gate-wallet/.env` 配置 MCP Server 地址：

```bash
# 默认使用生产环境，如需切换：
MCP_URL=https://wallet-service-mcp-test.gateweb3.cc/mcp
```

也可通过系统环境变量设置，系统环境变量优先级更高。

### OAuth 登录凭证

登录后自动保存，无需手动配置。

### OpenAPI AK/SK

CLI 集成了 Gate DEX OpenAPI，用于免登录查询（报价、Gas、排行、安全审计等）。配置文件：

```
~/.gate-wallet/openapi.json  # AK/SK 凭证
```

**首次使用 `openapi-*` 命令前需先配置 AK/SK**，否则会提示未配置。前往 [Gate DEX Developer](https://www.gatedex.com/developer) 创建 AK/SK。

#### 双通道架构

OpenAPI 分为两个通道，可独立配置 AK/SK 和 endpoint：

| 通道    | 用途                                                      | CLI 参数                            |
| ------- | --------------------------------------------------------- | ----------------------------------- |
| `trade` | Swap 交易（`trade.swap.*`）                               | `--set-ak` / `--set-sk`             |
| `query` | 代币查询 / 行情 / 安全审计（`base.token.*` / `market.*`） | `--set-query-ak` / `--set-query-sk` |

#### 配置方式

**方式一：CLI 命令**

```bash
# 设置 Trade 通道（Swap 交易）
gate-wallet openapi-config --set-ak YOUR_TRADE_AK --set-sk YOUR_TRADE_SK

# 设置 Query 通道（查询行情/代币）
gate-wallet openapi-config --set-query-ak YOUR_QUERY_AK --set-query-sk YOUR_QUERY_SK

# 查看当前配置
gate-wallet openapi-config
```

**方式二：直接编辑 `~/.gate-wallet/openapi.json`**

```json
{
  "trade": {
    "api_key": "YOUR_TRADE_AK",
    "secret_key": "YOUR_TRADE_SK"
  },
  "query": {
    "api_key": "YOUR_QUERY_AK",
    "secret_key": "YOUR_QUERY_SK"
  },
  "default_slippage": 0.03,
  "default_slippage_type": 1
}
```

- `trade` 和 `query` 可使用相同或不同的 AK/SK
- 每个通道可选配 `endpoint` 字段，指定独立的 API 地址
- 未配置 `endpoint` 时默认使用生产环境 `https://openapi.gateweb3.cc/api/v1/dex`

## 登录 / 登出

```bash
# Gate OAuth 登录（默认，浏览器授权）
gate-wallet login

# Google OAuth 登录
gate-wallet login --google

# 查看登录状态
gate-wallet status

# 登出
gate-wallet logout
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

### OpenAPI 命令（免登录）

#### 配置

| 命令             | 说明                   |
| ---------------- | ---------------------- |
| `openapi-config` | 查看 / 更新 AK/SK 配置 |
| `openapi-chains` | 查询支持的链列表       |
| `openapi-gas`    | 查询 Gas 费用          |

#### 代币查询

| 命令                    | 说明                 |
| ----------------------- | -------------------- |
| `openapi-token-rank`    | 代币涨跌幅排行榜     |
| `openapi-token-risk`    | 代币安全审计         |
| `openapi-swap-tokens`   | 可兑换代币列表       |
| `openapi-new-tokens`    | 按时间筛选新上线代币 |
| `openapi-bridge-tokens` | 跨链桥目标代币       |

#### 行情数据

| 命令                | 说明         |
| ------------------- | ------------ |
| `openapi-volume`    | 交易量统计   |
| `openapi-liquidity` | 流动性池事件 |

#### Swap 交易

| 命令            | 说明           |
| --------------- | -------------- |
| `openapi-quote` | 获取 Swap 报价 |

#### 调试

| 命令            | 说明                        |
| --------------- | --------------------------- |
| `openapi-debug` | 直接调用任意 OpenAPI action |

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

## AI Agent 集成

本项目提供了 `SKILL.md` 文件，包含完整的 Agent 使用指南（命令参考、工作流、安全规则等）。安装后通过 `gate-wallet skill` 命令管理。

### 查看 Skill 信息

```bash
gate-wallet skill              # 显示使用说明
gate-wallet skill --path       # 输出 SKILL.md 绝对路径
gate-wallet skill --print      # 输出 SKILL.md 内容
```

### 安装到 AI IDE

根据你使用的 IDE / Agent 选择对应方式：

**Cursor IDE**

```bash
gate-wallet skill --install ~/.cursor/skills/gate-wallet-cli
```

安装后 Cursor Agent 会自动发现并使用该 Skill。

**Claude Desktop / Windsurf / 其他 AI IDE**

```bash
# 复制到当前项目目录
gate-wallet skill --install ./

# 或复制到任意你希望的位置
gate-wallet skill --install ~/my-skills/gate-wallet
```

然后在对应 IDE 的配置中指向该文件路径即可。

**直接引用（无需复制）**

也可以让 Agent 直接读取全局安装包中的 SKILL.md：

```bash
# 获取路径，然后告诉 Agent 读取这个文件
gate-wallet skill --path
```
