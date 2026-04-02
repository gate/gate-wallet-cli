import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Command } from "commander";
import chalk from "chalk";
import { registerAuthCommands, registerShortcutCommands } from "./auth.cmd.js";
import { registerOpenApiCommands } from "./openapi.cmd.js";
import { getMcpClientSync, getServerUrl } from "../core/mcp-client.js";
import { registerShellEnvSnapshot } from "../core/mcp-url-source.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

/** 启动进程时已从父进程继承的变量名（终端 export 等），项目 .env 不得覆盖 */
const envKeysFromShell = new Set(Object.keys(process.env));
registerShellEnvSnapshot(envKeysFromShell);

/**
 * @param mode
 *   fill — 仅当未设置时写入（用户级默认）
 *   overrideNonShell — 文件中出现的键一律写入，但若该键启动时已在 shell 里则保留 shell（尊重显式 export）
 */
function loadEnvFile(
  filePath: string,
  mode: "fill" | "overrideNonShell",
): void {
  try {
    if (!existsSync(filePath)) return;
    const envContent = readFileSync(filePath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (mode === "fill") {
        if (!process.env[key]) process.env[key] = value;
      } else if (!envKeysFromShell.has(key)) {
        process.env[key] = value;
      }
    }
  } catch {
    // file not found or unreadable, skip
  }
}

// 1) ~/.gate-wallet/.env（用户级默认，不覆盖已有 shell 变量）
loadEnvFile(join(homedir(), ".gate-wallet", ".env"), "fill");
// 2) 仓库根目录 .env（覆盖用户目录里的 MCP_URL 等，便于团队测试环境）
loadEnvFile(join(PKG_ROOT, "..", ".env"), "overrideNonShell");
// 3) 当前工作目录 .env（最后生效，便于在子目录单独配置）
loadEnvFile(join(process.cwd(), ".env"), "overrideNonShell");

const program = new Command();

program
  .name("gate-wallet")
  .description("Gate Wallet CLI - MCP Custodial Wallet")
  .version(pkg.version, "-v, --version");

registerAuthCommands(program);
registerShortcutCommands(program);
registerOpenApiCommands(program);

program
  .command("cleanup")
  .description("清理本地配置文件 (~/.gate-wallet, ~/.gate-dex-openapi)")
  .action(() => {
    const dirs = [
      join(homedir(), ".gate-wallet"),
      join(homedir(), ".gate-dex-openapi"),
    ];
    for (const dir of dirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        console.log(chalk.green(`已删除 ${dir}`));
      } else {
        console.log(chalk.gray(`${dir} 不存在，跳过`));
      }
    }
  });

/** 递归给所有子命令设置 exitOverride，防止 REPL 中被意外退出 */
function applyExitOverride(cmd: Command) {
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    applyExitOverride(sub as Command);
  }
}

const rawArgs = process.argv.slice(2);
const { operands } = program.parseOptions(rawArgs);
const hasSubcommand = operands.length > 0;

if (hasSubcommand) {
  program
    .parseAsync()
    .then(async () => {
      const mcp = getMcpClientSync();
      if (mcp) await mcp.disconnect();
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
} else {
  applyExitOverride(program);
  program.configureOutput({
    writeOut: () => {},
    writeErr: (str) => {
      if (str.trim()) console.error(str.trim());
    },
  });

  console.log(chalk.bold("Gate Wallet CLI - Interactive Mode"));
  console.log(chalk.gray(`Server: ${getServerUrl()}`));
  console.log(
    chalk.gray(
      "Type 'login' to start, 'help' for all commands, 'exit' to quit.\n",
    ),
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("gate-wallet> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit") {
      const mcp = getMcpClientSync();
      if (mcp) await mcp.disconnect();
      console.log(chalk.gray("Bye!"));
      process.exit(0);
    }

    if (input === "help") {
      program.outputHelp();
      rl.prompt();
      return;
    }

    const argv = parseArgs(input);

    try {
      await program.parseAsync(["node", "gate-wallet", ...argv]);
    } catch {
      // Commander 错误已由其内部处理
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", async () => {
    const mcp = getMcpClientSync();
    if (mcp) await mcp.disconnect();
    process.exit(0);
  });
}

/** 简单解析命令行字符串，支持引号包裹的参数 */
function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}
