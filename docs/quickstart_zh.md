# 快速上手

## 环境准备

- **Node.js >= 18** — 推荐通过 [nvm](https://github.com/nvm-sh/nvm) 或 [Node.js 官网](https://nodejs.org/) 安装

## 安装

```bash
# 方式一：npm 全局安装（推荐）
npm install -g gate-wallet-cli

# 方式二：npx 免安装运行
npx gate-wallet-cli login
```

## 登录

```bash
gate-wallet login              # Gate OAuth 登录（浏览器授权）
gate-wallet login --google     # Google OAuth 登录
gate-wallet status             # 查看登录状态
```

Token 自动保存到 `~/.gate-wallet/auth.json`，30 天有效，无需重复登录。

## 基本用法

```bash
# 钱包查询
gate-wallet balance            # 查询总资产余额
gate-wallet address            # 查询各链钱包地址（EVM / SOL）
gate-wallet tokens             # 查询 Token 列表和余额

# 一键转账
gate-wallet send --chain ETH --to 0x... --amount 0.0001
gate-wallet send --chain SOL --to <address> --amount 0.001

# Swap 兑换（ETH → USDT）
gate-wallet swap --from-chain 1 --from - --to 0xdAC17F958D2ee523a2206206994597C13D831ec7 --amount 0.01 --native-in 1

# Gas 费用查询
gate-wallet gas ETH
gate-wallet gas SOL
```

## OpenAPI 通道（免登录）

```bash
# 配置 AK/SK
gate-wallet openapi-config --set-ak YOUR_AK --set-sk YOUR_SK

# Hybrid Swap（OpenAPI 报价构建 + MCP 托管签名）
gate-wallet openapi-swap --chain ARB --from - --to 0xFd08... --amount 0.00001

# 行情数据
gate-wallet openapi-token-rank --chain eth --limit 10
gate-wallet openapi-token-risk --chain eth --address 0x...
```

前往 [Gate DEX Developer](https://www.gatedex.com/developer) 创建 AK/SK。

## 交互模式

```bash
gate-wallet                    # 进入交互模式
```

```
Gate Wallet CLI - Interactive Mode
Type 'login' to start, 'help' for all commands, 'exit' to quit.

gate-wallet> login
gate-wallet> balance
gate-wallet> exit
```

## 更多

完整命令参考、支持的链列表和配置说明，请查看 [README](../README.md)。
