import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Command } from "commander";
import chalk from "chalk";
import { registerAuthCommands, registerShortcutCommands } from "./auth.cmd.js";
import { registerOpenApiCommands } from "./openapi.cmd.js";
import { getMcpClientSync, getServerUrl } from "../core/mcp-client.js";

// Load .env (no dependency needed)
try {
  const envContent = readFileSync(
    new URL("../../.env", import.meta.url),
    "utf-8",
  );
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not found, skip
}

const program = new Command();

program
  .name("gate-wallet")
  .description("Gate Wallet CLI - MCP Custodial Wallet")
  .version("1.0.0");

registerAuthCommands(program);
registerShortcutCommands(program);
registerOpenApiCommands(program);

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
