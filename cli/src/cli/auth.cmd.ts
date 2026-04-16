import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  getMcpClient,
  getMcpClientSync,
  getServerUrl,
} from "../core/mcp-client.js";
import type { GateMcpClient } from "../core/mcp-client.js";
import { openBrowser } from "../core/oauth.js";
import {
  saveAuth,
  loadAuth,
  clearAuth,
  getAuthFilePath,
  getOrCreateDeviceToken,
  buildUserAgent,
} from "../core/token-store.js";
import {
  GvClient,
  getGvBaseUrl,
  getWalletQuickBaseUrl,
  type SwapCheckinPreviewFields,
} from "../core/gv-client.js";
import { getMcpUrlProvenance } from "../core/mcp-url-source.js";

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Login (opens browser)")
    .option("--google", "Use Google OAuth instead of Gate")
    .action(async function (this: Command, opts: { google?: boolean }) {
      const serverUrl = getServerUrl();

      const stored = loadAuth();
      if (stored) {
        const connectSpinner = ora("Restoring previous session...").start();
        try {
          const mcp = await getMcpClient({ serverUrl });
          mcp.setMcpToken(stored.mcp_token);
          connectSpinner.succeed(
            "Already logged in (session restored from disk)",
          );
          if (stored.user_id)
            console.log(chalk.green(`  User ID: ${stored.user_id}`));
          console.log(chalk.green(`  Provider: ${stored.provider}`));
          console.log(
            chalk.gray(`  Run ${chalk.white("logout")} to switch accounts.`),
          );
          return;
        } catch {
          connectSpinner.warn(
            "Stored session invalid, starting fresh login...",
          );
          clearAuth();
        }
      }

      try {
        const connectSpinner = ora("Connecting to MCP Server...").start();
        const mcp = await getMcpClient({ serverUrl });
        connectSpinner.succeed("MCP Server connected");

        if (opts.google) {
          await loginGoogleViaRest(mcp, serverUrl);
          return;
        }

        await loginGateViaRest(mcp, serverUrl);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
      }
    });

  program
    .command("status")
    .description("Show connection and auth status")
    .action(async function (this: Command) {
      const mcp = getMcpClientSync();
      const stored = loadAuth();

      const prov = getMcpUrlProvenance();
      console.log(chalk.bold("MCP_URL"));
      console.log(`  ${prov.url}`);
      console.log(
        chalk.gray(`  来源: ${prov.source} — ${prov.detail}`),
      );
      console.log();

      if (mcp?.isAuthenticated()) {
        console.log(chalk.green("MCP: connected & authenticated"));
        return;
      }

      if (stored) {
        console.log(chalk.green("Auth: token found on disk"));
        console.log(`  Provider: ${stored.provider}`);
        if (stored.user_id) console.log(`  User ID: ${stored.user_id}`);
        if (stored.expires_at) {
          const remaining = Math.max(0, stored.expires_at - Date.now());
          const days = Math.floor(remaining / 86_400_000);
          console.log(`  Expires in: ${days} days`);
        }
        console.log(chalk.gray(`  File: ${getAuthFilePath()}`));
      } else {
        console.log(chalk.yellow("Not logged in."));
        console.log(
          chalk.gray(
            `  Run ${chalk.white("login")} or ${chalk.white("login --google")} to get started.`,
          ),
        );
      }
    });

  program
    .command("logout")
    .description("Logout and clear token")
    .action(async () => {
      const stored = loadAuth();
      // best-effort: 调用服务端删除登录会话
      if (stored?.session_id) {
        try {
          const walletQuickUrl = getWalletQuickBaseUrl(getServerUrl());
          await fetch(`${walletQuickUrl}/delete-login-session`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": buildUserAgent(),
              "x-gtweb3-device-token": getOrCreateDeviceToken(),
              "source": "3",
            },
            body: JSON.stringify({ id: stored.session_id }),
          });
        } catch {
          // best-effort server-side logout
        }
      }
      clearAuth();
      console.log(chalk.gray("Logged out. Token cleared."));
    });

  program
    .command("tools")
    .description("List available MCP tools")
    .action(async function (this: Command) {
      const mcp = await getMcpClient();
      const result = await mcp.listTools();
      console.log(chalk.bold(`MCP Tools (${result.tools.length}):\n`));
      for (const tool of result.tools) {
        console.log(
          `  ${chalk.cyan(tool.name.padEnd(40))} ${chalk.gray(tool.description ?? "")}`,
        );
      }
    });

  program
    .command("call <tool> [json]")
    .description("Call an MCP tool directly (for testing)")
    .action(async function (
      this: Command,
      tool: string,
      json: string | undefined,
    ) {
      try {
        const mcp = await getMcpClient();

        const args = json ? (JSON.parse(json) as Record<string, unknown>) : {};
        const result = await mcp.callTool(tool, args);

        if ("content" in result && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (item.type === "text") {
              try {
                const parsed = JSON.parse(item.text);
                console.log(JSON.stringify(parsed, null, 2));
              } catch {
                console.log(item.text);
              }
            }
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });
}

/** 确保 MCP 已连接且已认证，返回 client */
async function ensureAuthedMcp(): Promise<GateMcpClient> {
  const mcp = await getMcpClient();
  if (!mcp.isAuthenticated()) {
    const stored = loadAuth();
    if (stored) {
      mcp.setMcpToken(stored.mcp_token);
    } else {
      throw new Error("Not logged in. Run: login");
    }
  }
  return mcp;
}

/**
 * Swap 专用 GV Checkin：
 * 1. 调用 dex_tx_swap_checkin_preview 获取本阶段所需的 checkin 字段
 * 2. 用这些字段调用 GV /api/v1/tx/checkin 取得 checkin_token
 */
async function performSwapGvCheckin(
  mcp: GateMcpClient,
  swapSessionId: string,
  stage: "approve" | "swap",
): Promise<string> {
  // Step A: 获取 checkin 预览字段
  const previewRaw = (await mcp.callTool("dex_tx_swap_checkin_preview", {
    swap_session_id: swapSessionId,
    stage,
  })) as Record<string, unknown>;

  const preview = extractToolJson<SwapCheckinPreviewFields>(previewRaw);
  if (!preview?.user_wallet || !preview?.checkin_message) {
    throw new Error(
      `checkin_preview 返回字段不完整: ${JSON.stringify(preview)}`,
    );
  }

  // Step B: 调用 GV checkin
  const auth = loadAuth();
  // checkin_preview 可能返回专属 mcp_token，优先使用
  const mcpToken = preview.mcp_token ?? auth?.mcp_token ?? "";
  const gvClient = new GvClient({
    baseUrl: getGvBaseUrl(getServerUrl()),
    mcpToken,
    deviceToken: getOrCreateDeviceToken(),
  });

  const checkinResult = await gvClient.txCheckin({
    wallet_address: preview.user_wallet,
    message: preview.checkin_message,
    module: `/wallet/swap/${stage}`,
    source: 3,
  });

  return checkinResult.checkin_token;
}

/** 从 callTool 返回的 MCP content 中提取 JSON 对象 */
function extractToolJson<T = Record<string, unknown>>(
  result: Record<string, unknown>,
): T {
  if ("content" in result && Array.isArray(result.content)) {
    for (const item of result.content) {
      if ((item as { type: string }).type === "text") {
        try {
          return JSON.parse((item as { text: string }).text) as T;
        } catch {
          // not JSON
        }
      }
    }
  }
  return result as T;
}

/** 格式化打印 MCP tool 返回结果 */
function printToolResult(result: Record<string, unknown>) {
  if ("content" in result && Array.isArray(result.content)) {
    for (const item of result.content) {
      if ((item as { type: string }).type === "text") {
        try {
          const parsed = JSON.parse((item as { text: string }).text);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log((item as { text: string }).text);
        }
      }
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

/** 注册顶级快捷命令 — 覆盖所有 MCP tools */
export function registerShortcutCommands(program: Command) {
  /** 注册一个简单快捷命令的工厂函数 */
  function shortcut(
    name: string,
    desc: string,
    toolName: string,
    buildArgs?: (
      opts: Record<string, string | undefined>,
      positional: string[],
      mcp?: GateMcpClient,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    options?: Array<[flags: string, desc: string, defaultVal?: string]>,
    positionalDef?: string,
  ) {
    const cmdDef = positionalDef ? `${name} ${positionalDef}` : name;
    const cmd = program.command(cmdDef).description(desc);
    if (options) {
      for (const [f, d, dv] of options) {
        if (dv !== undefined) cmd.option(f, d, dv);
        else cmd.option(f, d);
      }
    }
    cmd.action(async function (this: Command, ...actionArgs: unknown[]) {
      try {
        const mcp = await ensureAuthedMcp();
        let args: Record<string, unknown> = {};
        if (buildArgs) {
          const positional: string[] = [];
          let opts: Record<string, string | undefined> = {};
          for (const a of actionArgs) {
            if (typeof a === "string") positional.push(a);
            else if (a && typeof a === "object" && !(a instanceof Command))
              opts = a as Record<string, string | undefined>;
          }
          args = await buildArgs(opts, positional, mcp);
        }
        const result = await mcp.callTool(toolName, args);
        printToolResult(result as Record<string, unknown>);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });
  }

  // ─── Wallet ──────────────────────────────────────────────
  shortcut("balance", "查询总资产余额", "dex_wallet_get_total_asset");
  shortcut("address", "查询钱包地址", "dex_wallet_get_addresses");
  shortcut("tokens", "查询 token 列表和余额", "dex_wallet_get_token_list");
  program
    .command("sign-msg <message>")
    .description(
      "签名消息（32 字节 / 64 位 hex 字符串），自动完成 GV 安全校验后签名",
    )
    .option("--chain <chain>", "链名称: ETH | ARB | BSC | SOL 等", "ETH")
    .action(async function (
      this: Command,
      message: string,
      opts: Record<string, string | undefined>,
    ) {
      try {
        if (!/^[0-9a-fA-F]{64}$/.test(message)) {
          console.error(
            chalk.red(
              "message 必须为 64 位十六进制字符串 (32 bytes)，例如: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
            ),
          );
          return;
        }

        const mcp = await ensureAuthedMcp();
        const chain = (opts.chain ?? "ETH").toUpperCase();

        // Step 1: 获取钱包地址
        const addrData = extractToolJson<{
          addresses?: Record<string, string>;
        }>(
          (await mcp.callTool("dex_wallet_get_addresses", {})) as Record<
            string,
            unknown
          >,
        );
        const chainType = chain === "SOL" ? "SOL" : "EVM";
        const walletAddress = addrData?.addresses?.[chainType] ?? "";
        if (!walletAddress) {
          console.error(chalk.red(`未找到 ${chainType} 钱包地址`));
          return;
        }

        // Step 2: GV Checkin
        const gvSpinner = ora("GV 安全校验...").start();
        let gvCheckinToken: string | undefined;
        try {
          const auth = loadAuth();
          const mcpToken = auth?.mcp_token ?? "";
          const mcpUrl = getServerUrl();
          const gvClient = new GvClient({
            baseUrl: getGvBaseUrl(mcpUrl),
            mcpToken,
            deviceToken: getOrCreateDeviceToken(),
          });

          const checkinResult = await gvClient.txCheckin({
            wallet_address: walletAddress,
            message,
            module: "/wallet/sign-message",
            source: 3,
          });

          gvCheckinToken = checkinResult.checkin_token;
          gvSpinner.succeed("GV 校验通过");

          if (checkinResult.need_otp) {
            const { createInterface } = await import("node:readline");
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const otpCode = await new Promise<string>((resolve) => {
              rl.question(
                chalk.yellow("  请输入 OTP 验证码: "),
                (answer) => {
                  rl.close();
                  resolve(answer.trim());
                },
              );
            });
            const otpSpinner = ora("OTP 验证中...").start();
            await gvClient.verifyOtp(gvCheckinToken, walletAddress, otpCode);
            otpSpinner.succeed("OTP 验证通过");
          }
        } catch (err) {
          gvSpinner.fail(`GV 校验失败: ${(err as Error).message}`);
          return;
        }

        // Step 3: 签名消息
        const signSpinner = ora("签名消息...").start();
        const signArgs: Record<string, unknown> = { chain, message };
        if (gvCheckinToken) signArgs.checkin_token = gvCheckinToken;

        const signResult = extractToolJson<{ signature?: string }>(
          (await mcp.callTool(
            "dex_wallet_sign_message",
            signArgs,
          )) as Record<string, unknown>,
        );

        if (signResult?.signature) {
          signSpinner.succeed("签名成功");
          console.log(chalk.green(`  Signature: ${signResult.signature}`));
        } else {
          signSpinner.fail("签名失败");
          console.log(JSON.stringify(signResult, null, 2));
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });
  shortcut(
    "sign-tx",
    "签名原始交易",
    "dex_wallet_sign_transaction",
    (_opts, pos) => ({ raw_tx: pos[0] }),
    undefined,
    "<raw_tx>",
  );

  // ─── Transaction ─────────────────────────────────────────
  shortcut(
    "gas",
    "查询 Gas 费用 (默认 ETH，SOL 自动构建模拟交易)",
    "dex_tx_gas",
    async (opts, pos, mcp) => {
      const GAS_CHAIN_ALIAS: Record<string, string> = {
        ARB: "ARBITRUM",
        OP: "OPTIMISM",
        AVAX: "AVALANCHE",
        MATIC: "POLYGON",
      };
      const raw = (pos[0] ?? opts.chain ?? "ETH").toUpperCase();
      const chain = GAS_CHAIN_ALIAS[raw] ?? raw;
      const args: Record<string, unknown> = { chain };

      if (chain === "SOL") {
        const addrRaw = await mcp!.callTool("dex_wallet_get_addresses", {});
        const addrData = extractToolJson<{
          addresses?: Record<string, string>;
        }>(addrRaw as Record<string, unknown>);
        const from = opts.from ?? addrData.addresses?.["SOL"] ?? "";
        const to = opts.to ?? "So11111111111111111111111111111111111111112";
        args.from = from;
        args.to = to;

        if (opts.data) {
          args.data = opts.data;
        } else {
          const unsignedRaw = await mcp!.callTool("dex_tx_get_sol_unsigned", {
            from,
            to,
            amount: opts.amount ?? "0.000001",
          });
          const unsignedData = extractToolJson<{ unsigned_tx_hex?: string }>(
            unsignedRaw as Record<string, unknown>,
          );
          if (unsignedData.unsigned_tx_hex) {
            args.data = b58ToB64(unsignedData.unsigned_tx_hex);
          }
        }
        if (opts.value) args.value = opts.value;
      } else {
        if (opts.from) args.from = opts.from;
        if (opts.to) args.to = opts.to;
      }
      return args;
    },
    [
      ["--chain <chain>", "链名 (ETH/SOL/BSC...)"],
      ["--from <address>", "发送方地址 (SOL 默认自动获取)"],
      ["--to <address>", "接收方地址 (SOL 默认同 from)"],
      ["--amount <amount>", "模拟转账金额 (SOL 用，默认 0.000001)"],
      ["--value <lamports>", "金额 lamports (SOL 可选)"],
      ["--data <base64>", "完整序列化交易 base64 (SOL 可选，默认自动构建)"],
    ],
    "[chain]",
  );
  shortcut(
    "transfer",
    "转账预览",
    "dex_tx_transfer_preview",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain.toUpperCase();
      if (opts.from) args.from = opts.from;
      if (opts.to) args.to = opts.to;
      if (opts.amount) args.amount = opts.amount;
      if (opts.token) {
        if (opts.chain && opts.chain.toUpperCase() === "SOL") {
          args.token_mint = opts.token;
          if (opts.tokenDecimals)
            args.token_decimals = Number(opts.tokenDecimals);
        } else {
          args.token_contract = opts.token;
        }
        if (opts.tokenSymbol) {
          args.token = opts.tokenSymbol;
        }
      } else if (opts.chain && opts.chain.toUpperCase() === "SOL") {
        args.token = "SOL";
      } else {
        args.token = "ETH";
      }
      return args;
    },
    [
      ["--chain <chain>", "链名 (ETH/BSC/SOL...)"],
      ["--to <address>", "收款地址"],
      ["--amount <amount>", "金额"],
      ["--from <address>", "付款地址 (默认自动获取)"],
      ["--token <contract>", "Token 合约/Mint 地址 (原生币可不填)"],
      ["--token-decimals <decimals>", "Token 精度 (SOL SPL 代币需要)"],
      ["--token-symbol <symbol>", "Token 符号 (用于显示，如 TRUMP/USDC)"],
    ],
  );
  // ─── 一键转账 (Preview → Sign → Broadcast) ────────────
  program
    .command("send")
    .description("一键转账 (Preview→Sign→Broadcast)")
    .option("--chain <chain>", "链名 (ETH/SOL/BSC...)")
    .option("--to <address>", "收款地址")
    .option("--amount <amount>", "金额")
    .option("--from <address>", "付款地址 (默认自动获取)")
    .option("--token <contract>", "Token 合约/Mint 地址 (原生币可不填)")
    .option(
      "--token-decimals <decimals>",
      "Token 精度 (SPL 代币必填或自动查询)",
    )
    .option("--token-symbol <symbol>", "Token 符号 (用于显示，如 TRUMP/USDC)")
    .action(async function (
      this: Command,
      opts: Record<string, string | undefined>,
    ) {
      try {
        const mcp = await ensureAuthedMcp();
        const chain = (opts.chain ?? "ETH").toUpperCase();

        const addrRes = extractToolJson<{
          account_id?: string;
          addresses?: Record<string, string>;
        }>(
          (await mcp.callTool("dex_wallet_get_addresses", {})) as Record<
            string,
            unknown
          >,
        );
        const accountId = addrRes.account_id ?? "";
        const from =
          opts.from ??
          (chain === "SOL"
            ? addrRes.addresses?.["SOL"]
            : addrRes.addresses?.["EVM"]) ??
          "";

        if (!opts.to || !opts.amount) {
          console.error(chalk.red("--to 和 --amount 是必填项"));
          return;
        }

        // Auto-resolve token_decimals and token symbol for SPL/ERC20 transfers
        let tokenDecimals: number | undefined;
        let tokenSymbol: string | undefined = opts.tokenSymbol;
        if (opts.tokenDecimals) {
          tokenDecimals = Number(opts.tokenDecimals);
        }
        if (opts.token && chain === "SOL" && (!tokenDecimals || !tokenSymbol)) {
          try {
            const tokenListRes = extractToolJson<{
              tokens?: Array<{
                address?: string;
                decimal?: number;
                symbol?: string;
              }>;
            }>(
              (await mcp.callTool("dex_token_list_swap_tokens", {
                chain_name: "solana",
                search: opts.token,
              })) as Record<string, unknown>,
            );
            const matched = tokenListRes.tokens?.find(
              (t) => t.address?.toLowerCase() === opts.token!.toLowerCase(),
            );
            if (matched?.decimal != null && !tokenDecimals) {
              tokenDecimals = matched.decimal;
            }
            if (matched?.symbol && !tokenSymbol) {
              tokenSymbol = matched.symbol;
            }
          } catch {
            // ignore lookup failure; will fail at preview if decimals truly required
          }
        } else if (opts.token && chain !== "SOL" && !tokenSymbol) {
          try {
            const chainName =
              chain === "ETH" ? "ethereum" : chain.toLowerCase();
            const tokenListRes = extractToolJson<{
              tokens?: Array<{ address?: string; symbol?: string }>;
            }>(
              (await mcp.callTool("dex_token_list_swap_tokens", {
                chain_name: chainName,
                search: opts.token,
              })) as Record<string, unknown>,
            );
            const matched = tokenListRes.tokens?.find(
              (t) => t.address?.toLowerCase() === opts.token!.toLowerCase(),
            );
            if (matched?.symbol) {
              tokenSymbol = matched.symbol;
            }
          } catch {
            // ignore
          }
        }

        // Step 1: Preview
        const previewSpinner = ora("转账预览...").start();
        const previewArgs: Record<string, unknown> = {
          chain,
          from,
          to: opts.to,
          amount: opts.amount,
        };
        if (opts.token) {
          if (chain === "SOL") {
            previewArgs.token_mint = opts.token;
            if (tokenDecimals != null) {
              previewArgs.token_decimals = tokenDecimals;
            }
          } else {
            previewArgs.token_contract = opts.token;
          }
          if (tokenSymbol) {
            previewArgs.token = tokenSymbol;
          }
        } else if (chain === "SOL") {
          previewArgs.token = "SOL";
        } else {
          previewArgs.token = "ETH";
        }
        let previewResult = extractToolJson<{
          key_info?: Record<string, unknown>;
          unsigned_tx_hex?: string;
          confirm_message?: string;
        }>(
          (await mcp.callTool(
            "dex_tx_transfer_preview",
            previewArgs,
          )) as Record<string, unknown>,
        );

        const unsignedTx =
          previewResult.unsigned_tx_hex ??
          ((previewResult.key_info as Record<string, unknown> | undefined)
            ?.unsigned_tx_hex as string | undefined);

        if (!unsignedTx) {
          previewSpinner.fail("预览失败：未获得 unsigned_tx_hex");
          console.log(JSON.stringify(previewResult, null, 2));
          return;
        }

        const keyInfo = previewResult.key_info ?? {};
        const token = (keyInfo.token as string) ?? chain;
        previewSpinner.succeed(
          `预览成功：${keyInfo.summary ?? `${opts.amount} ${token} → ${opts.to}`}`,
        );

        // SOL native: refresh blockhash via get_sol_unsigned (SPL tokens skip — get_sol_unsigned only supports native SOL)
        let txToSign = unsignedTx;
        if (chain === "SOL" && !opts.token) {
          const freshSpinner = ora("获取最新 blockhash...").start();
          const solArgs: Record<string, unknown> = {
            from,
            to: opts.to,
            amount: opts.amount,
          };
          const freshResult = extractToolJson<{ unsigned_tx_hex?: string }>(
            (await mcp.callTool("dex_tx_get_sol_unsigned", solArgs)) as Record<
              string,
              unknown
            >,
          );
          if (freshResult.unsigned_tx_hex) {
            txToSign = freshResult.unsigned_tx_hex;
            freshSpinner.succeed("已获取最新 unsigned_tx");
          } else {
            freshSpinner.warn("未能刷新 blockhash，使用预览的 unsigned_tx");
          }
        }

        // Step 2: GV Checkin（获取 checkin_token，用于后续签名校验）
        const gvSpinner = ora("GV 安全校验...").start();
        let gvCheckinToken: string | undefined;
        try {
          const auth = loadAuth();
          const mcpToken = auth?.mcp_token ?? "";
          const mcpUrl = getServerUrl();
          const gvClient = new GvClient({
            baseUrl: getGvBaseUrl(mcpUrl),
            mcpToken,
            deviceToken: getOrCreateDeviceToken(),
          });

          const checkinResult = await gvClient.txCheckin({
            wallet_address: from,
            intent: {
              chain,
              from,
              to: opts.to,
              amount: opts.amount,
              token: token,
            },
            module: "/wallet/transfer",
            source: 3, // aiAgent，用于 MCP 相关业务
          });

          gvCheckinToken = checkinResult.checkin_token;
          gvSpinner.succeed("GV 校验通过");

          if (checkinResult.need_otp) {
            const { createInterface } = await import("node:readline");
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const otpCode = await new Promise<string>((resolve) => {
              rl.question(chalk.yellow("  请输入 OTP 验证码: "), (answer) => {
                rl.close();
                resolve(answer.trim());
              });
            });
            const otpSpinner = ora("OTP 验证中...").start();
            await gvClient.verifyOtp(gvCheckinToken, from, otpCode);
            otpSpinner.succeed("OTP 验证通过");
          }
        } catch (err) {
          gvSpinner.fail(`GV 校验失败: ${(err as Error).message}`);
          return;
        }

        // Step 3: Sign
        const signSpinner = ora("签名交易...").start();
        const signArgs: Record<string, unknown> = {
          chain: chain,
          raw_tx: txToSign,
        };
        if (gvCheckinToken) {
          signArgs.checkin_token = gvCheckinToken;
        }
        const signResult = extractToolJson<{
          signedTransaction?: string;
          signature?: string;
        }>(
          (await mcp.callTool(
            "dex_wallet_sign_transaction",
            signArgs,
          )) as Record<string, unknown>,
        );

        const signedTx = signResult.signedTransaction;
        if (!signedTx) {
          signSpinner.fail("签名失败");
          console.log(JSON.stringify(signResult, null, 2));
          return;
        }
        signSpinner.succeed("签名成功");

        // Step 3: Broadcast
        const broadcastSpinner = ora("广播交易...").start();
        const sendResult = extractToolJson<{
          hash?: string;
          explorer_url?: string;
        }>(
          (await mcp.callTool("dex_tx_send_raw_transaction", {
            chain,
            signed_tx: signedTx,
            account_id: accountId,
            address: from,
            trans_oppo_address: opts.to,
            token_short_name: token,
            trans_balance: opts.amount,
            trans_type: "transfer",
          })) as Record<string, unknown>,
        );

        if (sendResult.hash) {
          broadcastSpinner.succeed("交易已广播");
          console.log(chalk.green(`  Hash: ${sendResult.hash}`));
          if (sendResult.explorer_url) {
            console.log(chalk.gray(`  Explorer: ${sendResult.explorer_url}`));
          }
        } else {
          broadcastSpinner.fail("广播失败");
          console.log(JSON.stringify(sendResult, null, 2));
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });

  shortcut(
    "quote",
    "获取兑换报价 (ETH→USDT: --from-chain 1 --to-chain 1 --from - --to 0xdAC1...ec7 --native-in 1 --native-out 0)",
    "dex_tx_quote",
    async (opts, _pos, mcp) => {
      const args: Record<string, unknown> = {};
      if (opts.fromChain) args.chain_id_in = Number(opts.fromChain);
      if (opts.toChain) args.chain_id_out = Number(opts.toChain);
      if (opts.from) args.token_in = opts.from;
      if (opts.to) args.token_out = opts.to;
      if (opts.amount) args.amount = opts.amount;
      if (opts.slippage) {
        const raw = Number(opts.slippage);
        args.slippage = raw >= 1 ? raw / 100 : raw;
      }
      if (opts.nativeIn) args.native_in = Number(opts.nativeIn);
      if (opts.nativeOut) args.native_out = Number(opts.nativeOut);
      if (opts.wallet) {
        args.user_wallet = opts.wallet;
      } else {
        const addrRes = (await mcp!.callTool(
          "dex_wallet_get_addresses",
          {},
        )) as Record<string, unknown>;
        const addresses = addrRes.addresses as
          | Record<string, string>
          | undefined;
        const chainId = Number(opts.fromChain ?? 1);
        args.user_wallet =
          chainId === 501 ? addresses?.["SOL"] : addresses?.["EVM"];
      }
      return args;
    },
    [
      ["--from-chain <id>", "源链 ID (ETH=1, BSC=56, SOL=501...)", "1"],
      ["--to-chain <id>", "目标链 ID (同链 swap 则和 from-chain 相同)", "1"],
      ["--from <token>", "源 token 地址, 原生币用 -"],
      ["--to <token>", "目标 token 合约地址"],
      ["--amount <amount>", "数量"],
      ["--slippage <pct>", "滑点 (0.03=3%)", "0.03"],
      ["--native-in <0|1>", "源 token 是否原生币 (1=是, 0=否)"],
      ["--native-out <0|1>", "目标 token 是否原生币 (1=是, 0=否)"],
      ["--wallet <address>", "钱包地址 (默认自动获取)"],
    ],
  );
  program
    .command("swap")
    .description(
      "一键兑换 (Quote → Confirm → Prepare → GV Checkin → Sign → Submit)",
    )
    .option("--from-chain <id>", "源链 ID (ETH=1, BSC=56, ARB=42161, SOL=501...)", "1")
    .option("--to-chain <id>", "目标链 ID (同链则与 from-chain 相同)")
    .option("--from <token>", "源 token 合约地址，原生币用 -")
    .option("--to <token>", "目标 token 合约地址")
    .option("--amount <amount>", "数量")
    .option("--slippage <pct>", "滑点 (0.03=3%，0.5=50%)", "0.03")
    .option("--native-in <0|1>", "源 token 是否原生币 (1=是)", "0")
    .option("--native-out <0|1>", "目标 token 是否原生币 (1=是)", "0")
    .option("--wallet <address>", "源链钱包地址（默认自动获取）")
    .option("--to-wallet <address>", "目标链钱包地址（跨链时需要）")
    .action(async function (this: Command, opts: Record<string, string | undefined>) {
      try {
        const mcp = await ensureAuthedMcp();

        // Step 1: 获取钱包地址
        const addrRes = extractToolJson<{
          account_id?: string;
          addresses?: Record<string, string>;
        }>(
          (await mcp.callTool("dex_wallet_get_addresses", {})) as Record<string, unknown>,
        );
        const accountId = addrRes?.account_id ?? "";
        const addresses = addrRes?.addresses ?? {};
        const chainIdIn = Number(opts.fromChain ?? 1);
        const chainIdOut = Number(opts.toChain ?? opts.fromChain ?? 1);
        const wallet =
          opts.wallet ??
          (chainIdIn === 501 ? addresses["SOL"] : addresses["EVM"]) ??
          "";

        const rawSlippage = Number(opts.slippage ?? "0.03");
        const slippage = rawSlippage >= 1 ? rawSlippage / 100 : rawSlippage;

        // Step 2: Quote
        const quoteSpinner = ora("获取报价...").start();
        const quoteArgs: Record<string, unknown> = {
          chain_id_in: chainIdIn,
          chain_id_out: chainIdOut,
          token_in: opts.from,
          token_out: opts.to,
          amount: opts.amount,
          slippage,
          user_wallet: wallet,
          native_in: Number(opts.nativeIn ?? "0"),
          native_out: Number(opts.nativeOut ?? "0"),
        };
        if (opts.toWallet) quoteArgs.to_wallet = opts.toWallet;

        const quoteResult = extractToolJson<{
          to_amount?: string;
          to_amount_usd?: string;
          price_impact?: string;
          gas_fee_usd?: string;
          routes?: Array<{ need_approved?: number; path?: string[] }>;
        }>(
          (await mcp.callTool("dex_tx_swap_quote", quoteArgs)) as Record<string, unknown>,
        );
        quoteSpinner.succeed("报价获取成功");

        console.log(chalk.bold("\n兑换预览："));
        console.log(`  获得：${chalk.green(quoteResult?.to_amount ?? "-")} (~$${quoteResult?.to_amount_usd ?? "-"})`);
        console.log(`  价格影响：${quoteResult?.price_impact ?? "-"}`);
        console.log(`  Gas 费用：~$${quoteResult?.gas_fee_usd ?? "-"}`);
        const needApproved = quoteResult?.routes?.[0]?.need_approved === 2;
        if (needApproved) {
          console.log(chalk.yellow("  ⚠️  需要先进行 Token 授权（Approve）"));
        }

        // Step 3: 用户确认
        const { createInterface } = await import("node:readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const confirm = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow("\n确认兑换? (y/N): "), (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
        });
        if (confirm !== "y") {
          console.log(chalk.gray("已取消"));
          return;
        }

        // Step 4: Prepare
        const prepareSpinner = ora("准备兑换会话...").start();
        const prepareArgs: Record<string, unknown> = {
          ...quoteArgs,
          account_id: accountId,
        };
        const prepareResult = extractToolJson<{
          swap_session_id?: string;
          need_approved?: boolean;
        }>(
          (await mcp.callTool("dex_tx_swap_prepare", prepareArgs)) as Record<string, unknown>,
        );
        const swapSessionId = prepareResult?.swap_session_id;
        if (!swapSessionId) {
          prepareSpinner.fail("Prepare 失败，未获得 swap_session_id");
          console.log(JSON.stringify(prepareResult, null, 2));
          return;
        }
        prepareSpinner.succeed(`会话创建成功 (${swapSessionId.slice(0, 8)}...)`);

        // Step 5: Approve（如需要）
        if (prepareResult?.need_approved) {
          const approveGvSpinner = ora("GV 安全校验（Approve 阶段）...").start();
          let approveCheckinToken: string;
          try {
            approveCheckinToken = await performSwapGvCheckin(mcp, swapSessionId, "approve");
            approveGvSpinner.succeed("GV 校验通过（Approve）");
          } catch (err) {
            approveGvSpinner.fail(`GV 校验失败: ${(err as Error).message}`);
            return;
          }

          const approveSpinner = ora("签名 Approve...").start();
          const approveResult = extractToolJson<{ success?: boolean }>(
            (await mcp.callTool("dex_tx_swap_sign_approve", {
              swap_session_id: swapSessionId,
              checkin_token: approveCheckinToken,
            })) as Record<string, unknown>,
          );
          if (!approveResult) {
            approveSpinner.fail("Approve 签名失败");
            return;
          }
          approveSpinner.succeed("Approve 签名成功");
        }

        // Step 6: Swap GV Checkin
        const swapGvSpinner = ora("GV 安全校验（Swap 阶段）...").start();
        let swapCheckinToken: string;
        try {
          swapCheckinToken = await performSwapGvCheckin(mcp, swapSessionId, "swap");
          swapGvSpinner.succeed("GV 校验通过（Swap）");
        } catch (err) {
          swapGvSpinner.fail(`GV 校验失败: ${(err as Error).message}`);
          return;
        }

        // Step 7: Sign Swap
        const signSwapSpinner = ora("签名兑换交易...").start();
        const signSwapResult = extractToolJson<{ success?: boolean }>(
          (await mcp.callTool("dex_tx_swap_sign_swap", {
            swap_session_id: swapSessionId,
            checkin_token: swapCheckinToken,
          })) as Record<string, unknown>,
        );
        if (!signSwapResult) {
          signSwapSpinner.fail("Swap 签名失败");
          return;
        }
        signSwapSpinner.succeed("Swap 签名成功");

        // Step 8: Submit
        const submitSpinner = ora("提交兑换...").start();
        const submitResult = extractToolJson<{
          tx_order_id?: string;
          tx_hash?: string;
          explorer_url?: string;
        }>(
          (await mcp.callTool("dex_tx_swap_submit", {
            swap_session_id: swapSessionId,
          })) as Record<string, unknown>,
        );

        if (submitResult?.tx_order_id || submitResult?.tx_hash) {
          submitSpinner.succeed("兑换已提交");
          if (submitResult.tx_hash) {
            console.log(chalk.green(`  Hash: ${submitResult.tx_hash}`));
          }
          if (submitResult.tx_order_id) {
            console.log(chalk.gray(`  Order ID: ${submitResult.tx_order_id}`));
          }
          if (submitResult.explorer_url) {
            console.log(chalk.gray(`  Explorer: ${submitResult.explorer_url}`));
          }
        } else {
          submitSpinner.fail("提交失败");
          console.log(JSON.stringify(submitResult, null, 2));
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });
  shortcut(
    "swap-detail",
    "查询兑换交易详情",
    "dex_tx_swap_detail",
    (_opts, pos) => ({ tx_order_id: pos[0] }),
    undefined,
    "<order_id>",
  );
  shortcut(
    "send-tx",
    "广播已签名交易（自动获取 account_id 和 address）",
    "dex_tx_send_raw_transaction",
    async (opts, _pos, mcp) => {
      const addrRes = (await mcp!.callTool(
        "dex_wallet_get_addresses",
        {},
      )) as Record<string, unknown>;
      const accountId = addrRes.account_id as string;
      const chain = (opts.chain ?? "ETH").toUpperCase();
      const addresses = addrRes.addresses as Record<string, string> | undefined;
      const fromAddr =
        opts.address ?? addresses?.[chain === "ETH" ? "EVM" : chain] ?? "";

      const args: Record<string, unknown> = {
        chain,
        signed_tx: opts.hex,
        account_id: accountId,
        address: fromAddr,
        trans_oppo_address: opts.to,
        token_short_name: opts.token ?? chain,
        trans_balance: opts.amount ?? "0",
        trans_type: opts.type ?? "transfer",
      };
      return args;
    },
    [
      ["--chain <chain>", "链名，如 ETH", "ETH"],
      ["--hex <signed_tx>", "签名后的交易 hex"],
      ["--to <to>", "接收方地址"],
      ["--token <symbol>", "代币名称，如 ETH / USDT"],
      ["--amount <amount>", "转账金额"],
      ["--address <from>", "发送方地址（默认自动获取）"],
      ["--type <type>", "交易类型", "transfer"],
    ],
  );
  shortcut(
    "tx-detail",
    "查询交易详情 (by hash)",
    "dex_tx_detail",
    (_opts, pos) => ({ hash_id: pos[0] }),
    undefined,
    "<tx_hash>",
  );
  shortcut(
    "tx-history",
    "查询交易历史",
    "dex_tx_list",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.page) args.page_num = opts.page;
      if (opts.limit) args.page_size = opts.limit;
      return args;
    },
    [
      ["--page <n>", "页码", "1"],
      ["--limit <n>", "每页条数", "20"],
    ],
  );
  shortcut(
    "swap-history",
    "查询 Swap/Bridge 交易历史",
    "dex_tx_history_list",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.page) args.page_num = Number(opts.page);
      if (opts.limit) args.page_size = Number(opts.limit);
      return args;
    },
    [
      ["--page <n>", "页码", "1"],
      ["--limit <n>", "每页条数", "20"],
    ],
  );
  shortcut(
    "sol-tx",
    "构建 Solana 未签名转账交易",
    "dex_tx_get_sol_unsigned",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.to) args.to_address = opts.to;
      if (opts.amount) args.amount = opts.amount;
      if (opts.mint) args.token_mint = opts.mint;
      return args;
    },
    [
      ["--to <address>", "收款地址"],
      ["--amount <amount>", "金额"],
      ["--mint <address>", "SPL Token Mint (原生 SOL 可不填)"],
    ],
  );

  // ─── Market ──────────────────────────────────────────────
  shortcut(
    "kline",
    "查询 K 线数据",
    "dex_market_get_kline",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.address) args.token_address = opts.address;
      if (opts.period) args.period = opts.period;
      return args;
    },
    [
      ["--chain <chain>", "链名 (eth/bsc/solana...)"],
      ["--address <addr>", "Token 合约地址"],
      ["--period <period>", "时间周期 (1m/5m/1h/4h/1d)", "1h"],
    ],
  );
  shortcut(
    "liquidity",
    "查询流动性池事件",
    "dex_market_get_pair_liquidity",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.address) args.token_address = opts.address;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--address <addr>", "Token 合约地址"],
    ],
  );
  shortcut(
    "tx-stats",
    "查询交易量统计 (5m/1h/4h/24h)",
    "dex_market_get_tx_stats",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.address) args.token_address = opts.address;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--address <addr>", "Token 合约地址"],
    ],
  );
  shortcut(
    "swap-tokens",
    "查询链上可兑换 Token 列表",
    "dex_token_list_swap_tokens",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.search) args.search = opts.search;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--search <keyword>", "搜索关键词 (symbol/address)"],
    ],
  );
  shortcut(
    "bridge-tokens",
    "查询跨链桥目标 Token",
    "dex_token_list_cross_chain_bridge_tokens",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.srcChain) args.source_chain = opts.srcChain;
      if (opts.destChain) args.chain = opts.destChain;
      if (opts.token) args.source_address = opts.token;
      return args;
    },
    [
      ["--src-chain <chain>", "源链"],
      ["--dest-chain <chain>", "目标链"],
      ["--token <address>", "源 Token 地址"],
    ],
  );

  // ─── Token ───────────────────────────────────────────────
  shortcut(
    "token-info",
    "查询 Token 详情 (价格/市值/持仓分布)",
    "dex_token_get_coin_info",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.address) args.address = opts.address;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--address <addr>", "Token 合约地址"],
    ],
  );
  shortcut(
    "token-risk",
    "查询 Token 安全审计信息",
    "dex_token_get_risk_info",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.address) args.address = opts.address;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--address <addr>", "Token 合约地址"],
    ],
  );
  shortcut(
    "token-rank",
    "Token 涨跌幅排行榜 (24h)",
    "dex_token_ranking",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.limit) args.limit = Number(opts.limit);
      if (opts.direction) args.direction = opts.direction;
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--limit <n>", "Top N", "10"],
      ["--direction <dir>", "desc (涨幅) | asc (跌幅)", "desc"],
    ],
  );
  shortcut(
    "new-tokens",
    "按创建时间筛选新 Token",
    "dex_token_get_coins_range_by_created_at",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.start) args.start = opts.start;
      args.end = opts.end ?? new Date().toISOString();
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--start <time>", "开始时间 (RFC3339, 如 2026-03-08T00:00:00Z)"],
      ["--end <time>", "结束时间 (RFC3339)"],
    ],
  );

  // ─── Chain / RPC ─────────────────────────────────────────
  shortcut(
    "chain-config",
    "查询链配置 (networkKey, endpoint, chainID)",
    "dex_chain_config",
    (_opts, pos) => (pos[0] ? { chain: pos[0].toUpperCase() } : {}),
    undefined,
    "[chain]",
  );
  shortcut(
    "rpc",
    "执行 JSON-RPC 调用 (eth_blockNumber, eth_getBalance...)",
    "dex_rpc_call",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain.toUpperCase();
      if (opts.method) args.method = opts.method;
      if (opts.params) {
        try {
          args.params = JSON.parse(opts.params);
        } catch {
          args.params = opts.params;
        }
      }
      return args;
    },
    [
      ["--chain <chain>", "链名"],
      ["--method <method>", "RPC 方法 (eth_blockNumber...)"],
      ["--params <json>", "参数 JSON 数组"],
    ],
  );
}

// ─── MCP Device Flow 登录 ────────────────────────────────

async function loginWithDeviceFlow(
  mcp: GateMcpClient,
  serverUrl: string,
  isGoogle: boolean,
  provider: string,
) {
  const loginSpinner = ora(`Starting ${provider} OAuth login...`).start();

  let startResult;
  try {
    startResult = isGoogle
      ? await mcp.authGoogleLoginStart()
      : await mcp.authGateLoginStart();
  } catch (err) {
    loginSpinner.fail(`Failed to start device flow: ${(err as Error).message}`);
    return;
  }

  const parsed = parseToolResult<{
    flow_id?: string;
    verification_url?: string;
    user_code?: string;
    expires_in?: number;
    interval?: number;
  }>(startResult);

  if (!parsed?.verification_url || !parsed?.flow_id) {
    loginSpinner.fail("Failed to start login flow (invalid response)");
    return;
  }

  loginSpinner.succeed("Login flow started");

  if (parsed.user_code) {
    console.log(chalk.gray(`  Code: ${parsed.user_code}`));
  }

  const opened = await openBrowser(parsed.verification_url);
  if (opened) {
    console.log(chalk.green("  ✔ Browser opened — please authorize there."));
  }

  const pollSpinner = ora("Waiting for authorization...").start();
  const intervalMs = (parsed.interval ?? 5) * 1000;
  const deadline = Date.now() + (parsed.expires_in ?? 1800) * 1000;

  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSigint);

  while (Date.now() < deadline && !cancelled) {
    await sleep(intervalMs);

    try {
      const pollResult = isGoogle
        ? await mcp.authGoogleLoginPoll(parsed.flow_id)
        : await mcp.authGateLoginPoll(parsed.flow_id);

      const poll = parseToolResult<{
        status: string;
        access_token?: string;
        mcp_token?: string;
        user_id?: string;
        error?: string;
        expires_in?: number;
      }>(pollResult);

      if (!poll) continue;

      if (poll.status === "ok") {
        const token = poll.access_token ?? poll.mcp_token;
        if (token) {
          mcp.setMcpToken(token);
          process.removeListener("SIGINT", onSigint);
          pollSpinner.succeed("Login successful!");

          saveAuth({
            mcp_token: token,
            provider: isGoogle ? "google" : "gate",
            user_id: poll.user_id,
            expires_at: poll.expires_in
              ? Date.now() + poll.expires_in * 1000
              : Date.now() + 30 * 86_400_000,
            env: "default",
            server_url: serverUrl,
          });

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          console.log(chalk.green(`  Wallet: custodial (${provider})`));
          console.log(chalk.gray(`  Token saved to ${getAuthFilePath()}`));

          await reportWalletAddresses(mcp);
          return;
        }
      }

      if (poll.status === "error") {
        process.removeListener("SIGINT", onSigint);
        pollSpinner.fail(`Login failed: ${poll.error ?? "Unknown error"}`);
        return;
      }
    } catch {
      // poll 请求失败，继续轮询
    }
  }

  process.removeListener("SIGINT", onSigint);
  pollSpinner.fail(cancelled ? "Login cancelled" : "Login timed out");
}

// ─── Google OAuth 登录（REST API + 服务端回调）─────────────

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_CLIENT_ID =
  "663295861438-ehhqhr8j2cn3hailtjmedtbcd806vca6.apps.googleusercontent.com";
const GOOGLE_SCOPE = "openid email profile";

interface DeviceStartResponse {
  flow_id?: string;
  device_code?: string;
  user_code?: string;
  verification_url?: string;
  expires_in?: number;
  interval?: number;
  state?: string;
  error?: string;
}

interface DevicePollResponse {
  status: string;
  access_token?: string;
  mcp_token?: string;
  user_id?: string;
  wallet_address?: string;
  expires_in?: number;
  error?: string;
}

async function loginGoogleViaRest(mcp: GateMcpClient, serverUrl: string) {
  const baseUrl = mcp.getServerBaseUrl();
  const callbackUrl = `${baseUrl}/oauth/google/device/callback`;
  const loginSpinner = ora("Starting Google OAuth login...").start();

  // 1. 通过 REST API 启动 Google OAuth device flow
  let flowData: DeviceStartResponse;
  try {
    const res = await fetch(`${baseUrl}/oauth/google/device/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": buildUserAgent(),
        "x-gtweb3-device-token": getOrCreateDeviceToken(),
        "source": "3",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }

    flowData = (await res.json()) as DeviceStartResponse;
  } catch (err) {
    loginSpinner.fail(
      `Failed to start Google login: ${(err as Error).message}`,
    );
    return;
  }

  if (flowData.error) {
    loginSpinner.fail(`Google login error: ${flowData.error}`);
    return;
  }

  // 2. 如果服务端返回了 verification_url，直接用；否则手动构建
  let authUrl: string;
  if (flowData.verification_url) {
    authUrl = flowData.verification_url;
  } else {
    const state = flowData.state ?? flowData.flow_id ?? "";
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (state) url.searchParams.set("state", state);
    authUrl = url.toString();
  }

  const flowId = flowData.flow_id ?? flowData.device_code ?? "";
  if (!flowId) {
    loginSpinner.fail("Failed to start Google login: no flow_id returned");
    return;
  }

  loginSpinner.succeed("Google OAuth flow started");

  if (flowData.user_code) {
    console.log(chalk.gray(`  Code: ${flowData.user_code}`));
  }

  const opened = await openBrowser(authUrl);
  if (opened) {
    console.log(chalk.green("  ✔ Browser opened — please authorize there."));
  }

  // 4. 轮询等待结果
  const pollSpinner = ora("Waiting for Google authorization...").start();
  const intervalMs = (flowData.interval ?? 5) * 1000;
  const deadline = Date.now() + (flowData.expires_in ?? 1800) * 1000;

  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSigint);

  while (Date.now() < deadline && !cancelled) {
    await sleep(intervalMs);

    try {
      const res = await fetch(`${baseUrl}/oauth/google/device/poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": buildUserAgent(),
          "x-gtweb3-device-token": getOrCreateDeviceToken(),
          "source": "3",
        },
        body: JSON.stringify({ flow_id: flowId }),
      });

      if (!res.ok) continue;

      const poll = (await res.json()) as DevicePollResponse;

      if (poll.status === "ok") {
        const token = poll.access_token ?? poll.mcp_token;
        if (token) {
          mcp.setMcpToken(token);
          process.removeListener("SIGINT", onSigint);
          pollSpinner.succeed("Google login successful!");

          const sessionId = await fetchLoginSessionId(serverUrl, token);

          saveAuth({
            mcp_token: token,
            provider: "google",
            user_id: poll.user_id,
            expires_at: poll.expires_in
              ? Date.now() + poll.expires_in * 1000
              : Date.now() + 30 * 86_400_000,
            session_id: sessionId,
            env: "default",
            server_url: serverUrl,
          });

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          if (poll.wallet_address)
            console.log(chalk.green(`  Wallet: ${poll.wallet_address}`));
          console.log(chalk.green(`  Provider: Google`));
          console.log(chalk.gray(`  Token saved to ${getAuthFilePath()}`));

          await reportWalletAddresses(mcp);
          return;
        }
      }

      if (poll.status === "error") {
        process.removeListener("SIGINT", onSigint);
        pollSpinner.fail(
          `Google login failed: ${poll.error ?? "Unknown error"}`,
        );
        return;
      }
    } catch {
      // poll 失败，继续轮询
    }
  }

  process.removeListener("SIGINT", onSigint);
  pollSpinner.fail(cancelled ? "Login cancelled" : "Login timed out");
}

// ─── Gate OAuth 登录（REST API + 服务端回调）──────────────

async function loginGateViaRest(mcp: GateMcpClient, serverUrl: string) {
  const baseUrl = mcp.getServerBaseUrl();
  const loginSpinner = ora("Starting Gate OAuth login...").start();

  let flowData: DeviceStartResponse;
  try {
    const res = await fetch(`${baseUrl}/oauth/gate/device/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": buildUserAgent(),
        "x-gtweb3-device-token": getOrCreateDeviceToken(),
        "source": "3",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }

    flowData = (await res.json()) as DeviceStartResponse;
  } catch (err) {
    loginSpinner.fail(`Failed to start Gate login: ${(err as Error).message}`);
    return;
  }

  if (flowData.error) {
    loginSpinner.fail(`Gate login error: ${flowData.error}`);
    return;
  }

  if (!flowData.verification_url || !flowData.flow_id) {
    loginSpinner.fail(
      "Failed to start Gate login: no verification_url returned",
    );
    return;
  }

  loginSpinner.succeed("Gate OAuth flow started");

  if (flowData.user_code) {
    console.log(chalk.gray(`  Code: ${flowData.user_code}`));
  }

  const opened = await openBrowser(flowData.verification_url);
  if (opened) {
    console.log(chalk.green("  ✔ Browser opened — please authorize there."));
  }

  const pollSpinner = ora("Waiting for Gate authorization...").start();
  const intervalMs = (flowData.interval ?? 5) * 1000;
  const deadline = Date.now() + (flowData.expires_in ?? 1800) * 1000;

  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.once("SIGINT", onSigint);

  while (Date.now() < deadline && !cancelled) {
    await sleep(intervalMs);

    try {
      const res = await fetch(`${baseUrl}/oauth/gate/device/poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": buildUserAgent(),
          "x-gtweb3-device-token": getOrCreateDeviceToken(),
          "source": "3",
        },
        body: JSON.stringify({ flow_id: flowData.flow_id }),
      });

      if (!res.ok) continue;

      const poll = (await res.json()) as DevicePollResponse;

      if (poll.status === "ok") {
        const token = poll.access_token ?? poll.mcp_token;
        if (token) {
          mcp.setMcpToken(token);
          process.removeListener("SIGINT", onSigint);
          pollSpinner.succeed("Gate login successful!");

          const sessionId = await fetchLoginSessionId(serverUrl, token);

          saveAuth({
            mcp_token: token,
            provider: "gate",
            user_id: poll.user_id,
            expires_at: poll.expires_in
              ? Date.now() + poll.expires_in * 1000
              : Date.now() + 30 * 86_400_000,
            session_id: sessionId,
            env: "default",
            server_url: serverUrl,
          });

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          if (poll.wallet_address)
            console.log(chalk.green(`  Wallet: ${poll.wallet_address}`));
          console.log(chalk.green(`  Provider: Gate`));
          console.log(chalk.gray(`  Token saved to ${getAuthFilePath()}`));

          await reportWalletAddresses(mcp);
          return;
        }
      }

      if (poll.status === "error") {
        process.removeListener("SIGINT", onSigint);
        pollSpinner.fail(`Gate login failed: ${poll.error ?? "Unknown error"}`);
        return;
      }
    } catch {
      // poll 失败，继续轮询
    }
  }

  process.removeListener("SIGINT", onSigint);
  pollSpinner.fail(cancelled ? "Login cancelled" : "Login timed out");
}

// ─── 工具函数 ────────────────────────────────────────────

function parseToolResult<T>(
  result: Awaited<ReturnType<GateMcpClient["callTool"]>>,
): T | null {
  if ("content" in result && Array.isArray(result.content)) {
    const text = (
      result.content as Array<{ type: string; text?: string }>
    ).find(
      (c): c is { type: "text"; text: string } =>
        c.type === "text" && typeof c.text === "string",
    );
    if (text) {
      try {
        return JSON.parse(text.text) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58ToB64(b58: string): string {
  let n = BigInt(0);
  for (const ch of b58) {
    n = n * 58n + BigInt(B58_ALPHABET.indexOf(ch));
  }
  const hex = n.toString(16).padStart(2, "0");
  const bytes = Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
  let pad = 0;
  for (const ch of b58) {
    if (ch === "1") pad++;
    else break;
  }
  const result = Buffer.concat([Buffer.alloc(pad), bytes]);
  return result.toString("base64");
}

// ─── 登录后自动上报钱包地址 ──────────────────────────────

interface WalletAddresses {
  account_id?: string;
  addresses?: Record<string, string>;
}

interface AgenticChainAddress {
  networkKey: string;
  accountKey?: string;
  chains: string;
  accountFormat?: string;
  chainAddress: string;
}

const CHAIN_ADDRESS_MAP: Record<
  string,
  Omit<AgenticChainAddress, "chainAddress">
> = {
  EVM: {
    networkKey: "ETH",
    accountKey: "ETH",
    chains: "ETH,ARB,OP,BASE,LINEA,SCROLL,ZKSYNC",
    accountFormat: "",
  },
  SOL: {
    networkKey: "SOL",
    chains: "SOL",
  },
};

async function reportWalletAddresses(mcp: GateMcpClient): Promise<void> {
  const reportSpinner = ora("Reporting wallet addresses...").start();

  try {
    const addrResult = await mcp.callTool("dex_wallet_get_addresses");
    const addrData = parseToolResult<WalletAddresses>(addrResult);

    if (!addrData?.addresses || Object.keys(addrData.addresses).length === 0) {
      reportSpinner.warn("No wallet addresses to report");
      return;
    }

    const chainAddressList: AgenticChainAddress[] = Object.entries(
      addrData.addresses,
    )
      .map(([chainType, address]) => {
        const meta = CHAIN_ADDRESS_MAP[chainType];
        if (!meta) return null;
        return { ...meta, chainAddress: address };
      })
      .filter((item): item is AgenticChainAddress => item !== null);

    if (chainAddressList.length === 0) {
      reportSpinner.warn("No supported chains to report");
      return;
    }

    const wallets = [
      {
        accounts: [{ chainAddressList }],
      },
    ];

    const reportResult = await mcp.callTool("dex_agentic_report", { wallets });
    const report = parseToolResult<{
      wallets?: Array<{ walletID: string; accountID: string[] }>;
    }>(reportResult);

    if (report?.wallets?.length) {
      reportSpinner.succeed(
        `Wallet addresses reported (${chainAddressList.length} chains)`,
      );
      for (const w of report.wallets) {
        console.log(chalk.gray(`  walletID: ${w.walletID}`));
      }
    } else {
      reportSpinner.warn("Wallet report returned empty result");
    }
  } catch (err) {
    reportSpinner.warn(`Wallet report failed: ${(err as Error).message}`);
  }
}

// ─── 登录会话 ─────────────────────────────────────────────

/**
 * 登录成功后调用 login-sessions 接口获取当前会话 id
 * 用于后续 logout 时调用 delete-login-session
 */
async function fetchLoginSessionId(
  serverUrl: string,
  mcpToken: string,
): Promise<string | undefined> {
  try {
    const walletQuickUrl = getWalletQuickBaseUrl(serverUrl);
    const res = await fetch(`${walletQuickUrl}/login-sessions`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": buildUserAgent(),
        "x-gtweb3-device-token": getOrCreateDeviceToken(),
        "source": "3",
        Authorization: `Bearer ${mcpToken}`,
      },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { data?: { id?: string }[] };
    return data.data?.[0]?.id;
  } catch {
    return undefined;
  }
}
