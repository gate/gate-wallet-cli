/**
 * MCP Tools Integration Test
 *
 * Phase 1 — 名称核查：listTools() 与预期列表比对
 * Phase 2 — 调用测试（无 token）：公开 tool 可调用
 * Phase 3 — 功能测试（有 token）：调用全部 tool 并校验返回字段
 *
 * 运行方式：
 *   # 有登录态（自动读取 ~/.gate-wallet/auth.json）
 *   MCP_URL=https://wallet-service-mcp-test.gateweb3.cc/mcp tsx src/test/mcp-tools.test.ts
 *
 *   # 手动指定 token
 *   MCP_TOKEN=xxx MCP_URL=... tsx src/test/mcp-tools.test.ts
 */

import { GateMcpClient } from "../core/mcp-client.js";
import { loadAuth } from "../core/token-store.js";

const SERVER_URL =
  process.env["MCP_URL"] ?? "https://wallet-service-mcp-test.gateweb3.cc/mcp";

// ─── 预期 tool 名称列表 ───────────────────────────────────

const EXPECTED_TOOLS = [
  "dex_auth_gate_login_start",
  "dex_auth_gate_login_poll",
  "dex_auth_google_login_start",
  "dex_auth_google_login_poll",
  "dex_auth_login_gate_wallet",
  "dex_auth_login_google_wallet",
  "dex_auth_logout",
  "dex_chain_config",
  "dex_rpc_call",
  "dex_tx_gas",
  "dex_tx_quote",
  "dex_tx_swap",
  "dex_tx_send_raw_transaction",
  "dex_tx_transfer_preview",
  "dex_tx_approve_preview",
  "dex_tx_detail",
  "dex_tx_list",
  "dex_tx_history_list",
  "dex_tx_swap_detail",
  "dex_tx_get_sol_unsigned",
  "dex_wallet_get_addresses",
  "dex_wallet_get_token_list",
  "dex_wallet_get_total_asset",
  "dex_wallet_sign_message",
  "dex_wallet_sign_transaction",
  "dex_token_get_coin_info",
  "dex_token_ranking",
  "dex_token_list_swap_tokens",
  "dex_token_list_cross_chain_bridge_tokens",
  "dex_token_get_risk_info",
  "dex_token_get_coins_range_by_created_at",
  "dex_market_get_kline",
  "dex_market_get_pair_liquidity",
  "dex_market_get_tx_stats",
  "dex_agentic_report",
  "tx.x402_fetch",
];

// ─── 类型 ─────────────────────────────────────────────────

type Data = Record<string, unknown>;

interface FuncTest {
  tool: string;
  args: Data;
  /** 校验返回数据中存在这些字段（点号表示嵌套，如 "data.tokens"） */
  expectFields?: string[];
  /** 自定义校验函数 */
  validate?: (data: Data) => string | null; // null = pass，否则返回失败原因
  /** 允许返回业务错误（数据不存在等），只要 tool 存在就算通过 */
  allowError?: boolean;
}

// ─── 测试用例 ─────────────────────────────────────────────

const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

/** 无需 token 的 tool 测试 */
const PUBLIC_TESTS: FuncTest[] = [
  // Auth 流程入口 — 返回包含 URL 或 flow_id 的对象即可
  {
    tool: "dex_auth_gate_login_start",
    args: {},
    validate: (d) => {
      const hasUrl = Object.values(d).some(
        (v) => typeof v === "string" && v.startsWith("http"),
      );
      const hasFlowId = d.flow_id != null || d.flowId != null;
      return hasUrl || hasFlowId ? null : "expected URL or flow_id in response";
    },
  },
  {
    tool: "dex_auth_google_login_start",
    args: {},
    validate: (d) => {
      const hasUrl = Object.values(d).some(
        (v) => typeof v === "string" && v.startsWith("http"),
      );
      const hasFlowId = d.flow_id != null || d.flowId != null;
      return hasUrl || hasFlowId ? null : "expected URL or flow_id in response";
    },
  },
  // Token 查询（测试服可能需要 token，allowError 即可）
  {
    tool: "dex_token_ranking",
    args: { limit: 5, direction: "desc" },
    allowError: true,
  },
  {
    tool: "dex_token_list_swap_tokens",
    args: { chain: "ethereum" },
    allowError: true,
  },
  {
    tool: "dex_token_get_coin_info",
    args: { chain: "eth", address: USDT_ETH },
    allowError: true, // token 在测试服可能必需
  },
  {
    tool: "dex_token_get_risk_info",
    args: { chain: "eth", address: USDT_ETH },
    allowError: true,
  },
  {
    tool: "dex_token_get_coins_range_by_created_at",
    args: { chain: "eth", start: "2026-03-16T00:00:00Z", end: "2026-03-17T00:00:00Z" },
    allowError: true,
  },
  {
    tool: "dex_token_list_cross_chain_bridge_tokens",
    args: { source_chain: "ethereum", source_address: USDT_ETH, chain: "bsc" },
    allowError: true,
  },
  // Market
  {
    tool: "dex_market_get_kline",
    args: { chain: "eth", token_address: USDT_ETH, period: "1h" },
    allowError: true,
  },
  {
    tool: "dex_market_get_pair_liquidity",
    args: { chain: "eth", token_address: USDT_ETH },
    allowError: true,
  },
  {
    tool: "dex_market_get_tx_stats",
    args: { chain: "eth", token_address: USDT_ETH },
    allowError: true,
  },
  // Tx 查询
  {
    tool: "dex_tx_detail",
    args: { hash_id: "0x0000000000000000000000000000000000000000000000000000000000000001" },
    allowError: true,
  },
  {
    tool: "dex_tx_swap_detail",
    args: { tx_order_id: "000000" },
    allowError: true,
  },
];

/** 需要 mcp_token 的 tool 测试 */
const AUTH_TESTS: FuncTest[] = [
  // Chain / RPC
  {
    tool: "dex_chain_config",
    args: { chain: "ETH" },
    validate: (d) => {
      const cfg = (d.chain_config ?? d.config ?? d.data ?? d) as Data;
      return cfg.chain_id != null || cfg.endpoint != null || cfg.network_key != null
        ? null
        : "expected chain_id / endpoint / network_key";
    },
  },
  {
    tool: "dex_rpc_call",
    args: { chain: "ETH", method: "eth_blockNumber", params: [] },
    validate: (d) =>
      d.result != null ? null : "expected result field",
  },
  {
    tool: "dex_tx_gas",
    args: { chain: "ETH" },
    validate: (d) => {
      const gas = (d.gas_price ?? d.gasPrice ?? d.data ?? d) as Data;
      return gas != null ? null : "expected gas info";
    },
  },
  // Wallet
  {
    tool: "dex_wallet_get_addresses",
    args: {},
    validate: (d) => {
      const addresses = (d.addresses ?? (d.data as Data)?.addresses) as
        | Record<string, string>
        | undefined;
      return addresses && (addresses["EVM"] || addresses["SOL"])
        ? null
        : "expected addresses.EVM or addresses.SOL";
    },
  },
  {
    tool: "dex_wallet_get_total_asset",
    args: {},
    validate: (d) => {
      return d.total_asset != null || d.total != null || d.data != null
        ? null
        : "expected total_asset field";
    },
  },
  {
    tool: "dex_wallet_get_token_list",
    args: {},
    validate: (d) => {
      const list = (d.tokens ?? d.list ?? d.data) as unknown[] | undefined;
      return Array.isArray(list) ? null : "expected tokens array";
    },
  },
  // Tx with auth
  {
    tool: "dex_tx_list",
    args: { page_num: 1, page_size: 5 },
    validate: (d) => {
      const list = (d.list ?? d.records ?? d.data) as unknown[] | undefined;
      return Array.isArray(list) ? null : "expected list array";
    },
  },
  {
    tool: "dex_tx_history_list",
    args: { page_num: 1, page_size: 5 },
    validate: (d) => {
      const list = (d.list ?? d.records ?? d.data) as unknown[] | undefined;
      return Array.isArray(list) ? null : "expected list array";
    },
  },
  {
    tool: "dex_tx_quote",
    args: {
      chain_id_in: 1,
      chain_id_out: 1,
      token_in: "-",
      token_out: USDT_ETH,
      amount: "0.001",
      native_in: 1,
      native_out: 0,
      slippage: 0.03,
    },
    allowError: true, // user_wallet 会由服务端从 token 推断
  },
  {
    tool: "dex_tx_get_sol_unsigned",
    args: {
      from: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      amount: "0.000001",
    },
    allowError: true,
  },
  {
    tool: "dex_token_ranking",
    args: { limit: 5, direction: "desc" },
    validate: (d) => {
      const list = (d.tokens ?? d.list ?? d.data) as unknown[] | undefined;
      return Array.isArray(list) && list.length > 0
        ? null
        : "expected non-empty token list";
    },
  },
  {
    tool: "dex_token_list_swap_tokens",
    args: { chain: "ethereum" },
    validate: (d) => {
      const tokens = (d.tokens ?? d.data) as unknown[] | undefined;
      return Array.isArray(tokens) && tokens.length > 0
        ? null
        : "expected non-empty tokens";
    },
  },
  {
    tool: "dex_token_get_coin_info",
    args: { chain: "eth", address: USDT_ETH },
    allowError: true,
  },
  {
    tool: "dex_token_get_risk_info",
    args: { chain: "eth", address: USDT_ETH },
    allowError: true,
  },
  {
    tool: "dex_market_get_kline",
    args: { chain: "eth", token_address: USDT_ETH, period: "1h" },
    allowError: true,
  },
];

// ─── 工具函数 ─────────────────────────────────────────────

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const GRAY   = "\x1b[90m";
const BOLD   = "\x1b[1m";

const log = {
  pass: (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`),
  fail: (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`),
  warn: (msg: string) => console.log(`  ${YELLOW}~${RESET} ${msg}`),
  skip: (msg: string) => console.log(`  ${GRAY}-${RESET} ${msg}`),
};

function isNotFoundError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("tool not found") ||
    lower.includes("unknown tool") ||
    lower.includes("no such tool") ||
    lower.includes("method not found")
  );
}

/** 从 MCP callTool 返回值提取 JSON 数据
 *
 * MCP SDK 返回结构：
 *   成功: { content: [{ type: "text", text: "<json>" }] }
 *   错误: { isError: true, content: [{ type: "text", text: "<msg>" }] }
 */
function extractResult(raw: unknown): { data: Data | null; errorText: string | null } {
  if (!raw || typeof raw !== "object") return { data: null, errorText: null };

  const r = raw as { isError?: boolean; content?: Array<{ text?: string }> };
  const text = r.content?.[0]?.text ?? "";

  if (r.isError) {
    return { data: null, errorText: text || "(unknown error)" };
  }

  if (text) {
    try {
      return { data: JSON.parse(text) as Data, errorText: null };
    } catch {
      return { data: { _raw: text }, errorText: null };
    }
  }

  return { data: raw as Data, errorText: null };
}

/** 递归取嵌套字段 "a.b.c" */
function getField(obj: Data, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    return cur && typeof cur === "object" ? (cur as Data)[key] : undefined;
  }, obj);
}

let passed = 0;
let failed = 0;
let warned = 0;
let skipped = 0;

async function runTest(mcp: GateMcpClient, tc: FuncTest) {
  try {
    const raw = await mcp.callTool(tc.tool, tc.args);
    const { data, errorText } = extractResult(raw);

    if (errorText) {
      if (isNotFoundError(errorText)) {
        log.fail(`${tc.tool} — tool not found`);
        failed++;
        return;
      }
      if (tc.allowError) {
        log.warn(`${tc.tool} → ${errorText.slice(0, 80)}`);
        warned++;
        return;
      }
      log.fail(`${tc.tool} — error: ${errorText.slice(0, 80)}`);
      failed++;
      return;
    }

    // success — run assertions
    if (data) {
      if (tc.expectFields) {
        const missing = tc.expectFields.filter((f) => getField(data, f) == null);
        if (missing.length > 0) {
          log.fail(`${tc.tool} — missing fields: ${missing.join(", ")}`);
          failed++;
          return;
        }
      }
      if (tc.validate) {
        const reason = tc.validate(data);
        if (reason) {
          log.fail(`${tc.tool} — ${reason}`);
          failed++;
          return;
        }
      }
    }

    log.pass(tc.tool);
    passed++;
  } catch (err) {
    const msg = String(err);
    if (isNotFoundError(msg)) {
      log.fail(`${tc.tool} — ${msg.slice(0, 100)}`);
      failed++;
    } else if (tc.allowError) {
      log.warn(`${tc.tool} → ${msg.slice(0, 80)}`);
      warned++;
    } else {
      log.fail(`${tc.tool} — throw: ${msg.slice(0, 80)}`);
      failed++;
    }
  }
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}Gate MCP Tools Integration Test${RESET}`);
  console.log(`${GRAY}Server: ${SERVER_URL}${RESET}`);

  // 解析 token：优先 MCP_TOKEN 环境变量，其次读本地 auth 文件
  const mcpToken = process.env["MCP_TOKEN"] ?? loadAuth()?.mcp_token ?? null;
  if (mcpToken) {
    console.log(`${GREEN}Token: loaded${RESET} (功能测试已启用)\n`);
  } else {
    console.log(`${YELLOW}Token: not found${RESET} (只运行 Phase 1 & Phase 2，跳过功能测试)\n`);
    console.log(`${GRAY}  提示：运行 "gate-wallet login" 登录后重试，或设置 MCP_TOKEN=xxx${RESET}\n`);
  }

  const mcp = new GateMcpClient({ serverUrl: SERVER_URL });
  await mcp.connect();
  if (mcpToken) mcp.setMcpToken(mcpToken);
  console.log(`${GREEN}✓ Connected${RESET}\n`);

  // ══════════════════════════════════════════════════════════
  // Phase 1 — Tool Name Verification
  // ══════════════════════════════════════════════════════════
  console.log(`${BOLD}Phase 1: Tool Name Verification${RESET}`);
  const { tools } = await mcp.listTools();
  const serverNames = new Set(tools.map((t) => t.name));
  console.log(`${GRAY}  Server exposes ${serverNames.size} tool(s)${RESET}\n`);

  for (const name of EXPECTED_TOOLS) {
    if (serverNames.has(name)) {
      log.pass(name);
      passed++;
    } else {
      log.fail(`${name} — NOT FOUND on server`);
      failed++;
    }
  }

  const extras = [...serverNames].filter((n) => !EXPECTED_TOOLS.includes(n));
  if (extras.length > 0) {
    console.log(`\n${YELLOW}  Server 多出的 tool（未在预期列表）：${RESET}`);
    for (const n of extras) { log.warn(n); warned++; }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2 — Public Tool Call Tests
  // ══════════════════════════════════════════════════════════
  console.log(`\n${BOLD}Phase 2: Public Tool Call Tests${RESET}\n`);
  for (const tc of PUBLIC_TESTS) {
    await runTest(mcp, tc);
  }

  // ══════════════════════════════════════════════════════════
  // Phase 3 — Authenticated Functional Tests
  // ══════════════════════════════════════════════════════════
  console.log(`\n${BOLD}Phase 3: Authenticated Functional Tests${RESET}\n`);

  if (!mcpToken) {
    for (const tc of AUTH_TESTS) {
      log.skip(`${tc.tool} (no token)`);
      skipped++;
    }
  } else {
    for (const tc of AUTH_TESTS) {
      await runTest(mcp, tc);
    }
  }

  // ══════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════
  console.log(`\n${"─".repeat(50)}`);
  console.log(`${BOLD}Results${RESET}`);
  console.log(`  ${GREEN}Passed : ${passed}${RESET}`);
  if (warned   > 0) console.log(`  ${YELLOW}Warned : ${warned}${RESET}`);
  if (skipped  > 0) console.log(`  ${GRAY}Skipped: ${skipped}${RESET}`);
  if (failed   > 0) console.log(`  ${RED}Failed : ${failed}${RESET}`);
  console.log();

  await mcp.disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal: ${String(err)}${RESET}`);
  process.exit(1);
});
