# Gate Wallet CLI

Gate Web3 钱包命令行工具，支持**双通道**：

- **MCP 通道**（默认）：Google / Gate OAuth 登录 → 服务端托管签名 → 钱包全功能（余额 / 转账 / Swap / 授权 / 行情）
- **OpenAPI 通道**（免登录）：AK/SK 认证 → 用户自持私钥签名 → DEX Swap 交易。详见 [gate-dex-trade Skill](../skills/gate-dex-trade/SKILL.md)

Swap 功能两个通道均可完成。用户可指定通道，也可由 Agent 自动选择（已登录优先 MCP，未登录但有 AK/SK 则走 OpenAPI）。

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

所有配置和凭证存储在用户目录下：

```
~/.gate-wallet/
├── auth.json       # OAuth token（自动生成）
└── .env            # 环境变量（可选，如 MCP_URL）

~/.gate-dex-openapi/
└── config.json     # Gate DEX OpenAPI AK/SK 凭证（独立 Skill 使用）
```

### 环境变量

可通过 `~/.gate-wallet/.env` 或系统环境变量配置 MCP Server 地址（`MCP_URL`），不设置时默认连接生产环境。系统环境变量优先级高于 `.env` 文件。

### OAuth 登录凭证

登录后自动保存，无需手动配置。

### Gate DEX OpenAPI（免登录 Swap 交易）

Gate DEX OpenAPI 通过 AK/SK 认证，支持免登录的 Swap 交易功能。同时支持 **Hybrid Swap** 模式：OpenAPI 负责报价/构建/提交，MCP 负责托管签名，无需用户持有私钥。

**与 MCP Swap 的关系**：

| 对比     | MCP Swap           | OpenAPI Swap（Hybrid 模式）                      |
| -------- | ------------------ | ------------------------------------------------ |
| 认证     | OAuth 登录         | AK/SK + OAuth 登录                               |
| 签名     | MCP 服务端托管签名 | OpenAPI 构建交易 + MCP 托管签名                  |
| 额外功能 | —                  | Gas 查询、链列表、自定义手续费接收地址、MEV 保护 |
| 触发方式 | 默认 / "用 MCP"    | "用 openapi" / `openapi-swap` 命令               |

#### 配置管理（推荐方式）

```bash
# 通过 CLI 命令设置 AK/SK（自动验证凭证）
gate-wallet openapi-config --set-ak YOUR_AK --set-sk YOUR_SK

# 查看当前配置（SK 自动脱敏）
gate-wallet openapi-config
```

#### 手动配置

配置文件支持两个路径（优先读取前者）：

| 路径                              | 格式       | 说明                   |
| --------------------------------- | ---------- | ---------------------- |
| `~/.gate-dex-openapi/config.json` | 扁平格式   | Skill / Agent 共享使用 |
| `~/.gate-wallet/openapi.json`     | 双通道格式 | CLI 内部使用           |

扁平格式（`~/.gate-dex-openapi/config.json`）：

```json
{
  "api_key": "YOUR_API_KEY",
  "secret_key": "YOUR_SECRET_KEY",
  "default_slippage": 0.03,
  "default_slippage_type": 1
}
```

| 字段                  | 类型   | 必填 | 说明                           |
| --------------------- | ------ | ---- | ------------------------------ |
| api_key               | string | 是   | API Key                        |
| secret_key            | string | 是   | Secret Key                     |
| default_slippage      | float  | 否   | 默认滑点，0.03 = 3%            |
| default_slippage_type | int    | 否   | 1 = 百分比模式，2 = 固定值模式 |

#### 获取 AK/SK

前往 [Gate DEX Developer](https://www.gatedex.com/developer) 创建专属 AK/SK：

1. 连接钱包注册
2. Settings 绑定邮箱和手机
3. API Key Management 创建密钥

详细说明：[Gate DEX API 文档](https://gateweb3.gitbook.io/gate_dex_api/exploredexapi/en/api-access-and-usage/developer-platform)

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

MCP 通道（需登录，托管签名）：

| 命令                                                     | 说明                                |
| -------------------------------------------------------- | ----------------------------------- |
| `quote --from-chain 1 --from - --to 0x... --amount 0.01` | 获取 Swap 报价                      |
| `swap --from-chain 1 --from - --to 0x... --amount 0.01`  | 一键兑换（Quote→Build→Sign→Submit） |
| `swap-detail <order_id>`                                 | 查询 Swap 交易详情                  |
| `swap-history --limit 3`                                 | Swap / Bridge 历史（支持分页）      |

OpenAPI 通道（免登录，自持私钥签名）也支持完整 Swap 流程，详见 [gate-dex-trade Skill](../skills/gate-dex-trade/SKILL.md)。用户说 "用 openapi swap" 时走 OpenAPI，否则默认走 MCP。

### OpenAPI 通道命令

> 所有 `openapi-*` 命令通过 AK/SK 认证直接调用 Gate DEX OpenAPI，无需 MCP 登录（Hybrid Swap 除外）。

#### 配置管理

| 命令                                         | 说明                               |
| -------------------------------------------- | ---------------------------------- |
| `openapi-config`                             | 查看当前 AK/SK 配置（SK 自动脱敏） |
| `openapi-config --set-ak <ak> --set-sk <sk>` | 设置 Trade 通道 AK/SK 并自动验证   |

#### Swap 交易

| 命令                                                                        | 说明                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| `openapi-swap --chain ARB --from - --to 0xFd08... --amount 0.01`            | **Hybrid Swap**（OpenAPI 报价构建 + MCP 托管签名） |
| `openapi-chains`                                                            | 查询支持的链列表                                   |
| `openapi-gas --chain eth`                                                   | 查询指定链 Gas 价格                                |
| `openapi-quote --chain eth --from - --to 0x... --amount 0.1 --wallet 0x...` | 获取 Swap 报价                                     |
| `openapi-build --chain eth --from - --to 0x... --amount 0.1 --wallet 0x...` | 构建未签名交易（返回 unsigned_tx + order_id）      |
| `openapi-approve --wallet 0x... --amount 0.1 --quote-id <id>`               | 获取 ERC20 approve calldata                        |
| `openapi-submit --order-id <id> --signed-tx '["0x02f8..."]'`                | 提交已签名交易                                     |
| `openapi-status --chain eth --order-id <id>`                                | 查询 Swap 订单状态                                 |
| `openapi-history --wallet 0x...`                                            | 查询 Swap 历史订单                                 |

#### 代币查询

| 命令                                                                       | 说明                 |
| -------------------------------------------------------------------------- | -------------------- |
| `openapi-swap-tokens --chain eth --search USDT`                            | 查询链上可 Swap 代币 |
| `openapi-token-rank --chain eth --limit 10`                                | 代币涨跌幅排行榜     |
| `openapi-new-tokens --start 2026-03-08T00:00:00Z --chain eth`              | 按创建时间筛选新币   |
| `openapi-token-risk --chain eth --address 0x...`                           | 代币安全审计         |
| `openapi-bridge-tokens --src-chain eth --src-token 0x... --dest-chain bsc` | 查询跨链桥目标代币   |

#### 市场行情

| 命令                                            | 说明                       |
| ----------------------------------------------- | -------------------------- |
| `openapi-volume --chain eth --address 0x...`    | 交易量统计（5m/1h/4h/24h） |
| `openapi-liquidity --chain eth --address 0x...` | 流动性池事件               |

#### 通用调用

| 命令                           | 说明                        |
| ------------------------------ | --------------------------- |
| `openapi-call <action> [json]` | 直接调用任意 OpenAPI action |

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
  "account_id": "xxxxxxxx-...",
  "addresses": {
    "EVM": "0x1234...abcd",
    "SOL": "ABCD...XYZ1"
  }
}

gate-wallet> balance
{
  "total_value": "$12.34"
}

gate-wallet> tokens
  ETH   0.005      $10.00
  SOL   0.05       $6.50
  USDT  1.00       $1.00
```

### ETH 一键转账

```
gate-wallet> send --chain ETH --to 0x1234...abcd --amount 0.0001
✔ 预览成功：Transfer 0.0001 ETH from 0xaaaa...bbbb to 0x1234...abcd on ETH
✔ 签名成功
✔ 交易已广播
  Hash: 0xabcdef...
```

### SOL 一键转账

```
gate-wallet> send --chain SOL --to ABCD...XYZ1 --amount 0.001
✔ 预览成功：Transfer 0.001 SOL from AAAA...BBB1 to ABCD...XYZ1 on SOL
✔ 已获取最新 unsigned_tx
✔ 签名成功
✔ 交易已广播
  Hash: 5xYz...
```

### ETH → USDT Swap

```
gate-wallet> swap --from-chain 1 --to-chain 1 --from - --to 0xdAC17F958D2ee523a2206206994597C13D831ec7 --amount 0.0001 --native-in 1 --native-out 0 --slippage 0.1
{
  "status": "submitted",
  "tx_hash": "0xabcdef...",
  "amount_in": "0.0001",
  "amount_out": "0.20",
  "from_token": "ETH",
  "to_token": "USDT"
}

gate-wallet> swap-detail <order_id>
```

### SOL → USDC Swap

```
gate-wallet> swap --from-chain 501 --to-chain 501 --from - --to EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --amount 0.001 --native-in 1 --native-out 0 --slippage 0.1
{
  "status": "submitted",
  "tx_hash": "5xYz...",
  "amount_in": "0.001",
  "amount_out": "0.08",
  "from_token": "SOL",
  "to_token": "USDC"
}
```

### Hybrid Swap (OpenAPI + MCP 托管签名)

使用 OpenAPI 通道报价构建 + MCP 服务端签名，一条命令完成：

```
gate-wallet> openapi-swap --chain ARB --from - --to 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 --amount 0.00001
✔ 钱包: 0xdb918f36a1c282a042758b544c64ae5a1d5767a2

========== Swap 报价 ==========
  卖出: 0.00001 WETH
  买入: ≈ 0.02024 USDT
  最少: 0.019632 USDT
  滑点: 3.0%
  路由: 0x(100%)
===============================

确认执行 Swap? (y/N): y
✔ 交易已提交: 0x8a03c00a...
✔ Swap 成功! 收到 0.020253 USDT
```

流程内部步骤（自动完成）：

| 步骤 | 通道    | 操作                                        |
| ---- | ------- | ------------------------------------------- |
| 1    | MCP     | 获取钱包地址（`wallet.get_addresses`）      |
| 2    | OpenAPI | 获取报价（`trade.swap.quote`）              |
| 3    | OpenAPI | 构建交易（`trade.swap.build`）              |
| 4    | MCP RPC | 获取 nonce + gasPrice（含 20% buffer）      |
| 5    | 本地    | RLP 编码 EIP-1559 unsigned tx               |
| 6    | MCP     | 托管签名（`wallet.sign_transaction`）       |
| 7    | OpenAPI | 提交交易（`trade.swap.submit`）             |
| 8    | OpenAPI | 轮询状态（`trade.swap.status`，每 5s 一次） |

### OpenAPI 查询示例

```
# 查询支持的链
gate-wallet> openapi-chains

# 查询 Arbitrum Gas 价格
gate-wallet> openapi-gas --chain arb

# 查询 ETH 链上 USDT 安全审计
gate-wallet> openapi-token-risk --chain eth --address 0xdAC17F958D2ee523a2206206994597C13D831ec7

# 代币涨跌幅排行榜
gate-wallet> openapi-token-rank --chain eth --limit 5

# 直接调用任意 OpenAPI action
gate-wallet> openapi-call trade.swap.chain '{}'
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

- **Runtime**: Node.js >= 18 + TypeScript
- **CLI Framework**: Commander.js
- **MCP**: `@modelcontextprotocol/sdk` (服务端托管签名)
- **Auth**: Google / Gate OAuth 2.0
- **OpenAPI**: HMAC-SHA256 签名，支持 Trade / Query 双通道

### 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Gate Wallet CLI                       │
├──────────────────────┬──────────────────────────────────┤
│     MCP 通道         │        OpenAPI 通道              │
│  (OAuth + 托管签名)  │     (AK/SK + HMAC 签名)         │
│                      │                                  │
│  balance / address   │  openapi-chains / openapi-gas    │
│  tokens / send       │  openapi-quote / openapi-build   │
│  swap / quote        │  openapi-submit / openapi-status │
│  transfer / gas      │  openapi-token-rank / risk       │
│  kline / liquidity   │  openapi-swap-tokens / volume    │
│                      │                                  │
│        └──── Hybrid Swap (openapi-swap) ────┘           │
│         OpenAPI: quote/build/submit                     │
│         MCP: address + RPC + sign                       │
└─────────────────────────────────────────────────────────┘
```

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
