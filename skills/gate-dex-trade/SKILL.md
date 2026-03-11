---
name: gate-dex-opentrade
version: "2026.3.11-4"
updated: "2026-03-11"
description: Gate DEX OpenTrade 交易技能。通过 AK/SK 认证直接调用 Gate DEX 聚合交易 API，以 Swap 为核心，覆盖报价、授权、构建交易、签名、提交、状态查询。支持 EVM（Ethereum/BSC/Arbitrum/Base 等 14 链）、Solana、SUI、Tron、Ton。当用户明确指定使用 OpenAPI / AK/SK / 直连 API / DEX API 时触发，或由 gate-wallet-cli Skill 的路由策略分发到此。
---

# Gate DEX OpenTrade Skill

Gate DEX OpenTrade 交易技能。通过 AK/SK 认证直接调用 Gate DEX 聚合交易 API，以 Swap 为核心，覆盖报价、授权、构建交易、签名、提交、状态查询。支持 EVM（Ethereum/BSC/Arbitrum/Base 等 14 链）、Solana、SUI、Tron、Ton。

---

## 一、触发场景

本 Skill 通过以下方式触发：

### 方式 A：用户明确指定 OpenAPI 通道

当用户对话中**明确要求使用 OpenAPI 通道**时，直接触发本 Skill：

| 类别     | 关键词示例                                                                 |
| -------- | -------------------------------------------------------------------------- |
| 直接触发 | "OpenAPI"、"AK/SK"、"API Key"、"DEX API"、"gate dex"、"gate-dex-opentrade"、"直连 API"、"自己签名" |
| 配置意图 | "配置 API"、"设置密钥"、"更新 AK"、"更换 SK"、"配置 openapi"               |

### 方式 B：由 gate-wallet-cli Skill 路由分发

当 gate-wallet-cli Skill 的 Channel Routing 规则判定应使用 OpenAPI 通道时，会引导 Agent 读取并执行本 Skill。具体路由规则参见 [gate-wallet-cli/SKILL.md](../gate-wallet-cli/SKILL.md) 的 "Channel Routing" 章节。

### 方式 C：无 MCP 登录但有 OpenAPI 配置

当用户发起 Swap 相关请求，但 `~/.gate-wallet/auth.json` 不存在或已过期，而 `~/.gate-dex-openapi/config.json` 文件已存在时，优先路由到本 Skill。

> **注意**：当用户仅说 "swap" / "兑换" / "报价" 等交易意图词，但**未指定通道**时，**不要直接触发本 Skill**。应先由 gate-wallet-cli Skill 的路由策略判断使用哪个通道。

---

## 二、Step 0 — 环境检测（强制，每次触发必须执行）

**本步骤在每次 Skill 被触发时都必须先执行，不可跳过。**

### 2.0 Shell 执行权限（强制，所有 Shell 调用必须遵守）

本 Skill 的所有操作涉及**外部网络请求**（调用 Gate DEX API）和**工作区外文件读写**（`~/.gate-dex-openapi/` 目录），这些操作会被 Cursor 的沙盒机制拦截。因此：

**Agent 在执行任何 Shell 命令时，必须根据命令类型附加 `required_permissions` 参数**：

| 命令类型                                     | 所需权限                                 | 说明                               |
| -------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| 读写 `~/.gate-dex-openapi/` 目录下的文件     | `required_permissions: ["all"]`          | 工作区外路径，沙盒默认禁止写入     |
| 发起 HTTP 请求（API 调用、RPC 调用）         | `required_permissions: ["full_network"]` | 沙盒默认仅允许有限域名列表         |
| 安装依赖（`pip3 install`、`npm install`）    | `required_permissions: ["full_network"]` | 需要从 PyPI / npm 下载包           |
| 涉及以上任意组合（如脚本读取配置 + 发 HTTP） | `required_permissions: ["all"]`          | 同时需要文件和网络权限，直接用 all |
| 纯本地命令（`python3 --version`、`ls`）      | 不需要额外权限                           | 沙盒内即可执行                     |

**简化规则**：如果不确定是否会被沙盒拦截，统一使用 `required_permissions: ["all"]`。宁可多请求权限，不可因权限不足导致命令失败后重试（浪费时间且影响用户体验）。

**典型场景**：

```
# ✅ 正确：API 调用带 full_network
Shell(command='python3 -c "..."', required_permissions=["full_network"])

# ✅ 正确：写入 ~/.gate-dex-openapi/ 带 all
Shell(command='mkdir -p ~/.gate-dex-openapi', required_permissions=["all"])

# ✅ 正确：脚本既读配置又发请求，直接用 all
Shell(command='python3 ~/.gate-dex-openapi/scripts/gate_api.py "trade.swap.chain"', required_permissions=["all"])

# ❌ 错误：API 调用不带权限，会被沙盒拦截网络请求
Shell(command='python3 -c "..."')
```

> **注意**：这是 Cursor IDE 的沙盒安全机制。当 Agent 请求 `required_permissions` 时，Cursor 会弹窗询问用户"是否允许"。用户点击确认即可，无需额外配置。

**（可选）减少弹窗干扰 — 配置 Cursor 命令白名单**：

如果用户希望减少每次执行命令时的权限确认弹窗，可引导用户在 Cursor 设置中配置命令白名单：

1. 打开 Cursor Settings → 搜索 `allowedCommands` 或 `terminal.integrated.allowedCommands`
2. 添加本 Skill 常用的命令前缀到白名单：

```json
{
  "cursor.allowedCommands": [
    "python3",
    "node",
    "pip3 install",
    "npm install",
    "mkdir -p ~/.gate-dex-openapi",
    "chmod"
  ]
}
```

配置后，白名单中的命令将**自动获得权限，不再弹窗**。未在白名单中的命令仍会弹窗确认。

Agent 在首次触发 Skill 时，如果检测到用户频繁遇到权限弹窗，可主动展示以下提示：

```
💡 提示：如果您觉得权限确认弹窗过于频繁，可以在 Cursor Settings 中
搜索 "allowedCommands"，将 python3、node 等命令加入白名单，
之后这些命令将自动获得权限，无需每次确认。
```

### 2.1 检查配置文件

读取 `~/.gate-dex-openapi/config.json`（绝对路径，不在工作区内）。

**如果文件不存在**：

1. 创建目录 `~/.gate-dex-openapi/`（如不存在）
2. 使用内置默认凭证自动创建配置文件：

```json
{
  "api_key": "XTV4VHLGEDO42MGKUC3ETOGQPQ",
  "secret_key": "IeoU1A01UhPAnRJj6sH0Xvrxp_no3mmiy6i-QOySgRA.ei2A52TK",
  "default_slippage": 0.03,
  "default_slippage_type": 1
}
```

3. 使用 Shell `mkdir -p ~/.gate-dex-openapi && chmod 700 ~/.gate-dex-openapi` 创建目录并设置权限
4. 使用 Write 工具将上述 JSON 写入 `~/.gate-dex-openapi/config.json`
5. 使用 Shell `chmod 600 ~/.gate-dex-openapi/config.json` 限制文件权限（仅所有者可读写）
6. 向用户展示以下提示：

```
已使用默认凭证创建配置文件 ~/.gate-dex-openapi/config.json，可直接使用。
配置文件存放在用户主目录下（非工作区），不会被 git 追踪。

如需创建专属 AK/SK 以获得更好的服务体验，请访问 Gate DEX 开发者平台：
https://www.gatedex.com/developer
操作步骤：连接钱包注册 → Settings 绑定邮箱和手机 → API Key Management 创建密钥
详细说明：https://gateweb3.gitbook.io/gate_dex_api/exploredexapi/en/api-access-and-usage/developer-platform
```

**如果文件已存在**：

1. 读取并解析 JSON
2. 判断 `api_key` 是否等于 `XTV4VHLGEDO42MGKUC3ETOGQPQ`（即默认凭证）
   - 是 → 在后续响应中附加一行提示：`"当前使用公共默认凭证（Basic 档 1 RPS 限流），建议前往 https://www.gatedex.com/developer 创建专属 AK/SK"`
   - 否 → 不提示

### 2.2 验证凭证有效性

用 `trade.swap.chain` 发送一次测试请求（参见第四章 API 调用规范）。如果返回 `code: 0` 则凭证有效；否则根据错误码提示用户（参见第十章错误处理）。

---

## 三、凭证管理

### 3.1 配置文件格式

文件路径：`~/.gate-dex-openapi/config.json`（绝对路径，所有工作区共享）

```json
{
  "api_key": "你的 API Key",
  "secret_key": "你的 Secret Key",
  "default_chain_id": 1,
  "default_slippage": 0.03,
  "default_slippage_type": 1
}
```

| 字段                  | 类型   | 必填 | 说明                               |
| --------------------- | ------ | ---- | ---------------------------------- |
| api_key               | string | 是   | API Key（默认内置，用户可替换）    |
| secret_key            | string | 是   | Secret Key（默认内置，用户可替换） |
| default_chain_id      | int    | 否   | 默认链 ID，省略时每次询问用户      |
| default_slippage      | float  | 否   | 默认滑点推荐值，0.03 = 3%          |
| default_slippage_type | int    | 否   | 1 = 百分比模式，2 = 固定值模式     |

### 3.2 内置默认凭证

```
AK: XTV4VHLGEDO42MGKUC3ETOGQPQ
SK: IeoU1A01UhPAnRJj6sH0Xvrxp_no3mmiy6i-QOySgRA.ei2A52TK
```

### 3.3 安全展示规则

- **永远不在对话中展示完整 SK**。只显示末 4 位，格式：`sk_****52TK`
- 当用户要求查看当前配置时，AK 可完整展示，SK 必须脱敏
- 配置文件存放在 `~/.gate-dex-openapi/config.json`（用户主目录，不在工作区内），天然不会被 git 追踪
- 建议设置文件权限 `chmod 600`，仅所有者可读写

### 3.4 更新凭证

当用户说"更新 AK/SK"或"替换密钥"时：

1. 使用 AskQuestion 工具询问新的 AK
2. 使用 AskQuestion 工具询问新的 SK
3. 更新 `~/.gate-dex-openapi/config.json` 中的 `api_key` 和 `secret_key` 字段
4. 用 `trade.swap.chain` 验证新凭证有效性
5. 验证成功 → 提示"凭证已更新"；验证失败 → 回滚并提示错误原因

---

## 四、API 调用规范

### 4.1 基础信息

- **统一端点**：`POST https://openapi.gateweb3.cc/api/v1/dex`
- **Content-Type**：`application/json`
- **所有接口共用同一端点**，通过请求体中的 `action` 字段区分不同接口

请求体格式：

```json
{"action":"trade.swap.xxx","params":{...}}
```

### 4.2 HMAC-SHA256 签名算法

每次 API 请求都需要计算签名。算法如下：

**第一步：构造 prehash 字符串**

```
prehash = 毫秒时间戳 + "/api/v1/dex" + 请求体原始JSON字符串
```

- 毫秒时间戳：13 位 Unix 毫秒时间戳，如 `1709812345678`
- 路径固定为 `/api/v1/dex`（不管实际 URL 是什么，签名路径永远是这个）
- 请求体必须是**紧凑 JSON**（无多余空格），即序列化时使用 `separators=(',', ':')`

**第二步：计算 HMAC-SHA256**

```
signature = Base64Encode( HMAC-SHA256( key=SecretKey, message=prehash ) )
```

**第三步：设置 HTTP Headers**

| Header       | 值                         | 说明                                   |
| ------------ | -------------------------- | -------------------------------------- |
| Content-Type | `application/json`         | 固定值                                 |
| X-API-Key    | 配置文件中的 `api_key`     | 身份标识                               |
| X-Timestamp  | 上面用到的毫秒时间戳字符串 | 与服务器偏差不超过 30 秒               |
| X-Signature  | 上面计算的 Base64 签名     | 请求完整性校验                         |
| X-Request-Id | 随机 UUIDv4 字符串         | 幂等键，同一 AK 下唯一，不参与签名计算 |

### 4.3 签名参考实现（Python 伪代码）

以下代码展示签名算法的精确实现，供 Agent 参考。Agent 可用任何语言通过 Shell 一次性内联命令实现等效逻辑（如 `python3 -c '...'`），**不得在用户仓库中创建脚本文件**。

```python
import hmac, hashlib, base64, time, json, uuid

ak = "从 ~/.gate-dex-openapi/config.json 读取的 api_key"
sk = "从 ~/.gate-dex-openapi/config.json 读取的 secret_key"

body = json.dumps({"action": "trade.swap.chain", "params": {}}, separators=(',', ':'))

ts = str(int(time.time() * 1000))

prehash = ts + "/api/v1/dex" + body

signature = base64.b64encode(
    hmac.new(sk.encode('utf-8'), prehash.encode('utf-8'), hashlib.sha256).digest()
).decode('utf-8')

headers = {
    "Content-Type": "application/json",
    "X-API-Key": ak,
    "X-Timestamp": ts,
    "X-Signature": signature,
    "X-Request-Id": str(uuid.uuid4())
}
```

### 4.4 关键注意事项

1. **JSON 序列化必须紧凑**：`json.dumps(..., separators=(',', ':'))`，多余空格会导致签名不一致
2. **签名路径固定**：永远是 `/api/v1/dex`，不要用其他路径
3. **X-Request-Id 不参与签名**：但必须包含在请求头中，且同一 AK 下不可重复
4. **时间戳必须是毫秒级**：13 位数字字符串
5. **请求体直接用于签名**：`data=body` 发送的内容必须和签名用的 body 完全一致（同一个字符串变量）

### 4.5 通用响应格式

所有 API 返回统一格式：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

- `code == 0` 表示成功
- `code != 0` 表示错误，参见第十章错误处理

---

## 五、工具规范（9 个 Action）

### Action 1: trade.swap.chain

**功能**：查询所有支持的链列表。

**请求参数**：无

**请求示例**：

```json
{ "action": "trade.swap.chain", "params": {} }
```

**返回示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "chain_id": "1",
      "chain": "eth",
      "chain_name": "Ethereum",
      "native_currency": "ETH",
      "native_decimals": 18,
      "native_address": ""
    },
    {
      "chain_id": "56",
      "chain": "bsc",
      "chain_name": "BNB Smart Chain",
      "native_currency": "BNB",
      "native_decimals": 18
    },
    {
      "chain_id": "501",
      "chain": "solana",
      "chain_name": "Solana",
      "native_currency": "SOL",
      "native_decimals": 9
    }
  ]
}
```

**Agent 行为**：

- 调用前：无特殊前置，Step 0 验证凭证时已调用过一次
- 调用后：以表格形式展示所有链（chain_name、chain_id、native_currency）
- 错误时：参见第十章通用错误处理

---

### Action 2: trade.swap.gasprice

**功能**：查询指定链的实时 Gas 价格。不支持 Ton 链。

**请求参数**：

| 参数     | 类型 | 必填 | 说明  |
| -------- | ---- | ---- | ----- |
| chain_id | int  | 是   | 链 ID |

**请求示例**：

```json
{ "action": "trade.swap.gasprice", "params": { "chain_id": 56 } }
```

**返回示例（EVM 链）**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "native_coin_price": "1000.12",
    "native_decimal": 18,
    "low_pri_wei_per_gas": 50000000,
    "avg_pri_wei_per_gas": 52762481,
    "fast_pri_wei_per_gas": 100000000,
    "base_wei_fee": 0,
    "support_eip1559": true
  }
}
```

**返回格式因链类型不同**：

- EVM：`low/avg/fast_pri_wei_per_gas`、`base_wei_fee`、`support_eip1559`
- Solana：`low/avg/fast/super_fast_microlp_per_cu`、`base_microlp_per_signature`
- Tron：`base_energy_price`、`base_bandwidth_price`
- SUI：`low/avg/fast_mist_per_gas`

**Agent 行为**：

- 调用前：如果用户未指定链，使用配置文件的 `default_chain_id`；未配置则用 AskQuestion 询问
- 调用后：将 Gas 价格转换为人类可读格式（Gwei 等），展示低/中/快三档
- 错误时：参见第十章通用错误处理

---

### Action 3: trade.swap.quote

**功能**：获取 Swap 最优报价和路由拆分。返回的 `quote_id` 后续步骤必需。

**请求参数**：

| 参数          | 类型   | 必填 | 说明                                           |
| ------------- | ------ | ---- | ---------------------------------------------- |
| chain_id      | int    | 是   | 链 ID                                          |
| token_in      | string | 是   | 输入代币合约地址。**原生代币统一用 `"-"`**     |
| token_out     | string | 是   | 输出代币合约地址。**原生代币统一用 `"-"`**     |
| amount_in     | string | 是   | 输入数量，人类可读格式（如 `"0.1"`，不是 wei） |
| slippage      | float  | 是   | 滑点，0.01 = 1%                                |
| slippage_type | int    | 是   | 1 = 百分比模式，2 = 固定值模式                 |
| user_wallet   | string | 是   | 用户钱包地址                                   |
| fee_recipient | string | 否   | 自定义手续费接收地址                           |
| fee_rate      | string | 否   | 自定义交易手续费率（最高 3%）                  |

**请求示例（Solana: SOL → USDC）**：

```json
{
  "action": "trade.swap.quote",
  "params": {
    "chain_id": 501,
    "token_in": "-",
    "token_out": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount_in": "0.001",
    "slippage": 0.05,
    "slippage_type": 1,
    "user_wallet": "2ycvS9CiMZfNyoGoR6nsxDkdxZwzjLaWB9Pa5G8dxZ5d"
  }
}
```

**返回示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "amount_in": "0.001",
    "amount_out": "0.169966",
    "min_amount_out": "0.161467",
    "slippage": "0.050000",
    "system_slippage": "0.010000",
    "slippage_type": 1,
    "quote_id": "137a3700c558a584e73b2ed18fd77d79",
    "from_token": {
      "token_symbol": "WSOL",
      "chain_id": 501,
      "token_contract_address": "So11111111111111111111111111111111111111112",
      "decimal": 9,
      "token_price": "169.77",
      "is_native_token": 1
    },
    "to_token": {
      "token_symbol": "USDC",
      "chain_id": 501,
      "token_contract_address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "decimal": 6,
      "token_price": "0.9999",
      "is_native_token": 0
    },
    "protocols": [
      [
        [
          {
            "name": "ORCA",
            "part": 100,
            "fromTokenAddress": "So11...",
            "toTokenAddress": "EPjF..."
          }
        ]
      ]
    ],
    "trading_fee": { "rate": "0.003", "enable": true }
  }
}
```

**关键返回字段**：

- `quote_id` — 后续 approve/build 必传
- `amount_out` — 预估兑出数量
- `min_amount_out` — 扣除滑点后的最小兑出量
- `from_token` / `to_token` — 代币详情（symbol、price、decimal、is_native_token）
- `protocols` — 三层嵌套数组：路由拆分 → 多跳路径 → 单步（name、part 百分比、from/to 地址）
- `system_slippage` — 系统自动附加的额外滑点
- `trading_fee` — 交易费信息

**Agent 行为**：

- 调用前：
  1. 确定链（智能推断：用户说 ETH → chain_id=1；说 SOL → chain_id=501；说 USDT 等多链代币 → 必须用 AskQuestion 询问在哪条链操作）
  2. **跨链检测**：如果用户意图是将 A 链的代币兑换为 B 链的代币（如 "把 ETH 上的 USDT 换成 Solana 上的 SOL"），**立即拦截并提示**：
     ```
     当前 OpenAPI 不支持跨链兑换，仅支持同一条链内的 Swap。
     如需跨链交易，请安装 Gate MCP 服务：https://github.com/gate/gate-mcp
     ```
     **终止流程，不继续调用 quote。**
  3. 确定代币合约地址（参见第六章代币地址解析规则）
  4. 确定钱包地址（参见第九章签名策略获取地址）
  5. 确定滑点（使用 AskQuestion 询问，同时给出推荐值：EVM 链推荐 1-3%，Solana 推荐 3-5%，小链推荐 3-5%）
  6. **以上全部确定后，执行 SOP Step 1 交易对确认**（参见第八章）
- 调用后：**执行 SOP Step 2 报价详情展示**（参见第八章），透明展示完整路由路径
- 错误时：
  - 31104（找不到交易对）→ 提示用户检查代币合约地址是否正确
  - 31105/31503（流动性不足）→ 提示减少金额或稍后重试
  - 31111（Gas 费超过输出）→ 提示交易不划算
  - 31109（价差过大）→ 展示风险警告
  - 其他 → 参见第十章

---

### Action 4: trade.swap.approve_transaction

**功能**：获取 ERC20 代币的 approve calldata。仅 EVM 和 Tron 链需要，且仅当 token_in 不是原生代币时需要。

**何时需要调用此接口**：

必须同时满足以下所有条件：

1. 链类型是 EVM 或 Tron（Solana/SUI/Ton 不需要 approve）
2. `token_in` 不是原生代币（即 token_in 不是 `"-"`，或 quote 返回的 `from_token.is_native_token != 1`）
3. 链上查询到的 allowance 不足（参见第九章 ERC20 Allowance 检查）

**如果 token_in 是原生代币（ETH/BNB/MATIC 等），直接跳过此步骤。**

**请求参数**：

| 参数           | 类型   | 必填 | 说明                                       |
| -------------- | ------ | ---- | ------------------------------------------ |
| user_wallet    | string | 是   | 用户钱包地址                               |
| approve_amount | string | 是   | 授权数量（人类可读格式，等于交易金额即可） |
| quote_id       | string | 是   | 从 quote 步骤获得的 quote_id               |

**请求示例**：

```json
{
  "action": "trade.swap.approve_transaction",
  "params": {
    "user_wallet": "0xBb43e9e205139A8bB849d6f408A07461A1E92af8",
    "approve_amount": "0.001",
    "quote_id": "6e7b2c16f500dd58e794a28e0b339eee"
  }
}
```

**返回示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "data": "0x095ea7b3000000000000000000000000459e945e8d06c1ed6bffa8b9d135973a98a864e800000000000000000000000000000000000000000000000000000000000003e8",
    "approve_address": "0x459E945e8D06c1ed6BfFa8B9D135973A98A864E8",
    "gas_limit": "63601"
  }
}
```

**返回字段**：

- `data` — approve 调用的 calldata（hex 编码），需要签名
- `approve_address` — 授权目标合约地址（签名交易的 `to` 字段）
- `gas_limit` — 推荐 gas limit

**Agent 行为**：

- 调用前：先执行 ERC20 Allowance 检查（参见第九章），确认确实需要 approve
- 调用后：
  1. 向用户展示授权信息："需要授权 [token_symbol] 给路由合约 [approve_address]，授权数量 [approve_amount]"
  2. 使用 AskQuestion 确认：选项为"确认授权"/"取消"
  3. 确认后走签名路径签名 approve 交易（构造 unsigned_tx：to=approve_address, data=返回的data, value=0, gas_limit=返回的gas_limit）
- 错误时：参见第十章通用错误处理

---

### Action 5: trade.swap.build

**功能**：构建 Swap 未签名交易。返回 `unsigned_tx`（需要本地签名）和 `order_id`（提交时必需）。

**请求参数**：

| 参数             | 类型   | 必填 | 说明                                             |
| ---------------- | ------ | ---- | ------------------------------------------------ |
| chain_id         | int    | 是   | 链 ID                                            |
| amount_in        | string | 是   | 输入数量（人类可读格式）                         |
| token_in         | string | 是   | 输入代币合约地址，原生代币用 `"-"`               |
| token_out        | string | 是   | 输出代币合约地址，原生代币用 `"-"`               |
| slippage         | string | 是   | 滑点（0.01 = 1%）                                |
| slippage_type    | string | 是   | 1 = 百分比，2 = 固定值                           |
| user_wallet      | string | 是   | 用户钱包地址                                     |
| receiver         | string | 是   | 接收地址（默认与 user_wallet 相同）              |
| quote_id         | string | 否   | 从 quote 获得的 ID（强烈建议传入以保证价格一致） |
| sol_tip_amount   | string | 否   | Solana MEV 保护 Tip 金额（lamports）             |
| sol_priority_fee | string | 否   | Solana Priority Fee（micro-lamports per CU）     |

**请求示例（EVM: USDT → WETH）**：

```json
{
  "action": "trade.swap.build",
  "params": {
    "chain_id": 1,
    "amount_in": "0.01",
    "token_in": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "token_out": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "slippage": "0.50",
    "slippage_type": "1",
    "user_wallet": "0xBb43e9e205139A8bB849d6f408A07461A1E92af8",
    "receiver": "0xBb43e9e205139A8bB849d6f408A07461A1E92af8",
    "quote_id": "c0a8c273945488ad1edcc4bdbaf8f9a8"
  }
}
```

**返回示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "unsigned_tx": {
      "to": "0x459E945e8D06c1ed6BfFa8B9D135973A98A864E8",
      "data": "0x140a50ef0000...",
      "value": "0",
      "chain_id": 1,
      "gas_limit": 314090
    },
    "order_id": "0x4202a80fa66e7c906d003f39037ee81d772e076d178455244d5038bfc1c05a02",
    "ts": 1762855061,
    "amount_in": "0.01",
    "amount_out": "0.000003850827713117",
    "min_amount_out": "0.000001925413856558",
    "slippage": "0.500000",
    "system_slippage": "0.050000",
    "slippage_type": 1,
    "quote_id": "c0a8c273945488ad1edcc4bdbaf8f9a8",
    "from_token": {
      "token_symbol": "USDT",
      "decimal": 6,
      "token_price": "0.9999"
    },
    "to_token": {
      "token_symbol": "WETH",
      "decimal": 18,
      "token_price": "3554.17"
    },
    "protocols": [
      [
        [
          {
            "name": "UNISWAP_V2",
            "part": 100,
            "fromTokenAddress": "0xdac17f...",
            "toTokenAddress": "0x438532..."
          }
        ],
        [
          {
            "name": "UNISWAP_V2",
            "part": 100,
            "fromTokenAddress": "0x438532...",
            "toTokenAddress": "0xc02aaa..."
          }
        ]
      ]
    ]
  }
}
```

**关键返回字段**：

- `unsigned_tx.to` — 目标合约地址
- `unsigned_tx.data` — 调用数据（hex 编码）
- `unsigned_tx.value` — 原生代币发送值（非原生代币时为 "0"）
- `unsigned_tx.gas_limit` — Gas 限制
- `unsigned_tx.chain_id` — 链 ID（签名时使用）
- `order_id` — 订单唯一标识，submit 和 status 步骤必须传入

**Solana 特殊处理**：

- 构建请求可传入 `sol_tip_amount`（Jito MEV 保护 Tip，单位 lamports，推荐 10000-100000）和 `sol_priority_fee`（优先费，单位 micro-lamports per CU，推荐 50000-500000）
- 返回的 `unsigned_tx.data` 是 base64 编码的 VersionedTransaction 字节
- 签名前需要刷新 `recentBlockhash`（Solana 的 blockhash 有效期约 60-90 秒）

**Agent 行为**：

- 调用前：确保已完成 quote 步骤并通过 SOP Step 1 和 Step 2 确认
- 调用后：**执行 SOP Step 3 签名授权确认**（参见第八章），展示 unsigned_tx 摘要
- 错误时：
  - 31501（余额不足）→ 提示用户余额不足
  - 31502（滑点过低）→ 提示用户提高滑点
  - 31500（参数错误）→ 展示 message 字段内容
  - 其他 → 参见第十章

---

### Action 6: trade.swap.submit

**功能**：提交已签名的交易。支持两种模式：API 代为广播，或客户端自行广播后上报 tx_hash。

**请求参数**：

| 参数                     | 类型   | 必填   | 说明                                                                                                                                                         |
| ------------------------ | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| order_id                 | string | 是     | build 步骤返回的 order_id                                                                                                                                    |
| signed_tx_string         | string | 二选一 | 已签名的交易字符串（让 API 代为广播）。**必须是 JSON 数组格式的字符串**，如 `'["0x02f8b2..."]'`。EVM 链内部的 hex 必须是 EIP-1559 Type 2 格式（`0x02` 开头） |
| tx_hash                  | string | 二选一 | 交易哈希（客户端自己广播后上报，API 仅做状态跟踪）                                                                                                           |
| signed_approve_tx_string | string | 否     | approve 的已签名交易（需要授权时同时传入，仅 signed_tx_string 模式）。**同样必须是 JSON 数组格式**，如 `'["0x02f871..."]'`                                   |

> **`signed_tx_string` 和 `tx_hash` 二选一**：如果客户端自己广播了交易，传 `tx_hash`；如果希望 API 代为广播，传 `signed_tx_string`。
>
> **重要：`signed_tx_string` 和 `signed_approve_tx_string` 的值必须是 JSON 数组格式的字符串**（如 `'["0x02f8..."]'`），而不是裸 hex 字符串。服务端会对该字段做 `json.Unmarshal` 解析，裸 hex 会导致 `error_code: 50005`（`invalid character 'x' after top-level value`）。

**请求示例（模式 A：API 代为广播）**：

```json
{
  "action": "trade.swap.submit",
  "params": {
    "order_id": "0x4202a80fa66e7c906d003f39037ee81d772e076d178455244d5038bfc1c05a02",
    "signed_tx_string": "[\"0x02f8b20181...\"]",
    "signed_approve_tx_string": "[\"0x02f8710181...\"]"
  }
}
```

如果不需要 approve，省略 `signed_approve_tx_string` 字段：

```json
{
  "action": "trade.swap.submit",
  "params": {
    "order_id": "0x4202...",
    "signed_tx_string": "[\"0x02f8b20181...\"]"
  }
}
```

**请求示例（模式 B：客户端自行广播后上报）**：

```json
{
  "action": "trade.swap.submit",
  "params": {
    "order_id": "0x7d13dd777858b0633e590f4944b6837489e9ffa9c7b9255c120645b51b5dfbed",
    "tx_hash": "0x3911b4f30175ef041ffb6ad035a8ca9124192355a0600ad2b9f0d2d9c3785bb7"
  }
}
```

**返回示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "order_id": "0x4202a80fa66e7c906d003f39037ee81d772e076d178455244d5038bfc1c05a02",
    "tx_hash": "0x3911b4f30175ef041ffb6ad035a8ca9124192355a0600ad2b9f0d2d9c3785bb7"
  }
}
```

**Agent 行为**：

- 调用前：确保已完成签名（swap 交易 + 可选的 approve 交易）
- 调用后：展示"交易已提交，tx_hash: [hash]"，然后自动进入状态轮询（Action 7）
- 提交策略选择：参见第九章 9.3.4 提交策略
- 错误时：
  - 31601（order_id 过期 / 签名验证失败）→ 提示用户需要重新执行 build 步骤
  - 其他 → 参见第十章

---

### Action 7: trade.swap.status

**功能**：查询订单执行状态。submit 后自动轮询调用。

**请求参数**：

| 参数     | 类型   | 必填 | 说明                          |
| -------- | ------ | ---- | ----------------------------- |
| chain_id | int    | 是   | 链 ID                         |
| order_id | string | 是   | 订单 ID                       |
| tx_hash  | string | 是   | 交易哈希（可传空字符串 `""`） |

**请求示例**：

```json
{
  "action": "trade.swap.status",
  "params": {
    "chain_id": 1,
    "order_id": "0x4202a80fa66e7c906d003f39037ee81d772e076d178455244d5038bfc1c05a02",
    "tx_hash": ""
  }
}
```

**返回关键字段**：

| 字段                     | 说明                                     |
| ------------------------ | ---------------------------------------- |
| order_id                 | 订单 ID                                  |
| status                   | 交易状态                                 |
| tx_hash                  | 交易哈希                                 |
| tx_hash_explorer_url     | 区块浏览器链接                           |
| amount_in / amount_out   | 实际输入/输出数量                        |
| expect_amount_out        | 预期输出数量                             |
| gas_fee / gas_fee_symbol | Gas 费及代币符号                         |
| pools[]                  | 使用的流动性池列表（name, dex, address） |
| creationTime / endTime   | 创建和结束时间                           |

**Agent 行为（自动轮询）**：

- submit 成功后自动开始轮询
- 每 5 秒调用一次 `trade.swap.status`
- 轮询期间向用户展示等待状态："正在等待链上确认... (已等待 Xs)"
- 最多轮询 60 秒（12 次）
- 轮询结束条件：
  - status 不为 pending → 展示最终结果
  - 超过 60 秒仍为 pending → 展示"交易仍在处理中"并给出区块浏览器链接让用户自行查看
- 展示最终结果时包含：状态、实际兑出量、Gas 费、区块浏览器链接

---

### Action 8: trade.swap.history

**功能**：分页查询历史 Swap 订单。

**请求参数**：

| 参数        | 类型     | 必填 | 说明                           |
| ----------- | -------- | ---- | ------------------------------ |
| user_wallet | string[] | 是   | 用户钱包地址数组               |
| page_number | int      | 否   | 页码（默认 1）                 |
| page_size   | int      | 否   | 每页条数（默认 100，最大 100） |
| chain_id    | int      | 否   | 按链过滤（可选）               |

**请求示例**：

```json
{
  "action": "trade.swap.history",
  "params": {
    "user_wallet": ["0xBb43e9e205139A8bB849d6f408A07461A1E92af8"],
    "pageNum": 1,
    "pageSize": 10
  }
}
```

**返回格式**：分页的订单列表（`total`、`page_number`、`page_size`、`orders[]`），每条记录包含与 `trade.swap.status` 相同的字段。

**Agent 行为**：

- 调用前：需要用户钱包地址。如已知（前序流程中使用过）则直接使用，否则询问用户
- 调用后：以表格形式展示历史记录（时间、链、from_token → to_token、金额、状态）
- 错误时：31701（没有交易历史）→ 提示"暂无历史记录"

---

## 六、支持的链与代币地址解析

### 6.1 支持的链列表

| chain_id | 短名      | 全名            | 原生代币 | 链类型 |
| -------- | --------- | --------------- | -------- | ------ |
| 1        | eth       | Ethereum        | ETH      | EVM    |
| 56       | bsc       | BNB Smart Chain | BNB      | EVM    |
| 137      | polygon   | Polygon         | MATIC    | EVM    |
| 42161    | arb       | Arbitrum        | ETH      | EVM    |
| 10       | optimism  | Optimism        | ETH      | EVM    |
| 8453     | base      | Base            | ETH      | EVM    |
| 43114    | avalanche | Avalanche       | AVAX     | EVM    |
| 250      | fantom    | Fantom          | FTM      | EVM    |
| 25       | cronos    | Cronos          | CRO      | EVM    |
| 59144    | linea     | Linea           | ETH      | EVM    |
| 534352   | scroll    | Scroll          | ETH      | EVM    |
| 324      | zksync    | zkSync Era      | ETH      | EVM    |
| 5000     | mantle    | Mantle          | MNT      | EVM    |
| 10088    | gatelayer | Gate Layer      | GT       | EVM    |
| 501      | solana    | Solana          | SOL      | Solana |
| -        | sui       | SUI             | SUI      | SUI    |
| -        | tron      | Tron            | TRX      | Tron   |
| -        | ton       | Ton             | TON      | Ton    |

> 以 `trade.swap.chain` 接口实时返回为准。

### 6.2 智能链推断规则

当用户未明确指定链时，Agent 按以下规则推断：

**可以确定链的情况**（直接使用，不需要再问）：

- 用户说 "ETH" → chain_id=1（Ethereum）
- 用户说 "SOL" → chain_id=501（Solana）
- 用户说 "BNB" → chain_id=56（BSC）
- 用户说 "AVAX" → chain_id=43114（Avalanche）
- 用户说 "FTM" → chain_id=250（Fantom）
- 用户说 "GT" → chain_id=10088（Gate Layer）
- 用户说 "在 Arbitrum 上"或"arb 链" → chain_id=42161

**无法确定链的情况**（必须用 AskQuestion 询问）：

- USDT、USDC、WETH、DAI 等代币存在于多条链
- 用户未提及任何链相关信息

AskQuestion 询问链的示例：

```
请选择在哪条链上进行交易：
A. Ethereum (chain_id: 1)
B. BSC (chain_id: 56)
C. Arbitrum (chain_id: 42161)
D. Base (chain_id: 8453)
E. Solana (chain_id: 501)
F. 其他（请告诉我链名或 chain_id）
```

### 6.3 代币地址解析规则

API 需要代币合约地址，但用户通常只提供代币符号。解析优先级：

**第一步：原生代币判断**

如果代币是该链的原生代币（ETH on Ethereum、BNB on BSC、SOL on Solana 等），使用 `"-"` 作为 token 地址。

**第二步：查找行情 Skill**

尝试调用 `gate-dex-openmarket` Skill 查询代币合约地址。该 Skill 使用相同的 AK/SK 凭证。

> 注意：如果 `gate-dex-openmarket` Skill 当前不可用，则跳到第三步。

**第三步：常见代币速查表**

以下是主要链上常见代币的合约地址，Agent 可直接使用：

**Ethereum (chain_id: 1)**：

| 代币 | 合约地址                                   |
| ---- | ------------------------------------------ |
| USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 |
| USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |
| WETH | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 |
| WBTC | 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 |
| DAI  | 0x6B175474E89094C44Da98b954EedeAC495271d0F |

**BSC (chain_id: 56)**：

| 代币 | 合约地址                                   |
| ---- | ------------------------------------------ |
| USDT | 0x55d398326f99059fF775485246999027B3197955 |
| USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d |
| WBNB | 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c |
| BUSD | 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56 |

**Arbitrum (chain_id: 42161)**：

| 代币 | 合约地址                                   |
| ---- | ------------------------------------------ |
| USDT | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 |
| USDC | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |
| WETH | 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 |

**Base (chain_id: 8453)**：

| 代币 | 合约地址                                   |
| ---- | ------------------------------------------ |
| USDC | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| WETH | 0x4200000000000000000000000000000000000006 |

**Solana (chain_id: 501)**：

| 代币 | 合约地址                                     |
| ---- | -------------------------------------------- |
| USDC | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v |
| USDT | Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB |
| WSOL | So11111111111111111111111111111111111111112  |

**第四步：要求用户提供**

如果以上都无法解析，向用户说明："无法自动识别 [代币名] 在 [链名] 上的合约地址，请提供合约地址。"

**第五步：确认**

无论通过哪种方式获得合约地址，**都必须与用户确认**："即将使用 [代币符号] ([合约地址前6位...后4位]) 在 [链名] 上进行交易，确认吗？"

---

## 七、操作流程

### Flow A：查询类（无确认门控）

适用于：trade.swap.chain、trade.swap.gasprice、trade.swap.status、trade.swap.history

```
用户提出查询请求
    |
    v
[Step 0 环境检测] → 确保凭证可用
    |
    v
调用对应 Action
    |
    v
格式化展示结果
```

### Flow B：完整 Swap 流程（三步确认门控）

```
用户："把 0.1 ETH 换成 USDT"
    |
    v
[Step 0 环境检测] → 确保凭证可用
    |
    v
[参数收集]
    ├── 确定链：智能推断 or AskQuestion
    ├── 确定代币地址：速查表 / 行情 Skill / 用户提供
    ├── 确定钱包地址：Agent 推导 / 用户提供
    ├── 确定滑点：AskQuestion（附推荐值）
    └── 确认代币和地址无误
    |
    v
[SOP Step 1] 交易对确认 → AskQuestion（参见第八章）
    |
    v  用户确认
[调用 trade.swap.quote] 获取报价
    |
    v
[SOP Step 2] 报价详情展示 → 透明展示路由
    |     价差 > 5% → 风险警告 AskQuestion
    v  用户确认
[调用 trade.swap.build] 构建未签名交易
    |
    v
[ERC20 Approve 判断]
    ├── 链是 EVM/Tron 且 token_in 不是原生代币？
    │     ├── 否 → 跳过 approve
    │     └── 是 → 链上查询 allowance
    │           ├── allowance >= 交易所需量（精度对齐后比较）→ 跳过 approve
    │           └── allowance < 交易所需量 → 需要 approve
    │                 1. 调用 trade.swap.approve_transaction 获取 approve calldata
    │                 2. AskQuestion 确认授权
    │                 3. Agent 自行签名 approve 交易
    │                 4. 记录 signed_approve_tx_string（submit 时一起传入）
    |
    v
[SOP Step 3] 签名授权确认 → AskQuestion（参见第八章）
    |
    v  用户确认
[签名路径]
    └── Agent 自行处理签名（参见第九章）
    |
    v  获得 signed_tx_string（+ 可选 signed_approve_tx_string）
[调用 trade.swap.submit] 提交交易
    |
    v
[自动轮询 trade.swap.status]
    每 5 秒查一次，最多 60 秒
    |
    v
展示最终结果：状态、实际兑出量、Gas 费、区块浏览器链接
```

### Flow C：历史查询

```
用户："查看我的 Swap 历史"
    |
    v
[Step 0 环境检测]
    |
    v
确定用户钱包地址（已知则复用，否则询问）
    |
    v
[调用 trade.swap.history]
    |
    v
以表格形式展示历史记录
```

---

## 八、确认门控模板（SOP 三步确认）

所有涉及资金操作的 Swap 流程必须经过以下三步确认，**不可跳过，不可合并**。

### SOP Step 1：交易对确认

**触发时机**：参数收集完成后、调用 quote 之前。

**展示模板**：

```
========== Swap 交易对确认 ==========
  链：{chain_name} (chain_id: {chain_id})
  卖出：{amount_in} {from_token_symbol}
  买入：{to_token_symbol}
  滑点：{slippage}%（{slippage_type_text}）
  钱包：{user_wallet_short}
====================================
```

其中 `{user_wallet_short}` 格式为 `0x1234...abcd`（前 6 位 + 后 4 位）。

**AskQuestion 调用**：

```json
{
  "questions": [
    {
      "id": "swap_confirm_step1",
      "prompt": "请确认以上交易对信息",
      "options": [
        { "id": "confirm", "label": "确认，获取报价" },
        { "id": "change_slippage", "label": "修改滑点" },
        { "id": "change_amount", "label": "修改金额" },
        { "id": "cancel", "label": "取消交易" }
      ]
    }
  ]
}
```

**Agent 处理**：

- `confirm` → 调用 trade.swap.quote
- `change_slippage` → 重新用 AskQuestion 询问新滑点值
- `change_amount` → 重新用 AskQuestion 询问新金额
- `cancel` → 终止流程，展示"交易已取消"

### SOP Step 2：报价详情

**触发时机**：quote 成功返回后。

**展示模板**：

```
========== Swap 报价详情 ==========
  卖出：{amount_in} {from_token_symbol}（≈ ${from_value_usd}）
  买入：≈ {amount_out} {to_token_symbol}
  最少获得：{min_amount_out} {to_token_symbol}（含 {slippage}% 滑点）
  价差：{price_impact}%
  路由：{route_display}
  预估 Gas：以 build 返回为准
===================================
```

**路由展示格式**（透明展示完整路径）：

单路由单跳：

```
UNISWAP_V3 (100%)
```

单路由多跳：

```
UNISWAP_V2: USDT → WBTC → WETH (100%)
```

多路由拆分：

```
UNISWAP_V3: ETH → USDT (60%)
SUSHISWAP: ETH → USDC → USDT (40%)
```

**价差风险判断**：

计算价差：`price_impact = abs(1 - (amount_out * to_token_price) / (amount_in * from_token_price)) * 100`

- 价差 <= 5% → 正常流程，显示 AskQuestion 确认
- 价差 > 5% → **强制触发风险警告**

**正常流程 AskQuestion**：

```json
{
  "questions": [
    {
      "id": "swap_confirm_step2",
      "prompt": "请确认以上报价信息",
      "options": [
        { "id": "confirm", "label": "确认，构建交易" },
        { "id": "change_amount", "label": "修改金额重新报价" },
        { "id": "cancel", "label": "取消交易" }
      ]
    }
  ]
}
```

**风险警告 AskQuestion**（价差 > 5%）：

```json
{
  "questions": [
    {
      "id": "swap_risk_warning",
      "prompt": "⚠️ 风险警告：当前价差为 {price_impact}%，超过 5% 安全阈值。大价差可能导致显著资产损失。",
      "options": [
        { "id": "accept_risk", "label": "我了解风险，继续交易" },
        { "id": "reduce_amount", "label": "减少交易金额" },
        { "id": "cancel", "label": "取消交易" }
      ]
    }
  ]
}
```

### SOP Step 3：签名授权确认

**触发时机**：build 成功返回 unsigned_tx 后。

**展示模板**：

```
========== 签名授权确认 ==========
  目标合约：{unsigned_tx.to}
  发送金额：{unsigned_tx.value} (原始值)
  Gas 限制：{unsigned_tx.gas_limit}
  链 ID：{unsigned_tx.chain_id}
  Data 前缀：{unsigned_tx.data 前 20 个字符}...
  订单 ID：{order_id 前 10 个字符}...
==================================
```

**AskQuestion 调用**：

```json
{
  "questions": [
    {
      "id": "swap_confirm_step3",
      "prompt": "请确认以上交易信息并授权签名",
      "options": [
        { "id": "confirm_sign", "label": "确认，签名并提交" },
        { "id": "cancel", "label": "取消交易" }
      ]
    }
  ]
}
```

**Agent 处理**：

- `confirm_sign` → 进入签名路径（参见第九章）
- `cancel` → 终止流程，展示"交易已取消"

---

## 九、签名策略

Skill 不管理私钥，不提供签名脚本。签名由 Agent 在运行时自行处理。

**重要约束：Agent 不得在用户的工作区（仓库）中创建、写入或修改任何代码文件。** 所有签名操作必须通过 Shell 工具执行一次性命令（如 `python3 -c '...'` 或 `node -e '...'`）完成，不得生成临时脚本文件。

### 9.1 获取钱包地址

签名和交易都需要钱包地址。Agent 应引导用户提供私钥或助记词，然后自动推导地址。

**当需要用户提供私钥时，必须先展示以下安全提示**：

```
🔐 安全提示：
您可以直接在对话中粘贴私钥，私钥仅在本地上下文中用于签名，
不会上传至任何服务器，也不会发送到 API。
签名完成后，私钥不会被保留或存储。
```

各链私钥到地址的推导原理：

**EVM（所有 EVM 链通用）**：

1. 私钥是 32 字节（64 位 hex 字符串，不含 0x 前缀）
2. 使用 secp256k1 椭圆曲线从私钥推导公钥（取非压缩格式，去掉 04 前缀的 64 字节）
3. 对公钥做 Keccak-256 哈希
4. 取哈希的最后 20 字节，加 `0x` 前缀 → 钱包地址
5. 使用 EIP-55 混合大小写校验和格式化

**Solana**：

1. 私钥是 Ed25519 密钥对（64 字节，Base58 编码）
2. 前 32 字节是 seed，后 32 字节是公钥
3. 公钥的 Base58 编码 → 钱包地址

**SUI**：

1. 私钥是 Ed25519 私钥（32 字节 hex）
2. 从私钥推导 Ed25519 公钥（32 字节）
3. 在公钥前加 flag byte `0x00`（Ed25519 标记）
4. 对 flag + 公钥做 Blake2b-256 哈希
5. 哈希结果加 `0x` 前缀 → SUI 地址

**Ton**：

1. 私钥是 Ed25519 私钥（32 字节 hex）
2. 从私钥推导 Ed25519 公钥
3. 使用公钥创建 WalletV4R2 合约
4. 合约地址即钱包地址（bounceable base64 格式）

### 9.2 签名 unsigned_tx

Agent 根据链类型签名 unsigned_tx。**必须严格按照以下官方 demo 的格式签名**，否则 API 代为广播时会解析失败。

> **执行方式**：以下代码仅为格式参考，Agent 必须通过 Shell 执行一次性内联命令（如 `python3 -c '...'`、`node -e '...'`）完成签名，**禁止在用户仓库中创建任何脚本文件**。

#### EVM 签名（Go 参考实现 — 所有 EVM 链通用）

> **关键要求：必须使用 EIP-1559 DynamicFeeTx（Type 2）格式，不可使用 Legacy 格式。**
> Legacy 格式签出的交易以 `0xf8`/`0xf9` 开头，API 无法解析；EIP-1559 格式以 `0x02` 开头（如 `0x02f8b2...`）。

- unsigned_tx 包含 `to`、`data`（hex）、`value`、`gas_limit`、`chain_id`
- Agent 需要额外通过 RPC 获取：`nonce`（`eth_getTransactionCount`）、`gasTipCap`（`eth_maxPriorityFeePerGas`）、`gasFeeCap`（`eth_gasPrice`）
- 如有 approve 交易需要同时签名：approve 用 nonce=N，swap 用 nonce=N+1

```go
// 官方 EVM 签名参考（Go）
privateKey, _ := crypto.HexToECDSA("your_private_key")
client, _ := ethclient.Dial("https://bsc-dataseed.binance.org")
nonce, _ := client.PendingNonceAt(ctx, fromAddress)
gasTipCap, _ := client.SuggestGasTipCap(ctx)
gasFeeCap, _ := client.SuggestGasPrice(ctx)
txData, _ := hexutil.Decode(unsignedTx.Data)

tx := types.NewTx(&types.DynamicFeeTx{
    ChainID:   big.NewInt(chainID),
    Nonce:     nonce,
    GasTipCap: gasTipCap,
    GasFeeCap: gasFeeCap,
    Gas:       uint64(unsignedTx.GasLimit),
    To:        &toAddress,
    Value:     big.NewInt(0),  // 原生代币时使用 unsignedTx.Value
    Data:      txData,
})

signer := types.LatestSignerForChainID(chainID)
signedTx, _ := types.SignTx(tx, signer, privateKey)
signedTxBytes, _ := signedTx.MarshalBinary()
signedTxHex := "0x" + hex.EncodeToString(signedTxBytes)

// ⚠️ 关键：submit 接口要求 signed_tx_string 为 JSON 数组格式字符串
// 必须用 json.Marshal 包裹成 '["0x02f8..."]'，而不是裸 hex "0x02f8..."
signedTxArray, _ := json.Marshal([]string{signedTxHex})
signedTxString := string(signedTxArray)  // 结果: '["0x02f8b2..."]'
```

**Python 等价实现要点**（Agent 使用 Python 时参考）：

```python
from web3 import Web3
from eth_account import Account
import json

w3 = Web3(Web3.HTTPProvider(rpc_url))
tx = {
    'to': Web3.to_checksum_address(unsigned_tx['to']),
    'value': int(unsigned_tx['value']),
    'gas': unsigned_tx['gas_limit'],
    'maxFeePerGas': w3.eth.gas_price,              # gasFeeCap
    'maxPriorityFeePerGas': w3.eth.max_priority_fee, # gasTipCap
    'nonce': w3.eth.get_transaction_count(wallet, 'pending'),
    'chainId': unsigned_tx['chain_id'],
    'data': unsigned_tx['data'],
    'type': 2  # 强制 EIP-1559
}
signed = w3.eth.account.sign_transaction(tx, private_key)
signed_tx_hex = '0x' + signed.raw_transaction.hex()
# signed_tx_hex 应以 "0x02" 开头，如果以 "0xf8"/"0xf9" 开头说明格式错误

# ⚠️ 关键：submit 接口要求 signed_tx_string 为 JSON 数组格式字符串
signed_tx_string = json.dumps([signed_tx_hex])  # 结果: '["0x02f8b2..."]'
```

- signed_tx_hex 格式：`"0x" + hex(签名后的交易字节)`，必须以 `0x02` 开头
- **signed_tx_string 格式：`'["0x02..."]'`（JSON 数组字符串），这是传给 submit 接口的最终值**

#### Solana 签名（JavaScript 参考实现）

- unsigned_tx.data 是 base64 编码的 VersionedTransaction
- **重要**：签名前必须通过 RPC `getLatestBlockhash` 刷新 recentBlockhash（有效期仅 60-90 秒）
- signed_tx_string 格式：**JSON 数组字符串**，内部元素为 Base58 编码的签名后交易字节

```javascript
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const secretKey = bs58.decode("your_private_key_base58");
const keypair = Keypair.fromSecretKey(secretKey);

const tx = VersionedTransaction.deserialize(
  Buffer.from(unsignedTxData, "base64"),
);

const connection = new Connection("https://api.mainnet-beta.solana.com");
const latest = await connection.getLatestBlockhash();
tx.message.recentBlockhash = latest.blockhash;

tx.sign([keypair]);
const signedTxBase58 = bs58.encode(Buffer.from(tx.serialize()));

// ⚠️ 关键：submit 接口要求 signed_tx_string 为 JSON 数组格式字符串
const signedTxString = JSON.stringify([signedTxBase58]); // '["5K8j..."]'
```

#### SUI 签名（JavaScript 参考实现）

- unsigned_tx.data 是 base64 编码的 TransactionBlock
- SUI 签名格式：flag(1 byte, 0x00) + signature(64 bytes) + pubkey(32 bytes)，Base64 编码
- signed_tx_string 格式：**JSON 数组字符串**，内部元素为 Base64 编码

```javascript
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { hexToBytes } from "@noble/hashes/utils";
import { SuiClient } from "@mysten/sui.js/client";

const keypair = Ed25519Keypair.fromSecretKey(hexToBytes(privateKeyHex));
const suiClient = new SuiClient({ url: "https://fullnode.mainnet.sui.io" });
const tx = TransactionBlock.from(
  Buffer.from(unsignedTxData, "base64").toString(),
);
tx.setSenderIfNotSet(keypair.toSuiAddress());
const txBytes = await tx.build({ client: suiClient });
const { signature, bytes } = await keypair.signTransactionBlock(txBytes);
const signedTxBase64 = Buffer.from(bytes).toString("base64");

// ⚠️ 关键：submit 接口要求 signed_tx_string 为 JSON 数组格式字符串
const signedTxString = JSON.stringify([signedTxBase64]); // '["base64..."]'
```

#### Ton 签名（JavaScript 参考实现）

- unsigned_tx 包含 `to`、`value`、`data`（含 body 和 sendMode）
- 需要通过 RPC 获取 seqno
- signed_tx_string 格式：**JSON 数组字符串**，内部元素为 BOC 的 Base64 编码

```javascript
import { TonClient, WalletContractV4 } from "@ton/ton";

const publicKey = getPublicKeyFromPrivateKey(privateKeyHex);
const wallet = WalletContractV4.create({ workchain: 0, publicKey });
const client = new TonClient({ endpoint: rpcUrl });
const contract = client.open(wallet);
const seqno = await contract.getSeqno();

const txInfo = {
  messages: [
    {
      address: unsignedTx.to,
      amount: unsignedTx.value,
      payload: unsignedTx.data?.body,
      sendMode: unsignedTx.data?.sendMode,
    },
  ],
};

const transfer = await createTonConnectTransfer(
  seqno,
  contract,
  txInfo,
  keypair.secretKey,
);
const bocBase64 = externalMessage(contract, seqno, transfer)
  .toBoc({ idx: false })
  .toString("base64");

// ⚠️ 关键：submit 接口要求 signed_tx_string 为 JSON 数组格式字符串
const signedTxString = JSON.stringify([bocBase64]); // '["base64..."]'
```

### 9.3 Agent 获取私钥的方式

Skill 不规定 Agent 如何获取私钥。Agent 根据上下文灵活处理：

1. **询问用户直接粘贴**：先展示 9.1 中的安全提示，明确告知私钥仅在本地上下文中使用、不会上传至任何服务器，然后等待用户粘贴私钥
2. **询问用户提供文件路径**：如 keystore 文件、.env 文件中的 `PRIVATE_KEY` 变量
3. **读取用户工作区已有的密钥文件**：如果 Agent 在上下文中发现 `.env` 或 keystore 文件

无论哪种方式，**签名完成后不要在对话中保留或展示私钥内容**。如果用户在对话中粘贴了私钥，签名完成后提示用户："签名已完成，建议清除对话历史中的私钥消息。"

### 9.4 提交策略（API 广播 vs 自行广播）

签名完成后，有两种方式将交易提交上链：

**策略 A：API 代为广播（优先）**

将 `signed_tx_string` 传给 `trade.swap.submit`，由 Gate API 服务端广播。

- 优点：流程简单，一次 API 调用完成广播 + 订单关联
- **关键格式要求：`signed_tx_string` 必须是 JSON 数组格式的字符串**（如 `'["0x02f8..."]'`），不是裸 hex 字符串。服务端会对该字段做 `json.Unmarshal` 解析。裸 hex 会导致 `error_code: 50005`
- EVM 链：数组内的 hex 必须是 EIP-1559 Type 2 格式（以 `0x02` 开头）
- Solana：数组内为 Base58 编码
- SUI/Ton：数组内为 Base64 编码
- 如果 API 返回成功但状态轮询显示 `error_code: 50005`，检查 `signed_tx_string` 是否为 JSON 数组格式，如仍无法解决则切换到策略 B

**策略 B：自行广播 + 上报 tx_hash（兜底）**

Agent 先通过链的公共 RPC 节点广播交易（如 EVM 的 `eth_sendRawTransaction`），获得 `tx_hash`，然后将 `tx_hash` 传给 `trade.swap.submit` 做订单状态关联。

- 适用场景：策略 A 失败时的兜底方案
- 优点：不依赖 API 对签名格式的解析能力，兼容 Legacy / EIP-1559 等所有格式
- 流程：
  1. 通过 RPC 广播：`w3.eth.send_raw_transaction(signed_tx.raw_transaction)`
  2. 获得 `tx_hash`
  3. 调用 `trade.swap.submit`，传 `order_id` + `tx_hash`（不传 `signed_tx_string`）

```python
# 策略 B 示例（Python EVM）
tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
# 上报给 Gate API 做订单跟踪
submit_resp = api_call({
    'action': 'trade.swap.submit',
    'params': {
        'order_id': order_id,
        'tx_hash': '0x' + tx_hash.hex()
    }
})
```

**策略 A 的 Python 示例**（注意 JSON 数组格式）：

```python
import json
signed_tx_hex = '0x' + signed_tx.raw_transaction.hex()
submit_resp = api_call({
    'action': 'trade.swap.submit',
    'params': {
        'order_id': order_id,
        'signed_tx_string': json.dumps([signed_tx_hex])  # '["0x02f8..."]'
    }
})
```

**Agent 推荐流程**：先尝试策略 A；如果状态轮询发现 `error_code: 50005` 或类似格式错误，自动切换到策略 B 重新执行（需要重新 quote → build → sign → 自行广播 → submit tx_hash）。

### 9.5 ERC20 Allowance 检查

在调用 `trade.swap.approve_transaction` 之前，必须先检查链上已有的 allowance 是否足够。

**检查条件**（全部满足才需要检查）：

1. 链类型是 EVM 或 Tron
2. token_in 不是原生代币（token_in != `"-"` 且 from_token.is_native_token != 1）

**如果 token_in 是原生代币，直接跳过 allowance 检查和 approve 流程。**

**检查方法**：

调用 ERC20 合约的 `allowance(address owner, address spender)` 方法：

- `owner` = 用户钱包地址（user_wallet）
- `spender` = quote 返回的路由合约地址（build 返回的 unsigned_tx.to）
- 合约地址 = token_in 的合约地址
- 方法签名：`allowance(address,address)` → function selector = `0xdd62ed3e`

通过 RPC `eth_call` 调用：

```json
{
  "jsonrpc": "2.0",
  "method": "eth_call",
  "params": [
    {
      "to": "<token_in 合约地址>",
      "data": "0xdd62ed3e000000000000000000000000<owner 地址去 0x 补 0 到 64 位>000000000000000000000000<spender 地址去 0x 补 0 到 64 位>"
    },
    "latest"
  ],
  "id": 1
}
```

返回值是 uint256 的 hex 编码，表示当前 allowance（raw value，含 decimals）。

**精度对齐比较**：

allowance 返回的是 raw value（如 USDT 6 位精度，1 USDT = 1000000）。交易金额也需要转换到同一维度：

```
所需 raw_amount = amount_in * 10^decimals
当前 allowance_raw = 从链上查到的值（十六进制转十进制）

如果 allowance_raw >= raw_amount → 不需要 approve
如果 allowance_raw < raw_amount → 需要 approve，approve_amount = amount_in（人类可读格式）
```

**注意精度陷阱**：

- 不同代币 decimals 不同（USDT=6, WETH=18, WBTC=8）
- decimals 从 quote 返回的 `from_token.decimal` 字段获取
- 比较时必须在同一精度维度下进行（都用 raw value 或都用人类可读值）

Agent 需要自行查找对应链的公共 RPC URL 来执行 `eth_call`。

---

## 十、错误处理

API 返回 `code != 0` 时为错误。Agent 应**原样展示英文 message**，并附上中文描述和建议。

### 10.1 通用错误（认证/签名/限流）

| 错误码      | Agent 处理                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10001~10005 | 展示原始 message。建议检查 API 调用实现，确认 4 个必填 Header 是否完整。                                                                               |
| 10008       | 展示原始 message。建议：签名不匹配，请检查 SK 是否正确。可能原因：JSON 序列化格式不一致（是否有多余空格）、签名路径是否为 `/api/v1/dex`。              |
| 10101       | 展示原始 message。建议：时间戳超出 30 秒窗口，请检查系统时钟是否准确。                                                                                 |
| 10103       | 展示原始 message。建议：签名验证失败，请检查 AK/SK 是否正确。可使用"更新 AK/SK"命令重新配置。                                                          |
| 10111~10113 | 展示原始 message。建议：IP 白名单问题。如使用自定义 AK/SK，请到开发者平台（https://www.gatedex.com/developer）添加当前 IP 到白名单。默认凭证无此限制。 |
| 10121       | 展示原始 message。建议：X-Request-Id 格式无效，请确认使用标准 UUIDv4 格式。                                                                            |
| 10122       | **自动重试**：生成新的 X-Request-Id 后重新发送请求。不需要通知用户。                                                                                   |
| 10131~10133 | 展示原始 message。建议：请求过于频繁。默认凭证为 Basic 档（1 RPS），请稍等 1-2 秒后重试。如需更高频率，请创建专属 AK/SK。                              |

### 10.2 报价错误

| 错误码        | Agent 处理                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31101         | 展示原始 message。建议：输入金额超过最大限制，请减少金额后重试。                                                                                   |
| 31102         | 展示原始 message。建议：输入金额低于最小要求，请增加金额后重试。                                                                                   |
| 31104         | 展示原始 message。建议：找不到该交易对，请检查代币合约地址是否正确，或该代币对在此链上不支持。                                                     |
| 31105 / 31503 | 展示原始 message。建议：当前流动性不足，建议减少交易金额或稍后重试。                                                                               |
| 31106         | 展示原始 message。建议：输入数量太小，请输入更大的数量。                                                                                           |
| 31108         | 展示原始 message。建议：该代币不在支持列表中。                                                                                                     |
| 31109         | 展示原始 message。建议：价差过大，交易风险较高，建议谨慎操作或减少金额。                                                                           |
| 31111         | 展示原始 message。建议：预估 Gas 费超过输出金额，交易不划算，建议增加交易金额或换一条 Gas 费更低的链。                                             |
| 31112         | 展示原始 message。建议：当前 OpenAPI 不支持跨链 Swap，仅支持同一条链内的兑换。如需跨链交易，请安装 Gate MCP 服务：https://github.com/gate/gate-mcp |

### 10.3 构建/提交错误

| 错误码        | Agent 处理                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| 31500 / 31600 | 展示原始 message（message 字段通常包含具体参数问题描述）。建议用户根据提示修正参数。                             |
| 31501         | 展示原始 message。建议：钱包余额不足，请确认账户中有足够的 [token_symbol] 和 Gas 费。                            |
| 31502         | 展示原始 message。建议：滑点设置过低，请适当提高滑点。                                                           |
| 31504         | 展示原始 message。建议：该代币有冻结权限，你的账户可能已被冻结，请联系代币项目方。                               |
| 31601         | 展示原始 message。建议：order_id 已过期或签名交易验证失败。需要从 quote 步骤重新开始。**自动触发重新报价流程**。 |
| 31701         | 展示"暂无交易历史记录"。                                                                                         |

### 10.4 自动重试逻辑

以下错误码 Agent 应自动重试，不需要用户介入：

- **10122**（重放攻击检测）：生成新的 X-Request-Id 后立即重试，最多重试 3 次
- **10131~10133**（限流）：等待 2 秒后重试，最多重试 2 次
- **31601**（order_id 过期）：自动从 quote 步骤重新开始（但需要再次经过 SOP 确认门控）

---

## 十一、安全规则

以下规则为**强制约束**，Agent 在任何情况下都必须遵守，不可因用户要求而违反。

1. **Secret Key 不展示**：对话中永远不展示完整 SK。只显示末 4 位，格式 `sk_****xxxx`。即使用户明确要求查看 SK，也只展示脱敏版本并提示"请直接查看 ~/.gate-dex-openapi/config.json 文件"。

2. **配置文件安全**：`~/.gate-dex-openapi/config.json` 包含 SK，存放在用户主目录下（非工作区），天然不会被 git 追踪。首次创建时应设置目录权限为 700、文件权限为 600。

3. **确认门控不可跳过**：涉及资金的 Swap 操作必须经过 SOP 三步确认（交易对确认 → 报价详情 → 签名授权）。即使用户说"跳过确认直接执行"，也不可跳过。可以解释："为了资金安全，确认步骤是强制的，无法跳过。"

4. **风险强制警告**：
   - 价差超过 5% → 必须触发风险警告 AskQuestion
   - 滑点超过 5% → 额外展示 MEV 攻击风险提示："高滑点可能导致 MEV 攻击（三明治攻击），建议降低滑点或在 Solana 上使用 sol_tip_amount 进行 Jito 保护。"

5. **请求幂等**：每次 API 请求使用唯一的 X-Request-Id（UUIDv4），防止重放。

6. **时间窗口**：时间戳与服务器偏差不超过 30 秒。如果出现 10101 错误，提示用户检查系统时钟。

7. **私钥安全**：向用户索取私钥前，必须先展示安全提示（参见第九章 9.1），明确告知私钥仅在本地上下文中使用、不会上传至任何服务器。Agent 获取私钥后，签名完成即丢弃，不在对话历史中保留。不主动将私钥写入文件（除非用户明确要求保存到特定位置）。

8. **错误透明**：所有 API 错误原样展示英文 message，不隐藏、不篡改错误信息。Agent 附上中文解释和建议。

9. **禁止写入用户仓库**：Agent 在整个 Swap 流程中不得在用户的工作区（仓库）中创建、写入或修改任何文件（包括但不限于脚本、临时文件、日志文件）。所有操作（API 调用、签名、地址推导等）必须通过 Shell 一次性内联命令完成（如 `python3 -c '...'`、`node -e '...'`）。唯一例外是 `~/.gate-dex-openapi/config.json` 配置文件（位于用户主目录，不在工作区内）。

10. **Shell 命令必须携带沙盒权限**：Cursor IDE 的沙盒机制会拦截未授权的网络请求和工作区外文件操作。Agent 执行 Shell 命令时**必须主动附加 `required_permissions` 参数**（参见第二章 2.0 节的详细规则）。简化原则：涉及网络请求用 `["full_network"]`，涉及 `~/.gate-dex-openapi/` 文件操作或组合操作用 `["all"]`。**禁止先不带权限执行、等失败后再重试**——这会浪费用户时间并造成不必要的确认弹窗。

---

## 附录：API 费用说明

| 档位             | 价格         | 限制                 |
| ---------------- | ------------ | -------------------- |
| Basic（免费）    | 免费         | 1 RPS（每秒 1 请求） |
| Advanced（付费） | 按调用量计费 | 联系 Gate 团队       |

**基础设施费（仅 Swap 交易，从链上成交金额中扣除）**：

| 交易类型            | 费率 |
| ------------------- | ---- |
| 涉及稳定币的 Swap   | 0.3% |
| 不涉及稳定币的 Swap | 1.0% |
