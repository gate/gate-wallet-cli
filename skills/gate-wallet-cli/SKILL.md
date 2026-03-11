---
name: gate-wallet-cli
version: "1.7.0"
updated: "2026-03-11"
description: "Gate Web3 wallet CLI with dual-channel support: MCP (OAuth + custodial signing) and OpenAPI (AK/SK + self-custody). Use when the user asks about wallet balance, token transfers, swaps, market data, token security, or approvals on supported chains (ETH, SOL, BSC, Base, ARB, etc.)."
---

# Gate Wallet CLI

Gate Web3 wallet CLI with dual-channel support:

- **MCP channel**: OAuth login → server-side custodial signing → full wallet features (balance / transfer / swap / approve / market queries)
- **OpenAPI channel** (login-free, self-custody): AK/SK auth → user-side signing → DEX swap trading. See [gate-dex-trade/SKILL.md](../gate-dex-trade/SKILL.md)

---

## Channel Routing (MUST evaluate first)

This project has two channels that **overlap on Swap functionality**. Agent MUST evaluate which channel to use **before** executing any swap-related operation.

### Routing Rules (in priority order)

**Rule 1 — Explicit user request (highest priority)**

| User says                                                                     | Route to                                                                                    | Reason                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| "用 openapi" / "openapi swap" / "AK/SK" / "直连 API" / "DEX API" / "自己签名" | **OpenAPI channel** → read and follow [gate-dex-trade/SKILL.md](../gate-dex-trade/SKILL.md) | User explicitly chose OpenAPI |
| "用 MCP" / "用钱包" / "托管签名" / "gate-wallet swap"                         | **MCP channel** → continue with this SKILL                                                  | User explicitly chose MCP     |

**Rule 2 — MCP-only operations (no overlap, always MCP)**

These features exist ONLY in MCP. No routing decision needed:

`balance` · `address` · `tokens` · `send` / `transfer` · `approve` / `revoke` · `gas` · `token-info` · `token-risk` · `token-rank` · `kline` · `liquidity` · `tx-stats` · `swap-tokens` · `bridge-tokens` · `new-tokens` · `rpc` · `chain-config` · `tx-detail` · `tx-history`

**Rule 3 — Overlapping Swap operations (agent decides)**

When user requests swap/quote/swap-detail/swap-history WITHOUT specifying a channel:

| Condition                                                                                                     | Preferred channel            | Reason                                                  |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| User is logged in (`~/.gate-wallet/auth.json` exists and valid)                                               | **MCP**                      | Simpler flow, no private key needed, one-shot swap      |
| User is NOT logged in but `~/.gate-dex-openapi/config.json` exists                                            | **OpenAPI**                  | Already has AK/SK configured, can proceed without login |
| User is NOT logged in and no OpenAPI config exists                                                            | **MCP** (prompt login first) | MCP is the default path, guide user to login            |
| User mentions private key / self-custody / fine-grained control                                               | **OpenAPI**                  | OpenAPI allows step-by-step control and self-signing    |
| User needs features only in OpenAPI (custom fee_recipient, MEV protection, gas price query, chain list query) | **OpenAPI**                  | These features don't exist in MCP                       |

> **Hybrid mode**: When OpenAPI is chosen but the user has no local private key (custodial wallet), use **Hybrid Swap**: OpenAPI for quote/build/submit + MCP for signing. See "Hybrid Swap" in Typical Workflows section.

### Overlap Reference

| Function          | MCP Tool             | OpenAPI Actions                          |
| ----------------- | -------------------- | ---------------------------------------- |
| Swap quote        | `tx.quote`           | `trade.swap.quote`                       |
| Execute swap      | `tx.swap` (one-shot) | `quote` → `approve` → `build` → `submit` |
| Swap order detail | `tx.swap_detail`     | `trade.swap.status`                      |
| Swap history      | `tx.history_list`    | `trade.swap.history`                     |

## Quick Start

```bash
gate-wallet login
gate-wallet balance
gate-wallet send --chain ETH --to 0x... --amount 0.01

# Interactive REPL mode
gate-wallet
```

---

## Credential Storage

All credentials are stored in `~/.gate-wallet/` (user home directory):

| File                       | Content                        | Created by             |
| -------------------------- | ------------------------------ | ---------------------- |
| `~/.gate-wallet/auth.json` | OAuth `mcp_token` (30-day TTL) | `login` command (auto) |

---

## Agent Usage

Agent should use **single-command mode** — each command runs independently and exits:

```bash
gate-wallet balance
gate-wallet gas ETH
gate-wallet token-rank --chain eth
gate-wallet call wallet.get_addresses
```

### Login Flow (first time / token expired)

Triggered when any command returns `Not logged in. Run: login` or `~/.gate-wallet/auth.json` is missing:

1. **Start login in background** (non-blocking, let user complete browser auth):

```bash
gate-wallet login
# For Google: gate-wallet login --google
```

2. **Browser auto-opens** the authorization page
3. **Poll terminal output** — wait 10-15s, then read terminal file for keywords:
   - `login successful` → proceed with subsequent commands
   - `Waiting for authorization` → user hasn't authorized yet, keep polling (every 10s, max 120s)
   - `Login failed` / `Login timed out` → prompt user to retry
4. **On success**: token auto-saved to `~/.gate-wallet/auth.json`

> **Important**: Login is interactive (opens browser). Run it in background, then poll terminal output for completion.

### MCP Tool Call Fallback Strategy

**Level 1 — CLI shortcut commands** (preferred, auto-handles auth):

```bash
gate-wallet balance
gate-wallet send --chain ETH --to 0x... --amount 0.1
```

**Level 2 — CLI `call` generic invocation** (when no shortcut exists):

```bash
gate-wallet call wallet.get_addresses
gate-wallet call tx.gas '{"chain":"SOL","from":"BTYz..."}'
```

**Level 3 — MCP JSON-RPC** (when Level 2 returns 401):

> The CLI `call` subcommand does not guarantee auto-injection of `mcp_token` for all tools. On any 401, fall back to raw JSON-RPC, reading `mcp_token` from `~/.gate-wallet/auth.json`.

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

Only when `gate-wallet login` is unavailable (e.g. deps broken):

1. Read `MCP_URL` from `~/.gate-wallet/.env`, strip `/mcp` to get `baseUrl`
2. `curl -s -X POST {baseUrl}/oauth/gate/device/start -H 'Content-Type: application/json' -d '{}'`
3. Open returned `verification_url` with `open` (macOS), prompt user to authorize in browser
4. Poll `{baseUrl}/oauth/gate/device/poll` every 5s until `status: "ok"`
5. Extract `mcp_token`, write to `~/.gate-wallet/auth.json`

---

## Commands

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

| Command                                                                                                                | Description                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `send --chain <chain> --to <addr> --amount <n> [--token <contract>] [--token-decimals <d>] [--token-symbol <sym>]`     | One-shot transfer (preview → sign → broadcast) |
| `transfer --chain <chain> --to <addr> --amount <n> [--token <contract>] [--token-decimals <d>] [--token-symbol <sym>]` | Preview only (no execution)                    |
| `gas [chain]`                                                                                                          | Gas fee estimation                             |
| `sol-tx --to <addr> --amount <n> [--mint <token>]`                                                                     | Build SOL unsigned tx (native SOL only)        |
| `sign-tx <raw_tx>`                                                                                                     | Sign raw transaction (server-side)             |
| `send-tx --chain <chain> --hex <signed_tx> --to <addr>`                                                                | Broadcast signed tx                            |
| `tx-detail <tx_hash>`                                                                                                  | Transaction details                            |
| `tx-history [--page <n>] [--limit <n>]`                                                                                | Transaction history                            |

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

## Domain Knowledge

### Authentication Model

- **MCP**: Gate/Google OAuth → `mcp_token` stored in `~/.gate-wallet/auth.json` (30-day TTL)

### Custodial Wallet Architecture

```
OAuth login → mcp_token saved locally → server-side signing → on-chain broadcast
```

Users never handle private keys or mnemonics. `sign-tx` is server-side signing.

### Amount Format

All amount parameters use **human-readable values**, NOT chain-native smallest units.

| Correct                  | Wrong                               |
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

Use `token-info` or `swap-tokens --search <symbol>` to look up other token addresses.

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

> **NEVER execute signing without user confirmation.**

### Address Format Validation

| Chain Type            | Format                                   | Example                                        |
| --------------------- | ---------------------------------------- | ---------------------------------------------- |
| EVM (ETH/BSC/ARB/...) | `0x` + 40 hex chars                      | `0xdb918f36a1c282a042758b544c64ae5a1d5767a2`   |
| Solana                | Base58 (32-44 chars, no `0`/`O`/`I`/`l`) | `BTYzBJ5N7L9exV4UAvHnPhfmovz4tmbVvagar4U7bfxE` |

EVM and Solana addresses are NOT interchangeable. Always call `address` first to get the correct chain-specific address.

---

## Typical Workflows

### Token Research

```
token-rank --chain eth --limit 10             # Top gainers
token-risk --chain eth --address 0x...        # Security audit
tx-stats --chain eth --address 0x...          # Trading volume
liquidity --chain eth --address 0x...         # Liquidity events
token-info --chain eth --address 0x...        # Full details
kline --chain eth --address 0x... --period 1h # K-line chart
```

### Safe Transfer

```
balance                                    # Confirm sufficient funds
gas ETH                                    # Estimate gas
transfer --chain ETH --to 0x... --amount 0.1  # Preview (dry run)
send --chain ETH --to 0x... --amount 0.1      # Execute after confirmation
tx-detail <hash>                           # Verify on-chain
```

### Solana SPL Token Transfer

SPL token transfer differs from native SOL and EVM ERC20. Key differences:

1. **Requires `token_mint` + `token_decimals`**: The MCP `tx.transfer_preview` tool requires both fields for SPL transfers. The CLI `send` command auto-resolves `token_decimals` and `token` symbol via `token_list_swap_tokens`, or accepts `--token-decimals` / `--token-symbol` explicitly.
2. **`token` param for display**: `tx.transfer_preview` uses the `token` parameter for display labels (default "USDT"). The CLI now auto-resolves the token symbol from `token_list_swap_tokens` and passes it as `token`. You can also specify `--token-symbol <sym>` explicitly.
3. **`tx.get_sol_unsigned` is native-SOL-only**: This tool rebuilds the unsigned tx with a fresh blockhash, but only supports native SOL transfers. For SPL tokens, the CLI skips this step and uses the `unsigned_tx_hex` from `transfer_preview` directly (blockhash valid ~90s, sufficient for immediate signing).
4. **Recipient ATA (Associated Token Account)**: If the recipient has no ATA for the SPL token, the transaction includes ATA creation (~0.002 SOL rent). Ensure sufficient SOL balance for both gas + rent.

```
# CLI one-shot (recommended — handles decimals + symbol automatically)
send --chain SOL --to <sol_addr> --amount 0.001 --token <token_mint>

# With explicit decimals and symbol
send --chain SOL --to <sol_addr> --amount 0.001 --token <token_mint> --token-decimals 6 --token-symbol TRUMP

# Preview only
transfer --chain SOL --to <sol_addr> --amount 0.001 --token <token_mint> --token-symbol TRUMP
```

**Fallback (Level 3 JSON-RPC)** — when CLI `call` returns 401 for `tx.transfer_preview`:

```
# 1. Initialize MCP session
curl -s -D- -X POST {MCP_URL} -H 'Content-Type: application/json' -H 'x-api-key: mcp_ak_demo' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# 2. Call tx.transfer_preview with token_mint + token_decimals
curl -s -X POST {MCP_URL} -H 'mcp-session-id: {session_id}' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tx.transfer_preview","arguments":{"mcp_token":"{token}","chain":"SOL","from":"{sol_addr}","to":"{recipient}","amount":"0.001","token_mint":"{mint}","token_decimals":6}}}'

# 3. Sign: wallet.sign_transaction(raw_tx=unsigned_tx_hex, chain=SOL)
# 4. Broadcast: tx.send_raw_transaction
```

### Swap (MCP one-shot)

```
quote --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0
swap --from-chain 1 --to-chain 1 --from - --to 0xA0b8... --amount 0.01 --native-in 1 --native-out 0 --slippage 0.5
swap-detail <order_id>
```

### Hybrid Swap (OpenAPI + MCP signing)

Use OpenAPI for quote/build/submit and MCP for custodial signing. This is the preferred approach when the user explicitly requests OpenAPI or needs OpenAPI-only features (custom fee_recipient, gas price queries, etc.).

**Critical performance rule**: The entire flow MUST be executed in a **single `python3 -c '...'` Shell call** to avoid multi-step latency. Never split build/sign/submit into separate Shell calls — that causes 15-20 minute delays due to network round-trips and order_id expiry (build → submit must complete within ~30s).

**Prerequisites**:

- `~/.gate-dex-openapi/config.json` exists with `api_key` and `secret_key`
- User is logged in (MCP token in `~/.gate-wallet/auth.json`)
- `pip3 install rlp` (one-time)
- Read [gate-dex-trade/SKILL.md](../gate-dex-trade/SKILL.md) for OpenAPI parameter details and auth signature algorithm

**Flow overview**:

| Step | Channel | Action                                                                                                 |
| ---- | ------- | ------------------------------------------------------------------------------------------------------ |
| 1    | OpenAPI | `trade.swap.quote` — get quote + show to user for confirmation                                         |
| 2    | OpenAPI | `trade.swap.build` — get unsigned_tx + order_id                                                        |
| 3    | MCP RPC | `rpc.call` — get nonce + gasPrice (add 20% buffer to gasPrice)                                         |
| 4    | Local   | RLP-encode EIP-1559 unsigned tx (type 0x02)                                                            |
| 5    | MCP     | `wallet.sign_transaction` — custodial signing                                                          |
| 6    | OpenAPI | `trade.swap.submit` — submit signed tx (signed_tx_string must be JSON array format: `'["0x02f8..."]'`) |
| 7    | OpenAPI | `trade.swap.status` — poll every 5s (needs chain_id + order_id + tx_hash)                              |

**Agent execution template** (steps 2-7 in one script, after user confirms quote):

```python
python3 -c '
import hmac, hashlib, base64, json, time, uuid, urllib.request, rlp

# ── Config (read from files) ──
cfg = json.load(open("PATH_TO_HOME/.gate-dex-openapi/config.json"))
auth = json.load(open("PATH_TO_HOME/.gate-wallet/auth.json"))
ak, sk = cfg["api_key"], cfg["secret_key"]
MCP_URL = auth.get("server_url", "MCP_URL_FROM_ENV")
MCP_TOKEN = auth["mcp_token"]
WALLET = "USER_EVM_ADDRESS"

# ── Helpers ──
def call_openapi(payload):
    body = json.dumps(payload, separators=(",",":"))
    ts = str(int(time.time() * 1000))
    sig = base64.b64encode(hmac.new(sk.encode(), (ts+"/api/v1/dex"+body).encode(), hashlib.sha256).digest()).decode()
    req = urllib.request.Request("https://openapi.gateweb3.cc/api/v1/dex", data=body.encode(), method="POST",
        headers={"Content-Type":"application/json","X-API-Key":ak,"X-Timestamp":ts,"X-Signature":sig,"X-Request-Id":str(uuid.uuid4())})
    return json.loads(urllib.request.urlopen(req).read().decode())

def to_bytes(n):
    if n == 0: return b""
    h = hex(n)[2:]
    if len(h) % 2: h = "0" + h
    return bytes.fromhex(h)

def mcp_init():
    req = urllib.request.Request(MCP_URL, method="POST",
        data=json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cli","version":"1.0.0"}}}).encode(),
        headers={"Content-Type":"application/json","x-api-key":"mcp_ak_demo"})
    return urllib.request.urlopen(req).headers.get("mcp-session-id")

def mcp_call(sid, tool, args, cid):
    req = urllib.request.Request(MCP_URL, method="POST",
        data=json.dumps({"jsonrpc":"2.0","id":cid,"method":"tools/call","params":{"name":tool,"arguments":args}}).encode(),
        headers={"Content-Type":"application/json","x-api-key":"mcp_ak_demo","mcp-session-id":sid})
    return json.loads(json.loads(urllib.request.urlopen(req).read().decode())["result"]["content"][0]["text"])

# ── Build ──
bd = call_openapi({"action":"trade.swap.build","params":{
    "chain_id":CHAIN_ID, "token_in":TOKEN_IN, "token_out":TOKEN_OUT,
    "amount_in":AMOUNT, "user_wallet":WALLET, "slippage":SLIPPAGE, "slippage_type":1
}})
assert bd["code"] == 0, f"Build failed: {bd}"
utx, order_id = bd["data"]["unsigned_tx"], bd["data"]["order_id"]

# ── Nonce + Gas + Sign (all via one MCP session) ──
sid = mcp_init()
nonce = int(mcp_call(sid,"rpc.call",{"mcp_token":MCP_TOKEN,"chain":"CHAIN","method":"eth_getTransactionCount","params":[WALLET,"pending"]},2)["result"],16)
gas_price = int(int(mcp_call(sid,"rpc.call",{"mcp_token":MCP_TOKEN,"chain":"CHAIN","method":"eth_gasPrice","params":[]},3)["result"],16) * 1.2)

raw_tx = "0x02" + rlp.encode([to_bytes(utx["chain_id"]), to_bytes(nonce), b"", to_bytes(gas_price),
    to_bytes(utx["gas_limit"]), bytes.fromhex(utx["to"][2:].lower()), to_bytes(int(utx["value"])),
    bytes.fromhex(utx["data"][2:]), []]).hex()

signed = mcp_call(sid,"wallet.sign_transaction",{"mcp_token":MCP_TOKEN,"chain":"EVM","raw_tx":raw_tx},4)
signed_tx = signed["signedTransaction"]
if not signed_tx.startswith("0x"): signed_tx = "0x" + signed_tx

# ── Submit ──
sub = call_openapi({"action":"trade.swap.submit","params":{"order_id":order_id,"signed_tx_string":json.dumps([signed_tx])}})
assert sub["code"] == 0, f"Submit failed: {sub}"
tx_hash = sub["data"]["tx_hash"]
print("TX:", tx_hash)

# ── Poll status ──
for i in range(12):
    time.sleep(5)
    sr = call_openapi({"action":"trade.swap.status","params":{"chain_id":CHAIN_ID,"order_id":order_id,"tx_hash":tx_hash}})
    st = sr.get("data",{})
    print(f"[{i+1}] status={st.get(\"status\")} amount_out={st.get(\"amount_out\")} err={st.get(\"error_msg\",\"\")}")
    if st.get("status") in (200, 300, 400): break
'
```

**Key points for Agent**:

1. **Single Shell call**: Steps 2-7 MUST run in one `python3 -c '...'` with `required_permissions: ["all"]`. Never split into multiple Shell calls.
2. **Quote separately**: Step 1 (quote) should run first as a separate call to show the user the price for confirmation. Only after user confirms, execute steps 2-7 in one batch.
3. **Gas buffer**: Always multiply `eth_gasPrice` by 1.2 (20% buffer) for `maxFeePerGas`. ARB L2 baseFee fluctuates and without buffer the tx will fail with "max fee per gas less than block base fee".
4. **signed_tx_string format**: Must be JSON array string `'["0x02f8..."]'`, not raw hex. Use `json.dumps([signed_tx])`.
5. **status params**: `trade.swap.status` requires `chain_id` (int), `order_id`, and `tx_hash` (can be empty string `""`).
6. **EIP-1559 type 2**: The signed tx must start with `0x02`. Legacy format (`0xf8`/`0xf9`) will be rejected by the OpenAPI.
7. **Non-native token swap (ERC20→ERC20)**: Check ERC20 allowance first. If insufficient, call `trade.swap.approve_transaction` via OpenAPI, sign approve tx with MCP (nonce=N), sign swap tx (nonce=N+1), and pass both `signed_tx_string` and `signed_approve_tx_string` to submit.
8. **Credential reading**: Read `api_key`/`secret_key` from `~/.gate-dex-openapi/config.json`, `mcp_token`/`server_url` from `~/.gate-wallet/auth.json`. Never hardcode.

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
9. **Slippage settings**: Stablecoins 0.5-1%, volatile 1-3%, meme 3-5%+. MCP expects **decimal format** (0.03 = 3%). The CLI `swap`/`quote` commands auto-convert: `--slippage 3` → 0.03, `--slippage 0.03` → 0.03. Both formats are accepted.
10. **SOL SPL transfer requires `token_decimals`**: When sending SPL tokens (TRUMP, USDC, etc.) on Solana, `tx.transfer_preview` requires both `token_mint` and `token_decimals`. The CLI `send` command auto-resolves decimals; for manual `call`, look up decimals via `token_list_swap_tokens`
11. **`tx.get_sol_unsigned` is native-SOL-only**: Do NOT use it for SPL token transfers — it ignores `token_mint` and builds a native SOL transfer, silently sending SOL instead of the intended SPL token
12. **SOL SPL transfer needs extra SOL for ATA rent**: If recipient has no Associated Token Account for the SPL token, ~0.002 SOL rent is required on top of gas
13. **EVM native transfer must set `token = "ETH"`**: When calling `tx.transfer_preview` without `--token` on EVM chains (ARB/BSC/BASE/OP etc.), you MUST explicitly pass `token = "ETH"` (or `"NATIVE"`) to indicate native token. Otherwise the MCP server defaults to transferring USDT instead of native ETH. The CLI `send`/`transfer` commands now handle this automatically.
14. **`tokens` / `wallet.get_token_list` may not show L2 balances**: The wallet API may not index assets on L2 chains (e.g. ETH/USDT on Arbitrum). To verify L2 balances, use `rpc --chain <chain>` with `eth_getBalance` (native) or `eth_call` with ERC20 `balanceOf` (0x70a08231 + padded address).
15. **`token` param required for correct display label**: `tx.transfer_preview` defaults display to "USDT" if `token` is not passed. The CLI `send` command now auto-resolves `token` symbol via `token_list_swap_tokens`. For `transfer` (preview-only), pass `--token-symbol <sym>` explicitly if using a non-native token.
16. **Hybrid Swap must be a single Shell call**: Never split build/sign/submit into separate Shell calls — order_id expires in ~30s. The entire build→nonce→sign→submit flow MUST run in one `python3 -c '...'` script. See "Hybrid Swap" in Typical Workflows.
17. **Gas buffer for L2 chains**: Always multiply `eth_gasPrice` by 1.2 (20%) for `maxFeePerGas`. L2 baseFee fluctuates and without buffer the tx fails with "max fee per gas less than block base fee".
18. **OpenAPI `signed_tx_string` must be JSON array**: Use `json.dumps(["0x02f8..."])` — not raw hex string. Otherwise submit returns error 50005.
19. **OpenAPI numeric params**: `chain_id`, `slippage`, `slippage_type` must be numeric types (int/float), not strings. Strings cause "cannot unmarshal string into Go struct field" errors.

---

## Safety Rules

- **Confirm before fund operations**: `send`/`swap`/`approve` involve real funds — always confirm target address, amount, token, and chain with user
- **Preview before execute**: Transfer → `transfer` preview, Swap → `quote`, Approval → `approve_preview`
- **Approval safety**: Prefer exact-amount approvals over unlimited; only approve trusted contracts; periodically review and revoke unused approvals
- **Risk audit**: Before trading unfamiliar tokens, run `token-risk` and clearly present risk items to user
- **Credential safety**: `~/.gate-wallet/` stores credentials securely in user home — never commit credentials to Git
- **Server-side signing**: Users never expose private keys, but must trust Gate custodial service
