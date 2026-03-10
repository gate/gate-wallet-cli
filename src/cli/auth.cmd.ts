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

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Login (opens browser)")
    .option("--google", "Use Google OAuth instead of Gate")
    .action(async function (this: Command, opts: { google?: boolean }) {
      const serverUrl = getServerUrl();

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

      if (mcp?.isAuthenticated()) {
        console.log(chalk.green("MCP: connected & authenticated"));
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
      const mcp = getMcpClientSync();
      if (mcp?.isAuthenticated()) {
        try {
          await mcp.authLogout();
        } catch {
          // best-effort server-side logout
        }
      }
      console.log(chalk.gray("Logged out."));
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
    throw new Error("Not logged in. Run: login");
  }
  return mcp;
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
  shortcut("balance", "查询总资产余额", "wallet.get_total_asset");
  shortcut("address", "查询钱包地址", "wallet.get_addresses");
  shortcut("tokens", "查询 token 列表和余额", "wallet.get_token_list");
  shortcut(
    "sign-msg",
    "签名消息 (必须为 32 位 hex 字符串，如 aabbccddeeff00112233445566778899)",
    "wallet.sign_message",
    (opts, pos) => {
      const msg = pos[0] ?? "";
      if (!/^[0-9a-fA-F]{32}$/.test(msg)) {
        throw new Error(
          "message 必须为 32 位十六进制字符串 (16 bytes)，例如: aabbccddeeff00112233445566778899",
        );
      }
      return {
        message: msg,
        chain: (opts.chain ?? "EVM").toUpperCase(),
      };
    },
    [["--chain <chain>", "链类型: EVM | SOL", "EVM"]],
    "<message>",
  );
  shortcut(
    "sign-tx",
    "签名原始交易",
    "wallet.sign_transaction",
    (_opts, pos) => ({ raw_tx: pos[0] }),
    undefined,
    "<raw_tx>",
  );

  // ─── Transaction ─────────────────────────────────────────
  shortcut(
    "gas",
    "查询 Gas 费用 (默认 ETH，SOL 自动构建模拟交易)",
    "tx.gas",
    async (opts, pos, mcp) => {
      const chain = (pos[0] ?? opts.chain ?? "ETH").toUpperCase();
      const args: Record<string, unknown> = { chain };

      if (chain === "SOL") {
        const addrRaw = await mcp!.callTool("wallet.get_addresses", {});
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
          const unsignedRaw = await mcp!.callTool("tx.get_sol_unsigned", {
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
    "tx.transfer_preview",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain.toUpperCase();
      if (opts.from) args.from = opts.from;
      if (opts.to) args.to = opts.to;
      if (opts.amount) args.amount = opts.amount;
      if (opts.token) args.token_contract = opts.token;
      return args;
    },
    [
      ["--chain <chain>", "链名 (ETH/BSC/SOL...)"],
      ["--to <address>", "收款地址"],
      ["--amount <amount>", "金额"],
      ["--from <address>", "付款地址 (默认自动获取)"],
      ["--token <contract>", "Token 合约地址 (原生币可不填)"],
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
          (await mcp.callTool("wallet.get_addresses", {})) as Record<
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
          } else {
            previewArgs.token_contract = opts.token;
          }
        } else if (chain === "SOL") {
          previewArgs.token = "SOL";
        }
        let previewResult = extractToolJson<{
          key_info?: Record<string, unknown>;
          unsigned_tx_hex?: string;
          confirm_message?: string;
        }>(
          (await mcp.callTool("tx.transfer_preview", previewArgs)) as Record<
            string,
            unknown
          >,
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

        // SOL: 获取最新 blockhash 的 unsigned_tx
        let txToSign = unsignedTx;
        if (chain === "SOL") {
          const freshSpinner = ora("获取最新 blockhash...").start();
          const solArgs: Record<string, unknown> = {
            from,
            to: opts.to,
            amount: opts.amount,
          };
          if (opts.token) solArgs.token_mint = opts.token;
          const freshResult = extractToolJson<{ unsigned_tx_hex?: string }>(
            (await mcp.callTool("tx.get_sol_unsigned", solArgs)) as Record<
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

        // Step 2: Sign
        const signSpinner = ora("签名交易...").start();
        const signChain = chain === "SOL" ? "SOL" : "EVM";
        const signResult = extractToolJson<{
          signedTransaction?: string;
          signature?: string;
        }>(
          (await mcp.callTool("wallet.sign_transaction", {
            chain: signChain,
            raw_tx: txToSign,
          })) as Record<string, unknown>,
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
          (await mcp.callTool("tx.send_raw_transaction", {
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
    "tx.quote",
    async (opts, _pos, mcp) => {
      const args: Record<string, unknown> = {};
      if (opts.fromChain) args.chain_id_in = Number(opts.fromChain);
      if (opts.toChain) args.chain_id_out = Number(opts.toChain);
      if (opts.from) args.token_in = opts.from;
      if (opts.to) args.token_out = opts.to;
      if (opts.amount) args.amount = opts.amount;
      if (opts.slippage) args.slippage = Number(opts.slippage);
      if (opts.nativeIn) args.native_in = Number(opts.nativeIn);
      if (opts.nativeOut) args.native_out = Number(opts.nativeOut);
      if (opts.wallet) {
        args.user_wallet = opts.wallet;
      } else {
        const addrRes = (await mcp!.callTool(
          "wallet.get_addresses",
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
  shortcut(
    "swap",
    "一键兑换 (Quote→Build→Sign→Submit)",
    "tx.swap",
    async (opts, _pos, mcp) => {
      const addrRes = (await mcp!.callTool(
        "wallet.get_addresses",
        {},
      )) as Record<string, unknown>;
      const accountId = addrRes.account_id as string;
      const addresses = addrRes.addresses as Record<string, string> | undefined;
      const chainIdIn = Number(opts.fromChain ?? 1);
      const wallet =
        opts.wallet ??
        (chainIdIn === 501 ? addresses?.["SOL"] : addresses?.["EVM"]) ??
        "";

      const args: Record<string, unknown> = {
        chain_id_in: chainIdIn,
        chain_id_out: Number(opts.toChain ?? opts.fromChain ?? 1),
        token_in: opts.from,
        token_out: opts.to,
        amount: opts.amount,
        slippage: Number(opts.slippage ?? "0.03"),
        user_wallet: wallet,
        native_in: Number(opts.nativeIn ?? "0"),
        native_out: Number(opts.nativeOut ?? "0"),
        account_id: accountId,
      };
      if (opts.toWallet) args.to_wallet = opts.toWallet;
      return args;
    },
    [
      ["--from-chain <id>", "源链 ID (ETH=1, BSC=56, SOL=501...)", "1"],
      ["--to-chain <id>", "目标链 ID", "1"],
      ["--from <token>", "源 token 地址, 原生币用 -"],
      ["--to <token>", "目标 token 合约地址"],
      ["--amount <amount>", "数量"],
      ["--slippage <pct>", "滑点 (0.03=3%)", "0.03"],
      ["--native-in <0|1>", "源 token 是否原生币 (1=是, 0=否)", "0"],
      ["--native-out <0|1>", "目标 token 是否原生币 (1=是, 0=否)", "0"],
      ["--wallet <address>", "源链钱包地址 (默认自动获取)"],
      ["--to-wallet <address>", "目标链钱包地址 (跨链时需要)"],
    ],
  );
  shortcut(
    "swap-detail",
    "查询兑换交易详情",
    "tx.swap_detail",
    (_opts, pos) => ({ tx_order_id: pos[0] }),
    undefined,
    "<order_id>",
  );
  shortcut(
    "send-tx",
    "广播已签名交易（自动获取 account_id 和 address）",
    "tx.send_raw_transaction",
    async (opts, _pos, mcp) => {
      const addrRes = (await mcp!.callTool(
        "wallet.get_addresses",
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
    "tx.detail",
    (_opts, pos) => ({ hash_id: pos[0] }),
    undefined,
    "<tx_hash>",
  );
  shortcut(
    "tx-history",
    "查询交易历史",
    "tx.list",
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
    "tx.history_list",
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
    "tx.get_sol_unsigned",
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
    "market_get_kline",
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
    "market_get_pair_liquidity",
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
    "market_get_tx_stats",
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
    "market_list_swap_tokens",
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
    "market_list_cross_chain_bridge_tokens",
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
    "token_get_coin_info",
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
    "token_get_risk_info",
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
    "token_ranking",
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
    "token_get_coins_range_by_created_at",
    (opts) => {
      const args: Record<string, unknown> = {};
      if (opts.chain) args.chain = opts.chain;
      if (opts.start) args.start = opts.start;
      if (opts.end) args.end = opts.end;
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
    "chain.config",
    (_opts, pos) => (pos[0] ? { chain: pos[0].toUpperCase() } : {}),
    undefined,
    "[chain]",
  );
  shortcut(
    "rpc",
    "执行 JSON-RPC 调用 (eth_blockNumber, eth_getBalance...)",
    "rpc.call",
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

  console.log();
  console.log(chalk.bold("Please authorize in the browser:"));
  console.log(chalk.cyan.underline(parsed.verification_url));
  if (parsed.user_code) {
    console.log(chalk.gray(`Code: ${parsed.user_code}`));
  }
  console.log();
  openBrowser(parsed.verification_url);

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

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          console.log(chalk.green(`  Wallet: custodial (${provider})`));

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

async function loginGoogleViaRest(
  mcp: GateMcpClient,
  serverUrl: string,
) {
  const baseUrl = mcp.getServerBaseUrl();
  const callbackUrl = `${baseUrl}/oauth/google/device/callback`;
  const loginSpinner = ora("Starting Google OAuth login...").start();

  // 1. 通过 REST API 启动 Google OAuth device flow
  let flowData: DeviceStartResponse;
  try {
    const res = await fetch(`${baseUrl}/oauth/google/device/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }

    flowData = (await res.json()) as DeviceStartResponse;
    console.log(
      chalk.gray(
        `  [debug] google/device/start response: ${JSON.stringify(flowData, null, 2)}`,
      ),
    );
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

  // 3. 打开浏览器
  console.log();
  console.log(chalk.bold("Please authorize in the browser:"));
  console.log(chalk.cyan.underline(authUrl));
  if (flowData.user_code) {
    console.log(chalk.gray(`Code: ${flowData.user_code}`));
  }
  console.log();
  openBrowser(authUrl);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow_id: flowId }),
      });

      if (!res.ok) continue;

      const poll = (await res.json()) as DevicePollResponse;
      console.log(
        chalk.gray(
          `  [debug] google/device/poll response: ${JSON.stringify(poll, null, 2)}`,
        ),
      );

      if (poll.status === "ok") {
        const token = poll.access_token ?? poll.mcp_token;
        if (token) {
          mcp.setMcpToken(token);
          process.removeListener("SIGINT", onSigint);
          pollSpinner.succeed("Google login successful!");

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          if (poll.wallet_address)
            console.log(chalk.green(`  Wallet: ${poll.wallet_address}`));
          console.log(chalk.green(`  Provider: Google`));

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

async function loginGateViaRest(
  mcp: GateMcpClient,
  serverUrl: string,
) {
  const baseUrl = mcp.getServerBaseUrl();
  const loginSpinner = ora("Starting Gate OAuth login...").start();

  let flowData: DeviceStartResponse;
  try {
    const res = await fetch(`${baseUrl}/oauth/gate/device/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  console.log();
  console.log(chalk.bold("Please authorize in the browser:"));
  console.log(chalk.cyan.underline(flowData.verification_url));
  if (flowData.user_code) {
    console.log(chalk.gray(`Code: ${flowData.user_code}`));
  }
  console.log();
  openBrowser(flowData.verification_url);

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
        headers: { "Content-Type": "application/json" },
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

          console.log();
          if (poll.user_id)
            console.log(chalk.green(`  User ID: ${poll.user_id}`));
          if (poll.wallet_address)
            console.log(chalk.green(`  Wallet: ${poll.wallet_address}`));
          console.log(chalk.green(`  Provider: Gate`));

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
    const addrResult = await mcp.callTool("wallet.get_addresses");
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

    const reportResult = await mcp.callTool("agentic.report", { wallets });
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
