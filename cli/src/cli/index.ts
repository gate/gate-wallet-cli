import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Command } from "commander";
import chalk from "chalk";
import { registerAuthCommands, registerShortcutCommands } from "./auth.cmd.js";
import { registerOpenApiCommands } from "./openapi.cmd.js";
import { getMcpClientSync, getServerUrl } from "../core/mcp-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..", "..");

function resolveSkillFile(): string {
  const inPkg = join(PKG_ROOT, "SKILL.md");
  if (existsSync(inPkg)) return inPkg;
  // dev mode: cli/src/cli/ → ../../skills/
  const inRepo = join(PKG_ROOT, "..", "skills", "SKILL.md");
  if (existsSync(inRepo)) return inRepo;
  return inPkg;
}

const SKILL_FILE = resolveSkillFile();

function loadEnvFile(filePath: string): void {
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
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // file not found or unreadable, skip
  }
}

// 1) ~/.gate-wallet/.env (user-level config)
loadEnvFile(join(homedir(), ".gate-wallet", ".env"));
// 2) CWD/.env (project-level config, for local dev)
loadEnvFile(join(process.cwd(), ".env"));

const program = new Command();

program
  .name("gate-wallet")
  .description("Gate Wallet CLI - MCP Custodial Wallet")
  .version("1.0.0");

registerAuthCommands(program);
registerShortcutCommands(program);
registerOpenApiCommands(program);

// ─── skill 命令 ──────────────────────────────────────────

program
  .command("skill")
  .description("Show or install the AI Agent skill file (SKILL.md)")
  .option("--path", "Print the absolute path to SKILL.md")
  .option("--print", "Print SKILL.md content to stdout")
  .option("--install <dir>", "Copy SKILL.md to a target directory")
  .action((opts: { path?: boolean; print?: boolean; install?: string }) => {
    if (!existsSync(SKILL_FILE)) {
      console.error(chalk.red("SKILL.md not found in package."));
      process.exitCode = 1;
      return;
    }

    if (opts.path) {
      console.log(SKILL_FILE);
      return;
    }

    if (opts.print) {
      process.stdout.write(readFileSync(SKILL_FILE, "utf-8"));
      return;
    }

    if (opts.install) {
      const targetDir = opts.install.startsWith("~")
        ? join(homedir(), opts.install.slice(1))
        : opts.install;
      mkdirSync(targetDir, { recursive: true });
      const dest = join(targetDir, "SKILL.md");
      copyFileSync(SKILL_FILE, dest);
      console.log(chalk.green(`✔ Installed to ${dest}`));
      return;
    }

    // Default: show path + usage guide
    console.log(chalk.bold("\nGate Wallet CLI - Agent Skill File\n"));
    console.log(`  ${chalk.cyan("Path:")} ${SKILL_FILE}\n`);
    console.log(chalk.gray("Usage:\n"));
    console.log(`  ${chalk.white("gate-wallet skill --print")}          Print SKILL.md content`);
    console.log(`  ${chalk.white("gate-wallet skill --path")}           Print file path only`);
    console.log(`  ${chalk.white("gate-wallet skill --install <dir>")}  Copy to a directory\n`);
    console.log(chalk.gray("Examples:\n"));
    console.log(chalk.gray("  # Cursor IDE — copy to global skills folder:"));
    console.log(`  ${chalk.white("gate-wallet skill --install ~/.cursor/skills/gate-wallet-cli")}\n`);
    console.log(chalk.gray("  # Claude Desktop / Windsurf / other — copy to your project:"));
    console.log(`  ${chalk.white("gate-wallet skill --install ./")}\n`);
    console.log(chalk.gray("  # Or just point your agent to read the file directly:"));
    console.log(`  ${chalk.white(SKILL_FILE)}\n`);
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
