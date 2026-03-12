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

> Skills 已迁移到独立项目 **[web3-wallet-skill](https://github.com/aspect-build/web3-wallet-skill)**，请前往该仓库查看安装和使用说明。
