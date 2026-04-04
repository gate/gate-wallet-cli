# Gate Wallet CLI

A command-line interface for [Gate](https://gate.com) Web3 wallet. Supports MCP and OpenAPI dual channels — balance queries, transfers, Swap, market data, and token analytics. Designed for developers, quants, and AI agents.

## Quick Start

- [English Quick Start](docs/quickstart.md)
- [中文快速上手](docs/quickstart_zh.md)

## Features

- **Dual Channel** — MCP (OAuth + custodial signing) and OpenAPI (AK/SK + self-custody signing)
- **Hybrid Swap** — OpenAPI quotes/builds + MCP signs, no private key needed
- **Multi-chain** — EVM chains (Ethereum, BSC, Arbitrum, Base, Polygon, etc.) and Solana
- **Wallet** — balance, addresses, tokens, one-click transfers (preview→sign→broadcast)
- **Swap** — full lifecycle: quote → build → sign → submit → status tracking
- **Market data** — K-line, liquidity, trade volume, token rankings, security audits
- **Two modes** — single-command or interactive REPL with persistent session
- **AI Agent ready** — structured output for scripting and agent integration

## Installation

### npm global install (recommended)

```bash
npm install -g gate-wallet-cli
gate-wallet login
```

### npx (no install)

```bash
npx gate-wallet-cli login
npx gate-wallet-cli balance
```

### From source

```bash
git clone <repo-url>
cd gate-wallet-cli/cli
pnpm install
pnpm cli login
```

## Configuration

```bash
# MCP channel: OAuth login (token saved to ~/.gate-wallet/auth.json, 30-day expiry)
gate-wallet login              # Gate OAuth
gate-wallet login --google     # Google OAuth

# OpenAPI channel: AK/SK config
gate-wallet openapi-config --set-ak YOUR_AK --set-sk YOUR_SK
```

Or configure manually:

| Path                              | Purpose                      |
| --------------------------------- | ---------------------------- |
| `~/.gate-wallet/auth.json`        | OAuth token (auto-generated) |
| `~/.gate-dex-openapi/config.json` | OpenAPI AK/SK credentials    |

Create your AK/SK at [Gate Web3 API Management](https://web3.gate.com/zh/api-manage).

## Usage examples

```bash
# Auth
gate-wallet login
gate-wallet status
gate-wallet logout

# Wallet queries
gate-wallet balance
gate-wallet address
gate-wallet tokens

# One-click transfer
gate-wallet send --chain ETH --to 0x... --amount 0.0001
gate-wallet send --chain SOL --to <address> --amount 0.001
gate-wallet send --chain ETH --to 0x... --amount 1 --token 0xdAC17F...   # ERC20

# MCP Swap
gate-wallet swap --from-chain 1 --from - --to 0xdAC17F... --amount 0.01 --native-in 1
gate-wallet swap-detail <order_id>

# Hybrid Swap (OpenAPI + MCP signing)
gate-wallet openapi-swap --chain ARB --from - --to 0xFd08... --amount 0.00001

# Market data
gate-wallet kline --chain eth --address 0x...
gate-wallet token-rank --chain eth --limit 10
gate-wallet token-risk --chain eth --address 0x...

# Interactive REPL
gate-wallet
```

## Command reference

### Auth & Wallet

| Command            | Description                  |
| ------------------ | ---------------------------- |
| `login [--google]` | OAuth login (Gate or Google) |
| `status`           | Auth status & token expiry   |
| `logout`           | Clear token                  |
| `balance`          | Total asset balance          |
| `address`          | Wallet addresses (EVM/SOL)   |
| `tokens`           | Token list with balances     |

### Transfer

| Command                                                   | Description                                 |
| --------------------------------------------------------- | ------------------------------------------- |
| `send --chain <c> --to <addr> --amount <n>`               | One-click transfer (preview→sign→broadcast) |
| `gas [chain]`                                             | Gas fees                                    |
| `transfer --chain <c> --to <addr> --amount <n>`           | Transfer preview only                       |
| `sign-msg <32-hex>`                                       | Sign message                                |
| `sign-tx <raw_tx>`                                        | Sign raw transaction                        |
| `send-tx --chain <c> --hex <tx> --to <addr> --amount <n>` | Broadcast signed tx                         |
| `tx-detail <tx_hash>`                                     | Transaction details                         |
| `tx-history [--limit N]`                                  | Transaction history                         |

### Swap (MCP)

| Command                                                          | Description              |
| ---------------------------------------------------------------- | ------------------------ |
| `quote --from-chain <id> --from <addr> --to <addr> --amount <n>` | Get swap quote           |
| `swap --from-chain <id> --from <addr> --to <addr> --amount <n>`  | One-click swap           |
| `swap-detail <order_id>`                                         | Swap transaction details |
| `swap-history [--limit N]`                                       | Swap/bridge history      |

### Swap (OpenAPI / Hybrid)

| Command                                                                            | Description                         |
| ---------------------------------------------------------------------------------- | ----------------------------------- |
| `openapi-swap --chain <c> --from <addr> --to <addr> --amount <n>`                  | Hybrid swap (OpenAPI + MCP signing) |
| `openapi-chains`                                                                   | Supported chains                    |
| `openapi-gas --chain <c>`                                                          | Gas prices                          |
| `openapi-quote --chain <c> --from <addr> --to <addr> --amount <n> --wallet <addr>` | Get quote                           |
| `openapi-build ...`                                                                | Build unsigned tx                   |
| `openapi-approve --wallet <addr> --amount <n> --quote-id <id>`                     | ERC20 approve calldata              |
| `openapi-submit --order-id <id> --signed-tx '["0x..."]'`                           | Submit signed tx                    |
| `openapi-status --chain <c> --order-id <id>`                                       | Swap order status                   |
| `openapi-history --wallet <addr>`                                                  | Swap history                        |

### OpenAPI Market & Token

| Command                                                                     | Description                 |
| --------------------------------------------------------------------------- | --------------------------- |
| `openapi-swap-tokens --chain <c> [--search <q>]`                            | Swappable tokens            |
| `openapi-token-rank --chain <c> [--limit N]`                                | Top gainers/losers (24h)    |
| `openapi-new-tokens --chain <c> --start <ISO>`                              | New tokens by creation time |
| `openapi-token-risk --chain <c> --address <addr>`                           | Token security audit        |
| `openapi-bridge-tokens --src-chain <c> --src-token <addr> --dest-chain <c>` | Cross-chain bridge targets  |
| `openapi-volume --chain <c> --address <addr>`                               | Trade volume (5m/1h/4h/24h) |
| `openapi-liquidity --chain <c> --address <addr>`                            | Liquidity pool events       |

### Market & Token (MCP)

| Command                                          | Description                      |
| ------------------------------------------------ | -------------------------------- |
| `kline --chain <c> --address <addr>`             | K-line data                      |
| `liquidity --chain <c> --address <addr>`         | Liquidity pool events            |
| `tx-stats --chain <c> --address <addr>`          | Trade volume (5m/1h/4h/24h)      |
| `token-info --chain <c> --address <addr>`        | Token details (price/market cap) |
| `token-risk --chain <c> --address <addr>`        | Security audit                   |
| `token-rank --chain <c> [--limit N]`             | Top gainers/losers (24h)         |
| `new-tokens --chain <c> --start <ISO>`           | New tokens by creation time      |
| `swap-tokens --chain <c> [--search <q>]`         | Swappable tokens                 |
| `bridge-tokens --src-chain <c> --dest-chain <c>` | Cross-chain bridge targets       |

### Chain & Advanced

| Command                        | Description             |
| ------------------------------ | ----------------------- |
| `chain-config [chain]`         | Chain configuration     |
| `rpc --chain <c> --method <m>` | JSON-RPC call           |
| `openapi-config`               | View/set AK/SK config   |
| `tools`                        | List all MCP tools      |
| `call <tool> [json]`           | Call MCP tool directly  |
| `openapi-call <action> [json]` | Call any OpenAPI action |

## Swap parameters

| Flag           | Description                              |
| -------------- | ---------------------------------------- |
| `--from-chain` | Source chain ID (ETH=1, BSC=56, SOL=501) |
| `--to-chain`   | Destination chain ID                     |
| `--from`       | Source token address (`-` for native)    |
| `--to`         | Target token address                     |
| `--amount`     | Amount to swap                           |
| `--native-in`  | Source is native coin (1/0)              |
| `--native-out` | Target is native coin (1/0)              |
| `--slippage`   | Slippage tolerance (0.03 = 3%)           |

## Supported chains

| Chain     | Chain ID | Parameter |
| --------- | -------- | --------- |
| Ethereum  | 1        | ETH       |
| BSC       | 56       | BSC       |
| Polygon   | 137      | POLYGON   |
| Arbitrum  | 42161    | ARB       |
| Base      | 8453     | BASE      |
| Optimism  | 10       | OP        |
| Avalanche | 43114    | AVAX      |
| Solana    | 501      | SOL       |
| Fantom    | 250      | FTM       |
| Cronos    | 25       | cronos    |
| Linea     | 59144    | linea     |
| zkSync    | 324      | zksync    |
| Mantle    | 5000     | mantle    |
| GateLayer | 10088    | gatelayer |

## Documentation

| Document                                       | Description               |
| ---------------------------------------------- | ------------------------- |
| [docs/quickstart.md](docs/quickstart.md)       | English quick start guide |
| [docs/quickstart_zh.md](docs/quickstart_zh.md) | 中文快速上手              |

## Tech stack

- **Runtime**: Node.js >= 18 + TypeScript
- **CLI**: Commander.js
- **MCP**: `@modelcontextprotocol/sdk` (custodial signing)
- **Auth**: Google / Gate OAuth 2.0
- **OpenAPI**: HMAC-SHA256 signing, Trade / Query dual channels

## AI Agent integration

> AI Agent Skills have been migrated to **[web3-wallet-skill](https://github.com/gate/gate-skills/tree/master/skills/gate-dex-wallet)** — visit that repo for installation and usage.
