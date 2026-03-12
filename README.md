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
└── skills/                       # AI Agent Skills
    ├── gate-wallet-cli/SKILL.md  # MCP 通道 Skill（主入口，含路由策略）
    └── gate-dex-trade/SKILL.md   # OpenAPI 通道 Skill（DEX Swap）
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

## AI Agent 集成

本项目通过 `AGENTS.md`（项目根目录）实现跨平台 Agent 自动识别，支持 Cursor、Claude Code、Windsurf、VS Code Copilot、Codex、Jules、JetBrains Junie 等 60+ AI Agent。

**无需任何安装步骤** — clone 仓库后，Agent 自动读取 `AGENTS.md` 并按指引加载完整 Skill。

| 文件                              | 作用                                              |
| --------------------------------- | ------------------------------------------------- |
| `AGENTS.md`                       | 跨平台 Agent 入口，精简指引 + 引导读取 SKILL.md   |
| `skills/gate-wallet-cli/SKILL.md` | 主 Skill，含双通道路由策略、MCP 钱包全功能        |
| `skills/gate-dex-trade/SKILL.md`  | OpenAPI 通道 Swap 交易，用户指定 "openapi" 时触发 |

如需额外安装到 Cursor 全局 skills（跨项目使用）：

```bash
gate-wallet skill --install ~/.cursor/skills/gate-wallet-cli
```
