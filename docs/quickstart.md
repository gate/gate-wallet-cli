# Quick Start

## Prerequisites

- **Node.js >= 18** — install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org/)

## Install

```bash
# Option 1: npm global install (recommended)
npm install -g gate-wallet-cli

# Option 2: npx (no install)
npx gate-wallet-cli login
```

## Login

```bash
gate-wallet login              # Gate OAuth (opens browser)
gate-wallet login --google     # Google OAuth
gate-wallet status             # check auth status
```

Token is saved to `~/.gate-wallet/auth.json` and valid for 30 days.

## Basic usage

```bash
# Wallet queries
gate-wallet balance            # total asset balance
gate-wallet address            # wallet addresses (EVM/SOL)
gate-wallet tokens             # token list with balances

# One-click transfer
gate-wallet send --chain ETH --to 0x... --amount 0.0001
gate-wallet send --chain SOL --to <address> --amount 0.001

# Swap (ETH → USDT)
gate-wallet swap --from-chain 1 --from - --to 0xdAC17F958D2ee523a2206206994597C13D831ec7 --amount 0.01 --native-in 1

# Gas fees
gate-wallet gas ETH
gate-wallet gas SOL
```

## OpenAPI channel (no login required)

```bash
# Configure AK/SK
gate-wallet openapi-config --set-ak YOUR_AK --set-sk YOUR_SK

# Hybrid Swap (OpenAPI quote/build + MCP signing)
gate-wallet openapi-swap --chain ARB --from - --to 0xFd08... --amount 0.00001

# Market data
gate-wallet openapi-token-rank --chain eth --limit 10
gate-wallet openapi-token-risk --chain eth --address 0x...
```

Get your AK/SK at [Gate DEX Developer](https://www.gatedex.com/developer).

## Interactive REPL

```bash
gate-wallet                    # enter interactive mode
```

```
Gate Wallet CLI - Interactive Mode
Type 'login' to start, 'help' for all commands, 'exit' to quit.

gate-wallet> login
gate-wallet> balance
gate-wallet> exit
```

## Next steps

See the full [README](../README.md) for complete command reference, supported chains, and configuration details.
