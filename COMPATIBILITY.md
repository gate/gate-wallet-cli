# Platform Compatibility Guide

Gate Wallet CLI 在各 AI Agent 平台上的兼容性说明。

## Compatibility Rule

任何能 **读取文件 + 运行 Node.js + 访问网络** 的 AI Agent 平台均可使用本工具。

---

## 使用方式

本项目提供两种集成方式：

| 方式         | 适用场景                               | 说明                                   |
| ------------ | -------------------------------------- | -------------------------------------- |
| **交互模式** | Agent 启动 CLI 后在 REPL 中发送命令    | `pnpm cli` 启动，逐条输入命令          |
| **SKILL.md** | Agent 读取技能文件，理解命令后自主调用 | 项目根目录 `SKILL.md` 包含完整命令参考 |

---

## ✅ 已验证平台

### Cursor

**状态：** ✅ 通过

**安装方式：**

1. 在 Cursor 中打开项目目录
2. 运行 `pnpm install`
3. Agent 自动识别 `SKILL.md`，理解所有可用命令

**使用方式：**

- Agent 通过终端执行 `pnpm cli` 启动交互模式
- 在交互提示符下发送命令（`login`、`balance`、`swap` 等）
- Agent 解析命令输出并向用户展示结果

---

### Claude Code

**状态：** ✅ 通过

**安装方式：**

```bash
cd /path/to/gate-wallet-cli
pnpm install
```

**使用方式：**

- Claude Code 读取 `SKILL.md` 获取命令参考
- 通过终端启动 `pnpm cli` 并在交互模式下执行命令
- 支持完整的登录、查询、转账、Swap 流程

---

## 🔧 兼容平台（未测试）

以下平台具备所需能力（Node.js 运行时 + 终端访问 + 网络），理论上可正常使用。

### CLI Agents

| 平台                   | 使用方式                                    |
| ---------------------- | ------------------------------------------- |
| **Codex CLI (OpenAI)** | Clone 项目，在 `AGENTS.md` 中引用 SKILL.md  |
| **Aider**              | Clone 项目，Aider 可通过终端执行 `pnpm cli` |

### IDE Agents

| 平台                               | 使用方式                                         |
| ---------------------------------- | ------------------------------------------------ |
| **Windsurf**                       | 打开项目目录，Agent 读取 SKILL.md 并通过终端操作 |
| **Cline (VS Code)**                | 打开项目目录，Cline 可读取文件并运行终端命令     |
| **Continue (VS Code / JetBrains)** | 打开项目目录，通过终端交互                       |

### Coding Agents

| 平台             | 使用方式                                              |
| ---------------- | ----------------------------------------------------- |
| **Manus**        | 提供 GitHub URL，Manus 自动 clone 并安装依赖          |
| **Devin**        | 提供 GitHub URL，Devin clone 后读取 SKILL.md 执行命令 |
| **OpenHands**    | Docker 环境中 clone 项目并运行                        |
| **Bolt.new**     | 提供 GitHub URL，自动安装并执行                       |
| **Replit Agent** | 在 Replit 中 clone 项目，Agent 自动配置环境           |

### Workflow Platforms

| 平台            | 使用方式                               |
| --------------- | -------------------------------------- |
| **Dify**        | 将 CLI 封装为 Code 节点或外部 API Tool |
| **Coze (扣子)** | 创建插件调用 CLI 命令                  |

---

## 环境要求

| 依赖    | 最低版本 | 说明                             |
| ------- | -------- | -------------------------------- |
| Node.js | 18+      | 运行时                           |
| pnpm    | 8+       | 包管理器（也可用 npm / yarn）    |
| 浏览器  | -        | OAuth 登录需要打开浏览器完成授权 |

### 注意事项

- **OAuth 登录需要浏览器**：`login` 命令会打开浏览器完成授权，纯 headless 环境需手动复制 URL 到浏览器
- **Token 不持久化**：认证 token 仅存内存，退出交互模式即失效
- **网络访问**：需能访问 `*.gateweb3.cc`（MCP Server）和 `accounts.google.com`（Google OAuth）

---

## 测试方法

验证平台兼容性时，使用以下标准流程：

1. 安装依赖：`pnpm install`
2. 启动交互模式：`pnpm cli`
3. 登录：`login` 或 `login --google`（需浏览器授权）
4. 查询资产：`balance`、`tokens`、`address`
5. 确认返回数据准确

**评估标准：**

- ✅ Agent 能读取 SKILL.md 并理解命令语法
- ✅ Agent 能通过终端启动交互模式
- ✅ Agent 能正确发送命令并解析输出
- ✅ OAuth 登录流程可完成（可能需用户手动授权）
- ✅ 查询结果与链上数据一致
