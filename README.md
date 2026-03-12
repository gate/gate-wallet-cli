# Gate Wallet CLI

Gate Web3 钱包命令行工具，支持双通道：

- **MCP 通道**：OAuth 登录 → 托管签名 → 钱包全功能（余额 / 转账 / Swap / 授权 / 行情）
- **OpenAPI 通道**：AK/SK 认证 → 自持私钥签名 → DEX Swap 交易

## 项目结构

```
gate-wallet-cli/
├── cli/                          # CLI 工具（npm 包）
│   ├── src/                      # TypeScript 源码
│   ├── package.json
│   └── README.md                 # CLI 使用文档
└── skills/                       # → 已迁移至 web3-wallet-skill
    └── README.md                 # 迁移说明
```

## 快速开始

```bash
cd cli
pnpm install
pnpm cli login        # OAuth 登录
pnpm cli balance      # 查询余额
pnpm cli swap --from-chain 1 --from - --to 0xdAC17F958D2ee523a2206206994597C13D831ec7 --amount 0.01 --native-in 1
```

详细文档见 [cli/README.md](cli/README.md)。

## AI Agent Skills

> Skills 已迁移到独立项目 **[web3-wallet-skill](https://github.com/aspect-build/web3-wallet-skill)**，提供更完整的多模块 Skill 生态。

### 安装 Skills

```bash
# 1. 克隆 skill 仓库
git clone <web3-wallet-skill-repo-url>
cd web3-wallet-skill

# 2. 运行安装脚本（自动配置 MCP Server + Skills 路由）
./gate-dex-wallet/install.sh

# 3. 可选：安装 gate-wallet CLI（需要 Node.js >= 18）
./gate-dex-wallet/install_cli.sh
```

### Skill 列表

| Skill | 说明 | 模块 |
|-------|------|------|
| 🔐 gate-dex-wallet/auth | Google OAuth 认证 | MCP |
| 💰 gate-dex-wallet | 资产查询、交易历史 | MCP |
| 💸 gate-dex-wallet/transfer | 转账执行 | MCP |
| 🎯 gate-dex-wallet/dapp | DApp 交互、合约调用 | MCP |
| 🖥️ gate-dex-wallet/cli | CLI 双通道（本项目） | CLI |
| 🔄 gate-dex-trade | DEX Swap 交易 | MCP + OpenAPI |
| 📊 gate-dex-market | 市场数据查询 | MCP + OpenAPI |

### Agent 自动识别

`web3-wallet-skill` 支持 Cursor、Claude Code、Codex CLI、OpenCode、OpenClaw 等多个 AI 平台，安装后 Agent 自动识别并按 Skill 规范执行操作。

如需将 CLI Skill 安装到 Cursor 全局（跨项目使用）：

```bash
gate-wallet skill --install ~/.cursor/skills/gate-wallet-cli
```
