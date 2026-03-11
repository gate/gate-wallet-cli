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

本项目提供两个 Skill 文件供 AI Agent 使用：

| Skill           | 路径                              | 说明                                              |
| --------------- | --------------------------------- | ------------------------------------------------- |
| gate-wallet-cli | `skills/gate-wallet-cli/SKILL.md` | 主 Skill，含双通道路由策略、MCP 钱包全功能        |
| gate-dex-trade  | `skills/gate-dex-trade/SKILL.md`  | OpenAPI 通道 Swap 交易，用户指定 "openapi" 时触发 |

安装到 Cursor IDE：

```bash
# 方式一：通过 CLI 命令安装
cd cli && pnpm cli skill --install ~/.cursor/skills/gate-wallet-cli

# 方式二：手动复制
cp skills/gate-wallet-cli/SKILL.md ~/.cursor/skills/gate-wallet-cli/
cp -r skills/gate-dex-trade ~/.cursor/skills/
```
