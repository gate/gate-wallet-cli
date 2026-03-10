---
name: gate-wallet-cli
version: "1.1.0"
updated: "2026-03-10"
description: "Interact with Gate Web3 custodial wallet via MCP protocol. Supports Gate/Google OAuth login, wallet asset queries, transfers, swap/bridge, market data, token info, security audits, chain config and RPC calls. Use when the user asks about wallet balance, token transfers, swaps, market data, or token security on supported chains (ETH, SOL, BSC, Base, etc.)."
---

# Gate Wallet CLI

MCP 协议驱动的 Gate Web3 托管钱包 CLI。OAuth 登录后即可查资产、转账、Swap、查行情。

## Quick Start

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli

# 单命令模式
pnpm cli login              # 登录（首次）
pnpm cli balance            # 查余额
pnpm cli gas SOL            # 查 Gas

# 交互模式
pnpm cli                    # 进入 REPL
```

登录 token 持久化在 `~/.gate-wallet/auth.json`，30 天有效，无需每次重新登录。

## Cursor Agent 操作方式

### 登录流程（首次 / Token 过期时）

当任意命令返回 `Not logged in. Run: login` 或 `~/.gate-wallet/auth.json` 不存在时，执行以下流程：

1. **后台启动登录命令**（`block_until_ms: 0`，需 `required_permissions: ["all"]`）：

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli && pnpm cli login
# Google 登录: pnpm cli login --google
```

2. **浏览器自动打开**：CLI 会自动调用系统浏览器打开 Gate/Google 授权页面，无需 Agent 手动 `open` URL
3. **自动轮询**：CLI 内置轮询机制（每 5 秒），用户在浏览器完成授权后自动检测并保存 token
4. **监控终端输出**：等待 10~15 秒后读取终端文件，检查是否出现以下关键字：
   - `login successful` → 登录成功，可以继续后续操作
   - `Browser opened` + 仍在 `Waiting for authorization` → 用户尚未授权，继续等待（每 10 秒轮询一次终端文件，最多 120 秒）
   - `Could not open browser` → 浏览器未打开，从终端输出中提取 URL 告知用户手动打开
   - `Login failed` / `Login timed out` → 登录失败，提示用户重试

```
完整成功输出示例：
✔ MCP Server connected
✔ Gate OAuth flow started
  Code: GTDF_XXX
  ✔ Browser opened — please authorize there.
✔ Gate login successful!
  User ID: xxx
  Token saved to /Users/juice/.gate-wallet/auth.json
✔ Wallet addresses reported (2 chains)
```

5. **登录成功后**：Token 自动保存到 `~/.gate-wallet/auth.json`（30 天有效），后续所有命令自动加载

> **重要**：不要使用 `block_until_ms` 阻塞等待登录命令，因为登录耗时取决于用户在浏览器中的操作速度（几秒到几分钟不等）。始终用后台模式 + 轮询终端文件的方式监控。

### 备用方案：REST API 手动登录

仅当 `pnpm cli login` 不可用时（如依赖损坏、编译失败），才使用此方案：

1. 从 `.env` 读取 `MCP_URL`，去掉 `/mcp` 得到 `baseUrl`
2. 发起 device flow（需 `full_network` 权限）：

```bash
curl -s -X POST {baseUrl}/oauth/gate/device/start \
  -H 'Content-Type: application/json' -d '{}'
# Google 登录用: {baseUrl}/oauth/google/device/start
```

3. 用 `open`(macOS) / `xdg-open`(Linux) 打开返回的 `verification_url`（需 `required_permissions: ["all"]`），提示用户在浏览器授权
4. 每隔 `interval` 秒轮询，直到 `status: "ok"`：

```bash
curl -s -X POST {baseUrl}/oauth/gate/device/poll \
  -H 'Content-Type: application/json' \
  -d '{"flow_id":"{flow_id}"}'
```

5. 从响应提取 `mcp_token`，手动写入 `~/.gate-wallet/auth.json`：

```json
{
  "mcp_token": "{mcp_token}",
  "provider": "gate",
  "user_id": "{user_id}",
  "expires_at": {now_ms + expires_in * 1000},
  "env": "default",
  "server_url": "{MCP_URL}"
}
```

### 执行命令

Agent 直接使用**单命令模式**，每条命令独立执行并自动退出：

```bash
pnpm cli balance
pnpm cli gas ETH
pnpm cli call wallet.get_addresses
pnpm cli call tx.gas '{"chain":"SOL","from":"BTYz...","to":"So111...","data":"AQAA..."}'
```

- 登录 token 从 `~/.gate-wallet/auth.json` 自动加载，无需手动管理
- 如果 token 过期或不存在，命令会返回 `Not logged in. Run: login`，按上述登录流程处理

### MCP JSON-RPC 调用

```bash
# 1. Initialize（获取 session-id）
curl -s -D- -X POST {MCP_URL} \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: mcp_ak_demo' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"gate-wallet-cli","version":"1.0.0"}}}'

# 2. 调用 Tool（从响应头取 mcp-session-id）
curl -s -X POST {MCP_URL} \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: mcp_ak_demo' \
  -H 'mcp-session-id: {session_id}' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"{tool_name}","arguments":{"mcp_token":"{mcp_token}", ...}}}'
```

- 响应中 `result.content[0].text` 是 JSON 字符串，需二次 `JSON.parse`
- session 超时返回 "Invalid session ID"，需重新 initialize

---

## Domain Knowledge

### 认证模型

- 通过 Gate OAuth 或 Google OAuth 登录，获取 `mcp_token`
- Token 持久化存储在 `~/.gate-wallet/auth.json`，30 天有效
- 所有需认证的命令（除 `tools`/`chain-config` 外）自动从本地加载 token
- 登录后自动获取 EVM 和 SOL 两条链的钱包地址并上报

### 托管钱包架构

签名由服务端完成（非本地私钥），安全模型为：

```
OAuth 登录 → mcp_token 存本地 → 服务端代签 → 链上广播
```

用户无需管理私钥/助记词。`sign-tx` 为服务端签名。

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
| `logout`         | 登出并清除本地 token                |

### 钱包查询

| 命令               | 说明                      |
| ------------------ | ------------------------- |
| `balance`          | 总资产余额（USD 计价）    |
| `address`          | 各链钱包地址（EVM / SOL） |
| `tokens`           | Token 列表和余额          |
| `sign-tx <raw_tx>` | 签名原始交易              |

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

1. **未登录就操作**：除 `tools` / `chain-config` 外，所有命令需先 `login`。Agent 收到 `Not logged in` 时应自动触发登录流程（见上方"登录流程"），而非让用户手动操作
2. **原生代币地址**：Swap 中 ETH/SOL/BNB 等原生代币用 `-`，不是合约地址
3. **native-in/out 忘记设置**：原生代币必须设 `--native-in 1` 或 `--native-out 1`，否则 Swap 会失败
4. **报价过期**：`quote` 结果有时效性，超过 ~30s 价格可能变动，建议立即执行或重新报价
5. **余额不足**：转账/Swap 前用 `balance` 和 `tokens` 确认余额（含 Gas 费）
6. **SOL 转账需刷新 blockhash**：`send` 命令已自动处理，手动 `sign-tx` + `send-tx` 时注意 blockhash 时效
7. **滑点设置**：小额交易建议 `--slippage 0.5`（5%）到 `--slippage 1`（10%），大额交易适当降低

---

## Safety Rules

- **资金操作确认**：`send` / `swap` 涉及真实资金，执行前必须向用户确认目标地址、金额、代币、链
- **先预览再执行**：转账建议先 `transfer` 预览，Swap 建议先 `quote` 报价
- **风险审计**：交易不熟悉的代币前，先 `token-risk` 检查安全性，清晰展示风险项
- **Token 持久化**：认证 token 存储在 `~/.gate-wallet/auth.json`，`logout` 命令会清除
- **签名由服务端完成**：用户无需暴露私钥，但需信任 Gate 托管服务
