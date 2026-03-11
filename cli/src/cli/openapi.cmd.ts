/**
 * OpenAPI CLI 命令注册
 * 通过 Gate DEX OpenAPI（AK/SK 认证）直接调用，无需 MCP
 * 覆盖：Swap 交易、代币查询、市场行情
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createInterface } from "node:readline";
import {
  getOpenApiClient,
  resetOpenApiClient,
  type GateOpenApiClient,
  type OpenApiResponse,
} from "../core/openapi-client.js";
import {
  loadOpenApiConfig,
  maskSecretKey,
  getOpenApiConfigPath,
  saveOpenApiConfig,
} from "../core/openapi-config.js";
import { getMcpClient } from "../core/mcp-client.js";
import { loadAuth } from "../core/token-store.js";

/** chain 名称 → chain_id 映射 */
const CHAIN_ID_MAP: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arb: 42161,
  arbitrum: 42161,
  op: 10,
  optimism: 10,
  base: 8453,
  avax: 43114,
  avalanche: 43114,
  fantom: 250,
  ftm: 250,
  cronos: 25,
  linea: 59144,
  scroll: 534352,
  zksync: 324,
  mantle: 5000,
  gatelayer: 10088,
  solana: 501,
  sol: 501,
  tron: 195,
  trx: 195,
  sui: 101,
  ton: 607,
};

function resolveChainId(input: string): number {
  const n = Number(input);
  if (!isNaN(n) && n > 0) return n;
  return CHAIN_ID_MAP[input.toLowerCase()] ?? 0;
}

/** 格式化打印 OpenAPI 返回结果 */
function printResult(res: OpenApiResponse) {
  if (res.code !== 0) {
    const msg = res.message ?? res.msg ?? "Unknown error";
    console.error(chalk.red(`OpenAPI Error [${res.code}]: ${msg}`));
    return;
  }
  console.log(JSON.stringify(res.data, null, 2));
}

const NO_CONFIG_MSG = [
  "OpenAPI 尚未配置 AK/SK，请先配置：",
  "",
  `  pnpm cli openapi-config --set-ak YOUR_AK --set-sk YOUR_SK`,
  "",
  `  或直接编辑 ~/.gate-wallet/openapi.json`,
  `  获取 AK/SK: https://www.gatedex.com/developer`,
].join("\n");

function requireClient(): GateOpenApiClient | null {
  const client = getOpenApiClient();
  if (!client) {
    console.error(chalk.yellow(NO_CONFIG_MSG));
    return null;
  }
  return client;
}

export function registerOpenApiCommands(program: Command) {
  // ─── 配置管理 ──────────────────────────────────────────

  program
    .command("openapi-config")
    .description("查看 / 更新 OpenAPI AK/SK 配置")
    .option("--set-ak <ak>", "设置 Trade 通道 API Key")
    .option("--set-sk <sk>", "设置 Trade 通道 Secret Key")
    .option("--set-query-ak <ak>", "设置 Query 通道 API Key")
    .option("--set-query-sk <sk>", "设置 Query 通道 Secret Key")
    .action(
      async (opts: {
        setAk?: string;
        setSk?: string;
        setQueryAk?: string;
        setQuerySk?: string;
      }) => {
        if (opts.setAk || opts.setSk || opts.setQueryAk || opts.setQuerySk) {
          const config = loadOpenApiConfig() ?? {
            trade: { api_key: "", secret_key: "" },
            query: { api_key: "", secret_key: "" },
            default_slippage: 0.03,
            default_slippage_type: 1,
          };
          if (opts.setAk) config.trade.api_key = opts.setAk;
          if (opts.setSk) config.trade.secret_key = opts.setSk;
          if (opts.setQueryAk) config.query.api_key = opts.setQueryAk;
          if (opts.setQuerySk) config.query.secret_key = opts.setQuerySk;
          saveOpenApiConfig(config);
          resetOpenApiClient();
          console.log(chalk.green("OpenAPI 配置已更新"));

          const spinner = ora("验证凭证...").start();
          try {
            const client = requireClient();
            if (!client) {
              spinner.stop();
              return;
            }
            const res = await client.swapChains();
            if (res.code === 0) {
              spinner.succeed("凭证验证通过");
            } else {
              spinner.fail(
                `凭证验证失败: [${res.code}] ${res.message ?? res.msg}`,
              );
            }
          } catch (err) {
            spinner.fail(`验证请求失败: ${(err as Error).message}`);
          }
          return;
        }

        const config = loadOpenApiConfig();
        if (!config) {
          console.error(chalk.yellow(NO_CONFIG_MSG));
          return;
        }

        console.log(chalk.bold("OpenAPI Configuration"));
        console.log(`  File: ${chalk.gray(getOpenApiConfigPath())}`);
        console.log(chalk.bold("\n  Trade Channel (trade.swap.*)"));
        console.log(`    API Key: ${config.trade.api_key}`);
        console.log(
          `    Secret Key: ${maskSecretKey(config.trade.secret_key)}`,
        );
        console.log(chalk.bold("\n  Query Channel (base.token.* / market.*)"));
        console.log(`    API Key: ${config.query.api_key}`);
        console.log(
          `    Secret Key: ${maskSecretKey(config.query.secret_key)}`,
        );
        if (config.trade.endpoint) {
          console.log(`\n  Trade Endpoint: ${config.trade.endpoint}`);
        }
        if (config.query.endpoint) {
          console.log(`  Query Endpoint: ${config.query.endpoint}`);
        }
        if (config.default_slippage !== undefined) {
          console.log(
            `\n  Default Slippage: ${(config.default_slippage * 100).toFixed(1)}%`,
          );
        }
        console.log(
          chalk.gray("\n  Upgrade at https://www.gatedex.com/developer"),
        );
      },
    );

  // ─── Swap 交易类 ───────────────────────────────────────

  program
    .command("openapi-chains")
    .description("[OpenAPI] 查询支持的链列表")
    .action(async () => {
      const client = requireClient();
      if (!client) return;
      const spinner = ora("查询链列表...").start();
      try {
        const res = await client.swapChains();
        spinner.stop();
        printResult(res);
      } catch (err) {
        spinner.fail((err as Error).message);
      }
    });

  program
    .command("openapi-gas")
    .description("[OpenAPI] 查询 Gas 价格")
    .option("--chain <chain>", "链名或 chain_id", "eth")
    .action(async (opts: { chain: string }) => {
      const chainId = resolveChainId(opts.chain);
      if (!chainId) {
        console.error(chalk.red(`未知链: ${opts.chain}`));
        return;
      }
      const spinner = ora("查询 Gas 价格...").start();
      try {
        const client = requireClient();
        if (!client) {
          spinner.stop();
          return;
        }
        const res = await client.swapGasPrice(chainId);
        spinner.stop();
        printResult(res);
      } catch (err) {
        spinner.fail((err as Error).message);
      }
    });

  program
    .command("openapi-quote")
    .description("[OpenAPI] 获取 Swap 报价")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--from <token>", "源 token 地址，原生币用 -")
    .requiredOption("--to <token>", "目标 token 合约地址")
    .requiredOption("--amount <amount>", "数量（人类可读格式）")
    .requiredOption("--wallet <address>", "钱包地址")
    .option("--slippage <pct>", "滑点 (0.03=3%)")
    .option("--slippage-type <1|2>", "1=百分比, 2=固定值")
    .action(
      async (opts: {
        chain: string;
        from: string;
        to: string;
        amount: string;
        wallet: string;
        slippage?: string;
        slippageType?: string;
      }) => {
        const chainId = resolveChainId(opts.chain);
        if (!chainId) {
          console.error(chalk.red(`未知链: ${opts.chain}`));
          return;
        }
        const config = loadOpenApiConfig();
        const client = requireClient();
        if (!client) return;
        const spinner = ora("获取报价...").start();
        try {
          const res = await client.swapQuote({
            chain_id: chainId,
            token_in: opts.from,
            token_out: opts.to,
            amount_in: opts.amount,
            slippage: Number(opts.slippage ?? config?.default_slippage ?? 0.03),
            slippage_type: Number(
              opts.slippageType ?? config?.default_slippage_type ?? 1,
            ),
            user_wallet: opts.wallet,
          });
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-build")
    .description("[OpenAPI] 构建 Swap 未签名交易")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--from <token>", "源 token 地址，原生币用 -")
    .requiredOption("--to <token>", "目标 token 合约地址")
    .requiredOption("--amount <amount>", "数量")
    .requiredOption("--wallet <address>", "钱包地址")
    .option("--receiver <address>", "接收地址（默认同 wallet）")
    .option("--quote-id <id>", "报价 ID（建议传入）")
    .option("--slippage <pct>", "滑点 (0.03=3%)")
    .option("--slippage-type <1|2>", "1=百分比, 2=固定值")
    .action(
      async (opts: {
        chain: string;
        from: string;
        to: string;
        amount: string;
        wallet: string;
        receiver?: string;
        quoteId?: string;
        slippage?: string;
        slippageType?: string;
      }) => {
        const chainId = resolveChainId(opts.chain);
        if (!chainId) {
          console.error(chalk.red(`未知链: ${opts.chain}`));
          return;
        }
        const config = loadOpenApiConfig();
        const client = requireClient();
        if (!client) return;
        const spinner = ora("构建交易...").start();
        try {
          const params: Record<string, unknown> = {
            chain_id: chainId,
            amount_in: opts.amount,
            token_in: opts.from,
            token_out: opts.to,
            slippage: String(opts.slippage ?? config?.default_slippage ?? 0.03),
            slippage_type: String(
              opts.slippageType ?? config?.default_slippage_type ?? 1,
            ),
            user_wallet: opts.wallet,
            receiver: opts.receiver ?? opts.wallet,
          };
          if (opts.quoteId) params.quote_id = opts.quoteId;

          const res = await client.call("trade.swap.build", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-approve")
    .description("[OpenAPI] 获取 ERC20 approve calldata")
    .requiredOption("--wallet <address>", "钱包地址")
    .requiredOption("--amount <amount>", "授权数量（人类可读格式）")
    .requiredOption("--quote-id <id>", "报价 ID")
    .action(
      async (opts: { wallet: string; amount: string; quoteId: string }) => {
        const spinner = ora("获取 approve calldata...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const res = await client.swapApproveTransaction({
            user_wallet: opts.wallet,
            approve_amount: opts.amount,
            quote_id: opts.quoteId,
          });
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-submit")
    .description("[OpenAPI] 提交已签名交易")
    .requiredOption("--order-id <id>", "订单 ID（build 返回）")
    .option(
      "--signed-tx <json>",
      "签名交易 JSON 数组字符串，如 '[\"0x02f8...\"]'",
    )
    .option("--tx-hash <hash>", "交易哈希（自行广播后上报）")
    .option("--signed-approve-tx <json>", "签名 approve 交易 JSON 数组字符串")
    .action(
      async (opts: {
        orderId: string;
        signedTx?: string;
        txHash?: string;
        signedApproveTx?: string;
      }) => {
        if (!opts.signedTx && !opts.txHash) {
          console.error(chalk.red("--signed-tx 和 --tx-hash 必须传入其中一个"));
          return;
        }
        const spinner = ora("提交交易...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {
            order_id: opts.orderId,
          };
          if (opts.signedTx) params.signed_tx_string = opts.signedTx;
          if (opts.txHash) params.tx_hash = opts.txHash;
          if (opts.signedApproveTx)
            params.signed_approve_tx_string = opts.signedApproveTx;

          const res = await client.call("trade.swap.submit", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-status")
    .description("[OpenAPI] 查询 Swap 订单状态")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--order-id <id>", "订单 ID")
    .option("--tx-hash <hash>", "交易哈希", "")
    .action(
      async (opts: { chain: string; orderId: string; txHash: string }) => {
        const chainId = resolveChainId(opts.chain);
        if (!chainId) {
          console.error(chalk.red(`未知链: ${opts.chain}`));
          return;
        }
        const spinner = ora("查询订单状态...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const res = await client.swapStatus({
            chain_id: chainId,
            order_id: opts.orderId,
            tx_hash: opts.txHash,
          });
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-history")
    .description("[OpenAPI] 查询 Swap 历史订单")
    .requiredOption("--wallet <address>", "钱包地址（可逗号分隔多个）")
    .option("--page <n>", "页码", "1")
    .option("--limit <n>", "每页条数", "20")
    .option("--chain <chain>", "按链过滤")
    .action(
      async (opts: {
        wallet: string;
        page: string;
        limit: string;
        chain?: string;
      }) => {
        const spinner = ora("查询历史订单...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {
            user_wallet: opts.wallet.split(",").map((s) => s.trim()),
            page_number: Number(opts.page),
            page_size: Number(opts.limit),
          };
          if (opts.chain) {
            params.chain_id = resolveChainId(opts.chain);
          }
          const res = await client.call("trade.swap.history", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  // ─── 代币查询类 ────────────────────────────────────────

  program
    .command("openapi-swap-tokens")
    .description("[OpenAPI] 查询链上可 Swap 代币列表")
    .option("--chain <chain>", "链名或 chain_id")
    .option("--search <keyword>", "搜索（symbol 或合约地址）")
    .option("--tag <tag>", "列表类型: favorite | recommend")
    .option("--wallet <address>", "钱包地址（展示余额/收藏）")
    .action(
      async (opts: {
        chain?: string;
        search?: string;
        tag?: string;
        wallet?: string;
      }) => {
        const spinner = ora("查询代币列表...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {};
          if (opts.chain) params.chain_id = String(resolveChainId(opts.chain));
          if (opts.search) params.search = opts.search;
          if (opts.tag) params.tag = opts.tag;
          if (opts.wallet) params.wallet = opts.wallet;
          const res = await client.call("base.token.swap_list", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-token-rank")
    .description("[OpenAPI] 代币排行榜")
    .option("--chain <chain>", "链名或 chain_id")
    .option("--sort <field>", "排序字段", "trend_info.price_change_24h")
    .option("--order <asc|desc>", "排序方向", "desc")
    .option("--limit <n>", "返回条数", "10")
    .action(
      async (opts: {
        chain?: string;
        sort: string;
        order: string;
        limit: string;
      }) => {
        const spinner = ora("查询排行榜...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {
            sort: [{ field: opts.sort, order: opts.order }],
            limit: Number(opts.limit),
          };
          if (opts.chain) {
            params.chain_id = { eq: String(resolveChainId(opts.chain)) };
          }
          const res = await client.call("base.token.ranking", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-new-tokens")
    .description("[OpenAPI] 按创建时间筛选新币")
    .requiredOption("--start <time>", "开始时间 (RFC3339)")
    .option("--end <time>", "结束时间 (RFC3339)")
    .option("--chain <chain>", "链名或 chain_id")
    .option("--limit <n>", "返回数量", "20")
    .action(
      async (opts: {
        start: string;
        end?: string;
        chain?: string;
        limit: string;
      }) => {
        const spinner = ora("查询新代币...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {
            start: opts.start,
            end: opts.end ?? new Date().toISOString(),
            limit: opts.limit,
          };
          if (opts.chain) params.chain_id = String(resolveChainId(opts.chain));
          const res = await client.call(
            "base.token.range_by_created_at",
            params,
          );
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  program
    .command("openapi-token-risk")
    .description("[OpenAPI] 代币安全审计")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--address <addr>", "代币合约地址")
    .option("--lan <lang>", "语言 (en/zh)", "en")
    .action(async (opts: { chain: string; address: string; lan: string }) => {
      const chainId = resolveChainId(opts.chain);
      if (!chainId) {
        console.error(chalk.red(`未知链: ${opts.chain}`));
        return;
      }
      const spinner = ora("查询安全审计...").start();
      try {
        const client = requireClient();
        if (!client) {
          spinner.stop();
          return;
        }
        const res = await client.tokenRiskInfos({
          chain_id: String(chainId),
          address: opts.address,
          lan: opts.lan,
          ignore: "true",
        });
        spinner.stop();
        printResult(res);
      } catch (err) {
        spinner.fail((err as Error).message);
      }
    });

  program
    .command("openapi-bridge-tokens")
    .description("[OpenAPI] 查询跨链桥目标代币")
    .requiredOption("--src-chain <chain>", "源链")
    .requiredOption("--src-token <address>", "源代币合约地址")
    .requiredOption("--dest-chain <chain>", "目标链")
    .option("--search <keyword>", "搜索关键词")
    .action(
      async (opts: {
        srcChain: string;
        srcToken: string;
        destChain: string;
        search?: string;
      }) => {
        const srcChainId = resolveChainId(opts.srcChain);
        const destChainId = resolveChainId(opts.destChain);
        if (!srcChainId || !destChainId) {
          console.error(chalk.red("未知链"));
          return;
        }
        const spinner = ora("查询跨链桥代币...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const params: Record<string, unknown> = {
            source_chain_id: String(srcChainId),
            source_address: opts.srcToken,
            chain_id: String(destChainId),
          };
          if (opts.search) params.search = opts.search;
          const res = await client.call("base.token.bridge_list", params);
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  // ─── 市场行情类 ────────────────────────────────────────

  program
    .command("openapi-volume")
    .description("[OpenAPI] 查询交易量统计 (5m/1h/4h/24h)")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--address <addr>", "代币合约地址")
    .option("--pair <addr>", "交易对地址")
    .action(async (opts: { chain: string; address: string; pair?: string }) => {
      const chainId = resolveChainId(opts.chain);
      if (!chainId) {
        console.error(chalk.red(`未知链: ${opts.chain}`));
        return;
      }
      const spinner = ora("查询交易量...").start();
      try {
        const client = requireClient();
        if (!client) {
          spinner.stop();
          return;
        }
        const params: Record<string, unknown> = {
          chain_id: chainId,
          token_address: opts.address,
        };
        if (opts.pair) params.pair_address = opts.pair;
        const res = await client.call("market.volume_stats", params);
        spinner.stop();
        printResult(res);
      } catch (err) {
        spinner.fail((err as Error).message);
      }
    });

  program
    .command("openapi-liquidity")
    .description("[OpenAPI] 查询流动性池事件")
    .requiredOption("--chain <chain>", "链名或 chain_id")
    .requiredOption("--address <addr>", "代币合约地址")
    .option("--page <n>", "页码", "1")
    .option("--limit <n>", "每页数量 (最大 15)", "15")
    .action(
      async (opts: {
        chain: string;
        address: string;
        page: string;
        limit: string;
      }) => {
        const chainId = resolveChainId(opts.chain);
        if (!chainId) {
          console.error(chalk.red(`未知链: ${opts.chain}`));
          return;
        }
        const spinner = ora("查询流动性事件...").start();
        try {
          const client = requireClient();
          if (!client) {
            spinner.stop();
            return;
          }
          const res = await client.marketLiquidityList({
            chain_id: chainId,
            token_address: opts.address,
            page_index: Number(opts.page),
            page_size: Number(opts.limit),
          });
          spinner.stop();
          printResult(res);
        } catch (err) {
          spinner.fail((err as Error).message);
        }
      },
    );

  // ─── 通用调用 ──────────────────────────────────────────

  program
    .command("openapi-call <action> [json]")
    .description("[OpenAPI] 直接调用任意 OpenAPI action")
    .action(async (action: string, json?: string) => {
      const client = requireClient();
      if (!client) return;
      try {
        const params = json
          ? (JSON.parse(json) as Record<string, unknown>)
          : {};
        const res = await client.call(action, params);
        printResult(res);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });

  // ─── Hybrid Swap (OpenAPI + MCP signing) ──────────────────

  program
    .command("openapi-swap")
    .description(
      "[OpenAPI+MCP] Hybrid Swap: OpenAPI quote/build/submit + MCP custodial signing",
    )
    .requiredOption("--chain <chain>", "链名或 chain ID (如 ARB, ETH, 42161)")
    .requiredOption("--from <token>", "源代币地址，原生代币用 -")
    .requiredOption("--to <token>", "目标代币合约地址")
    .requiredOption("--amount <n>", "兑换数量 (人类可读格式)")
    .option("--slippage <pct>", "滑点 (0.03 = 3%)", "0.03")
    .option("-y, --yes", "跳过确认直接执行")
    .action(async (opts) => {
      const chainId = resolveChainId(opts.chain);
      if (!chainId) {
        console.error(chalk.red(`未知链: ${opts.chain}`));
        return;
      }

      const client = requireClient();
      if (!client) return;

      const slippage = parseFloat(opts.slippage);

      // Step 0: Get wallet address via MCP
      const authSpinner = ora("连接 MCP 获取钱包地址...").start();
      let mcp;
      try {
        mcp = await getMcpClient();
        const stored = loadAuth();
        if (!stored) {
          authSpinner.fail("未登录，请先执行 login");
          return;
        }
        mcp.setMcpToken(stored.mcp_token);

        const addrResult = await mcp.callTool("wallet.get_addresses", {});
        const addrData = extractMcpJson<{ addresses?: Record<string, string> }>(
          addrResult as Record<string, unknown>,
        );
        const isSolanaChain = resolveChainId(opts.chain) === 501;
        const wallet = isSolanaChain ? addrData?.addresses?.SOL : addrData?.addresses?.EVM;
        if (!wallet) {
          authSpinner.fail(`无法获取 ${isSolanaChain ? "SOL" : "EVM"} 钱包地址`);
          return;
        }
        authSpinner.succeed(`钱包: ${wallet}`);

        // Step 1: Quote
        const quoteSpinner = ora("获取报价...").start();
        const quoteRes = await client.call<{
          amount_in: string;
          amount_out: string;
          min_amount_out: string;
          slippage: string;
          quote_id: string;
          from_token: {
            token_symbol: string;
            decimal: number;
            is_native_token: number;
          };
          to_token: { token_symbol: string; decimal: number };
          protocols: Array<Array<Array<{ name: string; part: number }>>>;
        }>("trade.swap.quote", {
          chain_id: chainId,
          token_in: opts.from,
          token_out: opts.to,
          amount_in: opts.amount,
          user_wallet: wallet,
          slippage,
          slippage_type: 1,
        });

        if (quoteRes.code !== 0) {
          quoteSpinner.fail(`报价失败 [${quoteRes.code}]: ${quoteRes.message}`);
          return;
        }
        const q = quoteRes.data;
        quoteSpinner.succeed("报价成功");

        console.log(chalk.cyan("\n========== Swap 报价 =========="));
        console.log(`  卖出: ${q.amount_in} ${q.from_token.token_symbol}`);
        console.log(`  买入: ≈ ${q.amount_out} ${q.to_token.token_symbol}`);
        console.log(`  最少: ${q.min_amount_out} ${q.to_token.token_symbol}`);
        console.log(`  滑点: ${(parseFloat(q.slippage) * 100).toFixed(1)}%`);
        const routes =
          q.protocols?.[0]?.[0]
            ?.map((p) => `${p.name}(${p.part}%)`)
            .join(" → ") ?? "N/A";
        console.log(`  路由: ${routes}`);
        console.log(chalk.cyan("===============================\n"));

        // Confirm
        if (!opts.yes) {
          const confirmed = await askConfirm("确认执行 Swap?");
          if (!confirmed) {
            console.log(chalk.yellow("已取消"));
            return;
          }
        }

        // Steps 2+: chain-specific flow
        const isSolana = chainId === 501;
        const chainParam = resolveChainParam(chainId);

        let execSpinner = ora("准备交易...").start();

        if (isSolana) {
          // ═══════ Solana Flow: OpenAPI quote → build → MCP sign(base58) → OpenAPI submit ═══════

          // Solana Step 2: Build (no ERC20 approve needed)
          execSpinner.text = "获取最新报价...";
          const solQuoteRes = await client.call<{
            amount_in: string;
            amount_out: string;
            min_amount_out: string;
            quote_id: string;
            to_token: { token_symbol: string; decimal: number };
          }>("trade.swap.quote", {
            chain_id: chainId,
            token_in: opts.from,
            token_out: opts.to,
            amount_in: opts.amount,
            user_wallet: wallet,
            slippage,
            slippage_type: 1,
          });
          if (solQuoteRes.code !== 0) {
            execSpinner.fail(`报价失败 [${solQuoteRes.code}]: ${solQuoteRes.message}`);
            return;
          }
          const solQ = solQuoteRes.data;

          execSpinner.text = "Build Solana 交易...";
          const solBuildRes = await client.call<{
            unsigned_tx: {
              to: string;
              data: string;
              value: string;
              chain_id: number;
              gas_limit: number;
            };
            order_id: string;
            amount_in: string;
            amount_out: string;
          }>("trade.swap.build", {
            chain_id: chainId,
            token_in: opts.from,
            token_out: opts.to,
            amount_in: opts.amount,
            user_wallet: wallet,
            slippage,
            slippage_type: 1,
            quote_id: solQ.quote_id,
          });

          if (solBuildRes.code !== 0) {
            execSpinner.fail(`Build 失败 [${solBuildRes.code}]: ${solBuildRes.message}`);
            return;
          }

          const solUtx = solBuildRes.data.unsigned_tx;
          const solOrderId = solBuildRes.data.order_id;
          const unsignedTxBase64 = solUtx.data;

          // Solana Step 3: Sign via MCP wallet.sign_transaction
          // MCP expects base58-encoded VersionedTransaction for SOL
          execSpinner.text = "签名 Solana 交易...";
          const unsignedTxBase58 = base58Encode(Buffer.from(unsignedTxBase64, "base64"));

          const solSignRaw = await mcp.callTool("wallet.sign_transaction", {
            chain: "SOL",
            raw_tx: unsignedTxBase58,
          });
          const solSignResult = extractMcpJson<{
            signedTransaction?: string;
            signature?: string;
          }>(solSignRaw as Record<string, unknown>);

          // signedTransaction is base58-encoded signed VersionedTransaction
          const signedSolTx = solSignResult?.signedTransaction ?? "";

          if (!signedSolTx) {
            execSpinner.fail("Solana 签名失败");
            console.log(chalk.gray("Raw:"), JSON.stringify(solSignRaw, null, 2).slice(0, 800));
            return;
          }
          execSpinner.succeed("签名成功");

          // Solana Step 4: Submit - signed_tx_string for Solana is JSON array of base58 strings
          execSpinner = ora("提交 Solana 交易...").start();

          const solSubmitRes = await client.call<{
            order_id: string;
            tx_hash: string;
          }>("trade.swap.submit", {
            order_id: solOrderId,
            signed_tx_string: JSON.stringify([signedSolTx]),
          });

          if (solSubmitRes.code !== 0) {
            execSpinner.fail(`Submit 失败 [${solSubmitRes.code}]: ${solSubmitRes.message}`);
            return;
          }

          const solTxHash = solSubmitRes.data.tx_hash;
          execSpinner.succeed(`交易已提交: ${solTxHash}`);

          // Solana Step 5: Poll status
          await pollSwapStatus(client, execSpinner, chainId, solOrderId, solTxHash, solQ.to_token);

        } else {
          // ═══════ EVM Flow ═══════

          // EVM Step 2: Check ERC20 Approve (before build, so quote won't expire)
        const isNativeIn =
          opts.from === "-" || q.from_token.is_native_token === 1;
        if (!isNativeIn) {
          execSpinner.text = "检查 ERC20 授权...";

          // Query on-chain allowance: use quote's route_address as spender
          // We use a preliminary build to discover the actual spender, or use the approve_transaction API
          // which handles spender internally. First check with approve_transaction.
          const approveRes = await client.call<{
            data: string;
            approve_address: string;
            gas_limit: string;
          }>("trade.swap.approve_transaction", {
            user_wallet: wallet,
            approve_amount: opts.amount,
            quote_id: q.quote_id,
          });

          if (approveRes.code === 0 && approveRes.data) {
            const approveTx = approveRes.data;
            // Check on-chain allowance against the approve_address (spender)
            const ownerPadded = wallet
              .replace("0x", "")
              .toLowerCase()
              .padStart(64, "0");
            const spenderPadded = approveTx.approve_address
              .replace("0x", "")
              .toLowerCase()
              .padStart(64, "0");
            const allowanceData = `0xdd62ed3e${ownerPadded}${spenderPadded}`;

            const allowanceResult = extractMcpJson<{ result: string }>(
              (await mcp.callTool("rpc.call", {
                chain: chainParam,
                method: "eth_call",
                params: [{ to: opts.from, data: allowanceData }, "latest"],
              })) as Record<string, unknown>,
            );
            const allowanceRaw = BigInt(allowanceResult?.result ?? "0x0");
            const amountRaw = BigInt(
              Math.floor(parseFloat(opts.amount) * 10 ** q.from_token.decimal),
            );

            if (allowanceRaw < amountRaw) {
              execSpinner.text = "授权不足，签名 approve 交易...";

              // Get nonce + gas for approve tx
              const approveNonceResult = extractMcpJson<{ result: string }>(
                (await mcp.callTool("rpc.call", {
                  chain: chainParam,
                  method: "eth_getTransactionCount",
                  params: [wallet, "pending"],
                })) as Record<string, unknown>,
              );
              const approveNonce = parseInt(approveNonceResult!.result, 16);

              const approveGasPriceResult = extractMcpJson<{ result: string }>(
                (await mcp.callTool("rpc.call", {
                  chain: chainParam,
                  method: "eth_gasPrice",
                  params: [],
                })) as Record<string, unknown>,
              );
              const approveGasPrice = Math.floor(
                parseInt(approveGasPriceResult!.result, 16) * 1.2,
              );

              const rawApproveTx =
                "0x02" +
                rlpEncodeEIP1559({
                  chainId,
                  nonce: approveNonce,
                  maxPriorityFeePerGas: 0,
                  maxFeePerGas: approveGasPrice,
                  gasLimit: parseInt(approveTx.gas_limit, 10) || 100000,
                  to: opts.from, // approve tx must target the token contract, not the spender
                  value: BigInt(0),
                  data: approveTx.data,
                });

              const approveSignResult = extractMcpJson<{
                signedTransaction: string;
              }>(
                (await mcp.callTool("wallet.sign_transaction", {
                  chain: "EVM",
                  raw_tx: rawApproveTx,
                })) as Record<string, unknown>,
              );
              let signedApproveTx = approveSignResult!.signedTransaction;
              if (!signedApproveTx.startsWith("0x"))
                signedApproveTx = "0x" + signedApproveTx;

              // Broadcast approve tx via RPC and wait for on-chain confirmation
              execSpinner.text = "广播 approve 交易，等待链上确认...";
              const sendApproveResult = extractMcpJson<{
                result?: string;
                error?: unknown;
              }>(
                (await mcp.callTool("rpc.call", {
                  chain: chainParam,
                  method: "eth_sendRawTransaction",
                  params: [signedApproveTx],
                })) as Record<string, unknown>,
              );
              const approveTxHash = sendApproveResult?.result;
              if (!approveTxHash) {
                execSpinner.fail(
                  `Approve 广播失败: ${JSON.stringify(sendApproveResult)}`,
                );
                return;
              }
              execSpinner.text = `Approve 已广播 (${approveTxHash.slice(0, 10)}...), 等待确认...`;

              let approveConfirmed = false;
              for (let i = 0; i < 30; i++) {
                await sleep(3000);
                const receiptResult = extractMcpJson<{
                  result?: { status: string } | null;
                }>(
                  (await mcp.callTool("rpc.call", {
                    chain: chainParam,
                    method: "eth_getTransactionReceipt",
                    params: [approveTxHash],
                  })) as Record<string, unknown>,
                );
                if (receiptResult?.result?.status === "0x1") {
                  approveConfirmed = true;
                  break;
                } else if (receiptResult?.result?.status === "0x0") {
                  execSpinner.fail("Approve 交易链上执行失败 (reverted)");
                  return;
                }
                execSpinner.text = `等待 approve 确认... (${i + 1}/30)`;
              }
              if (!approveConfirmed) {
                execSpinner.fail("Approve 确认超时，请稍后重试");
                return;
              }
              execSpinner.succeed(`Approve 已确认 (${approveTxHash})`);
              execSpinner = ora("重新获取报价并构建 swap 交易...").start();
            } else {
              execSpinner.text = "授权充足，跳过 approve";
            }
          }
          // If approve_transaction returns error (e.g. native token), just proceed
        }

        // Step 3: Re-quote (fresh quote_id after possible approve delay)
        execSpinner.text = "获取最新报价...";
        const freshQuoteRes = await client.call<{
          amount_in: string;
          amount_out: string;
          min_amount_out: string;
          slippage: string;
          quote_id: string;
          from_token: {
            token_symbol: string;
            decimal: number;
            is_native_token: number;
          };
          to_token: { token_symbol: string; decimal: number };
        }>("trade.swap.quote", {
          chain_id: chainId,
          token_in: opts.from,
          token_out: opts.to,
          amount_in: opts.amount,
          user_wallet: wallet,
          slippage,
          slippage_type: 1,
        });
        if (freshQuoteRes.code !== 0) {
          execSpinner.fail(
            `报价失败 [${freshQuoteRes.code}]: ${freshQuoteRes.message}`,
          );
          return;
        }
        const freshQ = freshQuoteRes.data;

        // Step 4: Build
        execSpinner.text = "Build...";
        const buildRes = await client.call<{
          unsigned_tx: {
            to: string;
            data: string;
            value: string;
            chain_id: number;
            gas_limit: number;
          };
          order_id: string;
          amount_in: string;
          amount_out: string;
        }>("trade.swap.build", {
          chain_id: chainId,
          token_in: opts.from,
          token_out: opts.to,
          amount_in: opts.amount,
          user_wallet: wallet,
          slippage,
          slippage_type: 1,
          quote_id: freshQ.quote_id,
        });

        if (buildRes.code !== 0) {
          execSpinner.fail(
            `Build 失败 [${buildRes.code}]: ${buildRes.message}`,
          );
          return;
        }
        const { unsigned_tx: utx, order_id } = buildRes.data;

        // Step 5: Nonce + Gas for swap tx
        execSpinner.text = "获取 nonce + gasPrice...";
        const nonceResult = extractMcpJson<{ result: string }>(
          (await mcp.callTool("rpc.call", {
            chain: chainParam,
            method: "eth_getTransactionCount",
            params: [wallet, "pending"],
          })) as Record<string, unknown>,
        );
        const nonce = parseInt(nonceResult!.result, 16);

        const gasPriceResult = extractMcpJson<{ result: string }>(
          (await mcp.callTool("rpc.call", {
            chain: chainParam,
            method: "eth_gasPrice",
            params: [],
          })) as Record<string, unknown>,
        );
        const gasPrice = Math.floor(parseInt(gasPriceResult!.result, 16) * 1.2);

        execSpinner.text = "签名交易...";

        // Step 6: RLP encode EIP-1559 unsigned tx
        const rawTx =
          "0x02" +
          rlpEncodeEIP1559({
            chainId: utx.chain_id,
            nonce,
            maxPriorityFeePerGas: 0,
            maxFeePerGas: gasPrice,
            gasLimit: utx.gas_limit,
            to: utx.to,
            value: BigInt(utx.value),
            data: utx.data,
          });

        // Step 7: MCP sign
        const signResult = extractMcpJson<{ signedTransaction: string }>(
          (await mcp.callTool("wallet.sign_transaction", {
            chain: "EVM",
            raw_tx: rawTx,
          })) as Record<string, unknown>,
        );
        let signedTx = signResult!.signedTransaction;
        if (!signedTx.startsWith("0x")) signedTx = "0x" + signedTx;

        execSpinner.text = "提交交易...";

        // Step 8: Submit
        const submitRes = await client.call<{
          order_id: string;
          tx_hash: string;
        }>("trade.swap.submit", {
          order_id,
          signed_tx_string: JSON.stringify([signedTx]),
        });

        if (submitRes.code !== 0) {
          execSpinner.fail(
            `Submit 失败 [${submitRes.code}]: ${submitRes.message}`,
          );
          return;
        }
        const txHash = submitRes.data.tx_hash;
        execSpinner.succeed(`交易已提交: ${txHash}`);

          // EVM Step 9: Poll status
          await pollSwapStatus(client, execSpinner, chainId, order_id, txHash, freshQ.to_token);
        } // end EVM flow

      } catch (err) {
        console.error(chalk.red((err as Error).message));
      }
    });
}

// ─── Hybrid Swap helpers ───────────────────────────────────

function extractMcpJson<T>(result: Record<string, unknown>): T | null {
  if ("content" in result && Array.isArray(result.content)) {
    for (const item of result.content) {
      if ((item as { type: string }).type === "text") {
        try {
          return JSON.parse((item as { text: string }).text) as T;
        } catch {
          /* skip */
        }
      }
    }
  }
  return null;
}

function askConfirm(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${msg} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHAIN_ID_TO_PARAM: Record<number, string> = {
  1: "ETH",
  56: "BSC",
  137: "POLYGON",
  42161: "ARB",
  8453: "BASE",
  10: "OP",
  43114: "AVAX",
  501: "SOL",
};

function resolveChainParam(chainId: number): string {
  return CHAIN_ID_TO_PARAM[chainId] ?? "ETH";
}

const CHAIN_EXPLORER: Record<number, string> = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  137: "https://polygonscan.com",
  42161: "https://arbiscan.io",
  8453: "https://basescan.org",
  10: "https://optimistic.etherscan.io",
  43114: "https://snowtrace.io",
  250: "https://ftmscan.com",
  59144: "https://lineascan.build",
  534352: "https://scrollscan.com",
  324: "https://explorer.zksync.io",
  5000: "https://explorer.mantle.xyz",
  501: "https://solscan.io",
};

function getExplorerTxUrl(chainId: number, txHash: string): string {
  const base = CHAIN_EXPLORER[chainId] ?? "https://etherscan.io";
  return `${base}/tx/${txHash}`;
}

function formatTokenAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const n = BigInt(raw);
  const d = BigInt(10 ** decimals);
  const whole = n / d;
  const frac = n % d;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// ─── Minimal RLP encoder for EIP-1559 ──────────────────────

function rlpEncodeLength(len: number, offset: number): Buffer {
  if (len < 56) return Buffer.from([len + offset]);
  const hexLen = len.toString(16);
  const lenBytes = Buffer.from(
    hexLen.length % 2 ? "0" + hexLen : hexLen,
    "hex",
  );
  return Buffer.concat([
    Buffer.from([offset + 55 + lenBytes.length]),
    lenBytes,
  ]);
}

function rlpEncodeItem(data: Buffer): Buffer {
  if (data.length === 1 && data[0]! < 0x80) return data;
  return Buffer.concat([rlpEncodeLength(data.length, 0x80), data]);
}

function rlpEncodeList(items: Buffer[]): Buffer {
  const payload = Buffer.concat(items);
  return Buffer.concat([rlpEncodeLength(payload.length, 0xc0), payload]);
}

function bigintToBuffer(n: bigint): Buffer {
  if (n === 0n) return Buffer.alloc(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}

function intToBuffer(n: number): Buffer {
  return bigintToBuffer(BigInt(n));
}

interface EIP1559Tx {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: number;
  maxFeePerGas: number;
  gasLimit: number;
  to: string;
  value: bigint;
  data: string;
}

function rlpEncodeEIP1559(tx: EIP1559Tx): string {
  const items = [
    rlpEncodeItem(intToBuffer(tx.chainId)),
    rlpEncodeItem(intToBuffer(tx.nonce)),
    rlpEncodeItem(intToBuffer(tx.maxPriorityFeePerGas)),
    rlpEncodeItem(intToBuffer(tx.maxFeePerGas)),
    rlpEncodeItem(intToBuffer(tx.gasLimit)),
    rlpEncodeItem(Buffer.from(tx.to.replace("0x", ""), "hex")),
    rlpEncodeItem(bigintToBuffer(tx.value)),
    rlpEncodeItem(Buffer.from(tx.data.replace("0x", ""), "hex")),
    rlpEncodeList([]), // access_list = []
  ];
  return rlpEncodeList(items).toString("hex");
}

// ─── Base58 encoder (Bitcoin alphabet) ──────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Buffer): string {
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }
  let num = BigInt("0x" + (bytes.length > 0 ? bytes.toString("hex") : "0"));
  const chars: string[] = [];
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    chars.unshift(BASE58_ALPHABET[rem]!);
  }
  return "1".repeat(leadingZeros) + chars.join("");
}

// ─── Poll swap status (shared by EVM and Solana) ────────────

type OpenApiClient = GateOpenApiClient;

async function pollSwapStatus(
  client: OpenApiClient,
  _spinner: ReturnType<typeof ora>,
  chainId: number,
  orderId: string,
  txHash: string,
  toToken: { token_symbol: string; decimal: number },
): Promise<void> {
  const pollSpinner = ora("等待链上确认...").start();
  let finalStatus = "";
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const statusRes = await client.call<{
      status: number;
      amount_out: string;
      error_code: number;
      error_msg: string;
      tx_hash_explorer_url: string;
    }>("trade.swap.status", { chain_id: chainId, order_id: orderId, tx_hash: txHash });

    const sd = statusRes.data;
    if (!sd) continue;

    if (sd.status === 200) {
      const outHuman = formatTokenAmount(sd.amount_out, toToken.decimal);
      pollSpinner.succeed(`Swap 成功! 收到 ${outHuman} ${toToken.token_symbol}`);
      finalStatus = "success";
      break;
    } else if (sd.status === 300 || sd.status === 400) {
      pollSpinner.fail(`Swap 失败: ${sd.error_msg || "unknown error"}`);
      finalStatus = "failed";
      break;
    } else if (sd.error_code && sd.error_code !== 0) {
      pollSpinner.fail(`Swap 失败: ${sd.error_msg}`);
      finalStatus = "failed";
      break;
    }
    pollSpinner.text = `等待链上确认... (${i + 1}/24)`;
  }

  if (!finalStatus) {
    pollSpinner.warn("轮询超时，请稍后查询状态");
  }

  console.log(chalk.cyan(`\nExplorer: ${getExplorerTxUrl(chainId, txHash)}`));
}
