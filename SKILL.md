---
name: gate-wallet-cli
version: "1.5.0"
updated: "2026-03-10"
description: "Gate Web3 wallet CLI with dual-channel architecture: MCP protocol (OAuth + custodial signing) for full wallet operations, and Gate DEX OpenAPI (AK/SK auth) for login-free queries. Use when the user asks about wallet balance, token transfers, swaps, market data, token security, or approvals on supported chains (ETH, SOL, BSC, Base, ARB, etc.)."
---

# Gate Wallet CLI

Dual-channel Gate Web3 wallet CLI:

- **MCP channel**: OAuth login → server-side custodial signing → full wallet features (balance / transfer / swap / approve)
- **OpenAPI channel**: AK/SK auth → login-free queries (quotes / gas / rankings / audits / market data)

## Quick Start

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli

# MCP channel (requires login)
pnpm cli login
pnpm cli balance
pnpm cli send --chain ETH --to 0x... --amount 0.01

# OpenAPI channel (no login required)
pnpm cli openapi-token-rank --chain eth --limit 10
pnpm cli openapi-volume --chain eth --address 0x...
pnpm cli openapi-quote --chain eth --from - --to 0xdAC1... --amount 0.01 --wallet 0x...

# Interactive REPL mode
pnpm cli
```

## Channel Selection Strategy

Agent should automatically select the appropriate channel:

| Scenario                                                      | Channel         | Reason                              |
| ------------------------------------------------------------- | --------------- | ----------------------------------- |
| Wallet operations (balance / address / transfer / sign)       | MCP             | OpenAPI does not support wallet ops |
| Full swap (with signing)                                      | MCP `swap`      | One-shot Quote→Build→Sign→Submit    |
| Read-only queries (quotes / gas / rankings / audits / market) | OpenAPI first   | No login needed, lighter weight     |
| OpenAPI fails or unavailable                                  | Fallback to MCP | MCP also supports query tools       |
| Token approval (approve / revoke)                             | MCP             | Requires signing                    |

**Core principle**: Use OpenAPI for any login-free query. Use MCP for anything involving wallet, signing, or fund movements.

---

## Credential Storage

All credentials are stored in `<project_root>/.gate-wallet/` (gitignored):

| File                        | Content                        | Created by                                                        |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `.gate-wallet/auth.json`    | OAuth `mcp_token` (30-day TTL) | `login` command (auto)                                            |
| `.gate-wallet/openapi.json` | AK/SK credentials              | `openapi-config --set-ak <ak> --set-sk <sk>` (manual setup required) |

---

## Cursor Agent Usage

Agent should use **single-command mode** — each command runs independently and exits:

```bash
pnpm cli balance
pnpm cli gas ETH
pnpm cli openapi-token-rank --chain eth
pnpm cli call wallet.get_addresses
```

### Login Flow (first time / token expired)

Triggered when any command returns `Not logged in. Run: login` or `.gate-wallet/auth.json` is missing:

1. **Start login in background** (`block_until_ms: 0`, `required_permissions: ["all"]`):

```bash
cd /Users/juice/Documents/gate-project/gate-wallet-cli && pnpm cli login
# For Google: pnpm cli login --google
```

2. **Browser auto-opens** the authorization page
3. **Poll terminal output** — wait 10-15s, then read terminal file for keywords:
   - `login successful` → proceed with subsequent commands
   - `Waiting for authorization` → user hasn't authorized yet, keep polling (every 10s, max 120s)
   - `Login failed` / `Login timed out` → prompt user to retry
4. **On success**: token auto-saved to `.gate-wallet/auth.json`

> **Important**: Never use `block_until_ms` to block-wait for login. Always use background mode + terminal file polling.

### MCP Tool Call Fallback Strategy

**Level 1 — CLI shortcut commands** (preferred, auto-handles auth):

```bash
pnpm cli balance
pnpm cli send --chain ETH --to 0x... --amount 0.1
```

**Level 2 — CLI `call` generic invocation** (when no shortcut exists):

```bash
pnpm cli call wallet.get_addresses
pnpm cli call tx.gas '{"chain":"SOL","from":"BTYz..."}'
```

**Level 3 — MCP JSON-RPC** (when Level 2 returns 401):

> The CLI `call` subcommand does not guarantee auto-injection of `mcp_token` for all tools. On any 401, fall back to raw JSON-RPC, reading `mcp_token` from `.gate-wallet/auth.json`.

```bash
# 1. Initialize (get session-id, reusable until timeout)
curl -s -D- -X POST {MCP_URL} \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: mcp_ak_demo' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"gate-wallet-cli","version":"1.0.0"}}}'

# 2. Call tool (extract mcp-session-id from response headers)
curl -s -X POST {MCP_URL} \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: mcp_ak_demo' \
  -H 'mcp-session-id: {session_id}' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"{tool_name}","arguments":{"mcp_token":"{mcp_token}", ...}}}'
```

- Same session can call multiple tools without re-initializing
- `result.content[0].text` is a JSON string — requires double `JSON.parse`
- Session timeout returns "Invalid session ID" — re-initialize

### Fallback: REST API Manual Login

Only when `pnpm cli login` is unavailable (e.g. deps broken):

1. Read `MCP_URL` from `.env`, strip `/mcp` to get `baseUrl`
2. `curl -s -X POST {baseUrl}/oauth/gate/device/start -H 'Content-Type: application/json' -d '{}'`
3. Open returned `verification_url` with `open` (macOS), prompt user to authorize in browser
4. Poll `{baseUrl}/oauth/gate/device/poll` every 5s until `status: "ok"`
5. Extract `mcp_token`, write to `.gate-wallet/auth.json`

---

## MCP Channel Commands

### Authentication

| Command          | Description                  |
| ---------------- | ---------------------------- |
| `login`          | Gate OAuth login (default)   |
| `login --google` | Google OAuth login           |
| `status`         | Check current auth status    |
| `logout`         | Logout and clear local token |

### Wallet Queries

| Command   | Description                            |
| --------- | -------------------------------------- |
| `balance` | Total asset value (USD)                |
| `address` | Wallet addresses per chain (EVM / SOL) |
| `tokens`  | Token list with balances               |

### Transfers

| Command                                                              | Description                                    |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `send --chain <chain> --to <addr> --amount <n> [--token <contract>]` | One-shot transfer (preview → sign → broadcast) |
| `transfer --chain <chain> --to <addr> --amount <n>`                  | Preview only (no execution)                    |
| `gas [chain]`                                                        | Gas fee estimation                             |
| `sol-tx --to <addr> --amount <n> [--mint <token>]`                   | Build SOL unsigned tx                          |
| `sign-tx <raw_tx>`                                                   | Sign raw transaction (server-side)             |
| `send-tx --chain <chain> --hex <signed_tx> --to <addr>`              | Broadcast signed tx                            |
| `tx-detail <tx_hash>`                                                | Transaction details                            |
| `tx-history [--page <n>] [--limit <n>]`                              | Transaction history                            |

### Token Approval

Via MCP tool `tx.approve_preview`:

| Scenario          | amount        | action     | Returns             |
| ----------------- | ------------- | ---------- | ------------------- |
| Exact approve     | `"100"`       | omit       | `approve`           |
| Unlimited approve | `"unlimited"` | omit       | `approve_unlimited` |
| Revoke (EVM)      | `"0"`         | omit       | `revoke`            |
| Revoke (Solana)   | `"0"`         | `"revoke"` | `revoke`            |

EVM params: `owner`, `spender`, `amount`, `token_contract`, `token_decimals`, `chain`
Solana params: `owner`, `spender`(=delegate), `amount`, `token_mint`, `token_decimals`, `chain`="SOL"

### Swap

| Command                                                                            | Description                             |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| `quote --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>` | Get swap quote                          |
| `swap --from-chain <id> --to-chain <id> --from <token> --to <token> --amount <n>`  | One-shot swap (Quote→Build→Sign→Submit) |
| `swap-detail <order_id>`                                                           | Swap order details                      |
| `swap-history [--page <n>] [--limit <n>]`                                          | Swap/bridge history                     |

Extra options: `--slippage <pct>` · `--native-in <0|1>` · `--native-out <0|1>` · `--wallet <addr>` · `--to-wallet <addr>`

### Market Data & Token Queries

| Command                                                      | Description                    |
| ------------------------------------------------------------ | ------------------------------ |
| `kline --chain <chain> --address <addr>`                     | K-line / candlestick data      |
| `liquidity --chain <chain> --address <addr>`                 | Liquidity pool events          |
| `tx-stats --chain <chain> --address <addr>`                  | Trading volume stats           |
| `swap-tokens [--chain <chain>] [--search <keyword>]`         | Swappable token list           |
| `bridge-tokens [--src-chain <chain>] [--dest-chain <chain>]` | Cross-chain bridge tokens      |
| `token-info --chain <chain> --address <addr>`                | Token details (price / mcap)   |
| `token-risk --chain <chain> --address <addr>`                | Security audit                 |
| `token-rank [--chain <chain>] [--limit <n>]`                 | Price change rankings          |
| `new-tokens [--chain <chain>] [--start <RFC3339>]`           | Filter tokens by creation time |

### Chain / RPC / Debug

| Command                                                     | Description                |
| ----------------------------------------------------------- | -------------------------- |
| `chain-config [chain]`                                      | Chain configuration        |
| `rpc --chain <chain> --method <method> [--params '<json>']` | JSON-RPC call              |
| `tools`                                                     | List all MCP tools         |
| `call <tool> [json]`                                        | Call any MCP tool directly |

---

## OpenAPI Channel Commands

No OAuth login required. Uses AK/SK (HMAC-SHA256 signing) authentication.

### Configuration

| Command                                      | Description        |
| -------------------------------------------- | ------------------ |
| `openapi-config`                             | View AK/SK config  |
| `openapi-config --set-ak <ak> --set-sk <sk>` | Update credentials |

OpenAPI requires AK/SK credentials. Obtain them at [Gate DEX Developer](https://www.gatedex.com/developer) and configure before use.

### Swap Trading

| Command                                                                                  | Description            |
| ---------------------------------------------------------------------------------------- | ---------------------- |
| `openapi-chains`                                                                         | List supported chains  |
| `openapi-gas --chain <chain>`                                                            | Gas price              |
| `openapi-quote --chain <chain> --from <token> --to <token> --amount <n> --wallet <addr>` | Swap quote             |
| `openapi-build --chain <chain> --from <token> --to <token> --amount <n> --wallet <addr>` | Build unsigned tx      |
| `openapi-approve --wallet <addr> --amount <n> --quote-id <id>`                           | ERC20 approve calldata |
| `openapi-submit --order-id <id> --signed-tx <json>`                                      | Submit signed tx       |
| `openapi-status --chain <chain> --order-id <id>`                                         | Order status           |
| `openapi-history --wallet <addr>`                                                        | Swap history           |

### Token Queries

| Command                                                                             | Description                 |
| ----------------------------------------------------------------------------------- | --------------------------- |
| `openapi-swap-tokens [--chain <chain>] [--search <keyword>]`                        | Swappable token list        |
| `openapi-token-rank [--chain <chain>] [--sort <field>] [--limit <n>]`               | Token rankings              |
| `openapi-new-tokens --start <RFC3339> [--chain <chain>]`                            | New tokens by creation time |
| `openapi-token-risk --chain <chain> --address <addr>`                               | Token security audit        |
| `openapi-bridge-tokens --src-chain <chain> --src-token <addr> --dest-chain <chain>` | Bridge tokens               |

### Market Data

| Command                                              | Description                 |
| ---------------------------------------------------- | --------------------------- |
| `openapi-volume --chain <chain> --address <addr>`    | Volume stats (5m/1h/4h/24h) |
| `openapi-liquidity --chain <chain> --address <addr>` | Liquidity pool events       |

### Debug

| Command                        | Description                      |
| ------------------------------ | -------------------------------- |
| `openapi-call <action> [json]` | Call any OpenAPI action directly |

### Hybrid Swap Flow (OpenAPI + MCP signing)

When using OpenAPI for the swap flow but needing MCP for signing:

```
1. openapi-quote   → get quote (quote_id)
2. openapi-build   → build unsigned tx (unsigned_tx, order_id)
3. MCP sign-tx     → server-side signing
4. openapi-submit  → submit signed tx
5. openapi-status  → poll order status
```

### OpenAPI Chain Name Mapping

`--chain` accepts chain names or numeric chain_id:

| Name      | chain_id | Alias     |
| --------- | -------- | --------- |
| eth       | 1        | ethereum  |
| bsc       | 56       | -         |
| sol       | 501      | solana    |
| arb       | 42161    | arbitrum  |
| base      | 8453     | -         |
| op        | 10       | optimism  |
| polygon   | 137      | -         |
| avax      | 43114    | avalanche |
| linea     | 59144    | -         |
| zksync    | 324      | -         |
| tron      | 195      | trx       |
| sui       | 101      | -         |
| ton       | 607      | -         |
| gatelayer | 10088    | -         |

### OpenAPI Error Codes

| Code        | Meaning                | Action                                 |
| ----------- | ---------------------- | -------------------------------------- |
| 10008       | Signature mismatch     | Check SK                               |
| 10101       | Timestamp expired      | Check system clock                     |
| 10103       | Auth failed            | Update AK/SK via `openapi-config`      |
| 10131-10133 | Rate limited           | Wait and retry, or upgrade credentials |
| 31104       | Trading pair not found | Verify token contract address          |
| 31501       | Insufficient balance   | Check balance                          |

---

## Domain Knowledge

### Authentication Model

- **MCP**: Gate/Google OAuth → `mcp_token` stored in `.gate-wallet/auth.json` (30-day TTL)
- **OpenAPI**: AK/SK stored in `.gate-wallet/openapi.json` (permanent, no login needed)

### Custodial Wallet Architecture

```
OAuth login → mcp_token saved locally → server-side signing → on-chain broadcast
```

Users never handle private keys or mnemonics. `sign-tx` is server-side signing.

### Amount Format

All amount parameters use **human-readable values**, NOT chain-native smallest units.

| ✅ Correct               | ❌ Wrong                            |
| ------------------------ | ----------------------------------- |
| `--amount 0.1` (0.1 ETH) | `--amount 100000000000000000` (wei) |
| `--amount 1` (1 SOL)     | `--amount 1000000000` (lamports)    |

### Native Token Handling

In swap operations, native tokens (ETH/SOL/BNB) use `-` as address, and require `--native-in 1` or `--native-out 1`.

### Common Stablecoin Addresses

| Chain    | USDT                                           | USDC                                           |
| -------- | ---------------------------------------------- | ---------------------------------------------- |
| Ethereum | `0xdAC17F958D2ee523a2206206994597C13D831ec7`   | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`   |
| BSC      | `0x55d398326f99059fF775485246999027B3197955`   | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`   |
| Arbitrum | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`   | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`   |
| Solana   | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

Use `token-info` or `openapi-swap-tokens --search <symbol>` to look up other token addresses.

### Chain Identifiers

| Chain     | Chain ID | CLI Param |
| --------- | -------- | --------- |
| Ethereum  | 1        | ETH       |
| BSC       | 56       | BSC       |
| Polygon   | 137      | POLYGON   |
| Arbitrum  | 42161    | ARB       |
| Base      | 8453     | BASE      |
| Optimism  | 10       | OP        |
| Avalanche | 43114    | AVAX      |
| Solana    | 501      | SOL       |

Chain names are case-insensitive. Swap commands use Chain ID; other commands use CLI param name.

---

## On-Chain Operation Flow

All fund-moving operations follow a unified **preview → confirm → execute** pattern:

1. **Pre-check**: `address` to get correct chain address → `balance`/`tokens` to confirm sufficient funds (including gas)
2. **Preview**: `transfer` (transfer) / `tx.approve_preview` (approval) / `quote` (swap)
3. **User confirmation**: Display key details, wait for explicit user approval
4. **Sign + broadcast**: `sign-tx` → `send-tx` / or `send`/`swap` one-shot commands
5. **Verify**: `tx-detail <hash>` / `swap-detail <order_id>`

> **⚠️ NEVER execute signing without user confirmation.**

### Address Format Validation

| Chain Type            | Format                                   | Example                                        |
| --------------------- | ---------------------------------------- | ---------------------------------------------- |
| EVM (ETH/BSC/ARB/...) | `0x` + 40 hex chars                      | `0xdb918f36a1c282a042758b544c64ae5a1d5767a2`   |
| Solana                | Base58 (32-44 chars, no `0`/`O`/`I`/`l`) | `BTYzBJ5N7L9exV4UAvHnPhfmovz4tmbVvagar4U7bfxE` |

EVM and Solana addresses are NOT interchangeable. Always call `address` first to get the correct chain-specific address.

---

## Typical Workflows

### Token Research (OpenAPI first, no login)

```
openapi-token-rank --chain eth --limit 10        # Top gainers
openapi-token-risk --chain eth --address 0x...    # Security audit
openapi-volume --chain eth --address 0x...        # Trading volume
openapi-liquidity --chain eth --address 0x...     # Liquidity events
token-info --chain eth --address 0x...            # Full details (MCP, requires login)
kline --chain eth --address 0x... --period 1h     # K-line chart (MCP, requires login)
```

### Safe Transfer (MCP)

```
balance                                    # Confirm sufficient funds
gas ETH                                    # Estimate gas
transfer --chain ETH --to 0x... --amount 0.1  # Preview (dry run)
send --chain ETH --to 0x... --amount 0.1      # Execute after confirmation
tx-detail <hash>                           # Verify on-chain
```

### Swap (MCP one-shot)

```
quote --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0
swap --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0 --slippage 0.5
swap-detail <order_id>
```

### Quote Comparison (OpenAPI, no login)

```
openapi-quote --chain eth --from - --to 0xdAC1... --amount 0.1 --wallet 0x...
openapi-quote --chain bsc --from - --to 0x55d3... --amount 0.1 --wallet 0x...
```

---

## Common Pitfalls

1. **Not logged in for MCP commands**: All commands except `tools`/`chain-config` require `login` first
2. **CLI `call` returns 401**: Fall back to JSON-RPC (Level 3), manually pass `mcp_token`
3. **Address format mismatch**: EVM uses `0x` hex, Solana uses Base58 — never mix them
4. **Always fetch addresses first**: Call `address` to get real addresses, never guess
5. **Native token in swap**: Use `-` as address AND set `--native-in 1` / `--native-out 1`
6. **Always preview before execute**: All fund operations must be previewed and confirmed
7. **Insufficient balance**: Check balance (including gas) before transfer/swap
8. **Quote / blockhash expiry**: Quote ~30s, Solana blockhash ~90s — re-fetch if stale
9. **Slippage settings**: Stablecoins 0.5-1%, volatile 1-3%, meme 3-5%+
10. **OpenAPI credentials**: Must configure AK/SK before using `openapi-*` commands — no default keys shipped

---

## Safety Rules

- **Confirm before fund operations**: `send`/`swap`/`approve` involve real funds — always confirm target address, amount, token, and chain with user
- **Preview before execute**: Transfer → `transfer` preview, Swap → `quote`, Approval → `approve_preview`
- **Approval safety**: Prefer exact-amount approvals over unlimited; only approve trusted contracts; periodically review and revoke unused approvals
- **Risk audit**: Before trading unfamiliar tokens, run `token-risk` / `openapi-token-risk` and clearly present risk items to user
- **Credential safety**: `.gate-wallet/` is gitignored — credentials never committed to Git
- **Server-side signing**: Users never expose private keys, but must trust Gate custodial service
