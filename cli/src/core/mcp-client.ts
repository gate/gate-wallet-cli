/**
 * MCP Client 单例 - 连接远程 MCP Server
 * 两种钱包模式共用：
 *   - 本地钱包：查余额、查 gas、广播交易
 *   - 托管钱包：以上 + 服务端签名 (需 mcp_token)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpClientConfig {
  serverUrl: string;
  apiKey?: string;
}

const DEFAULT_SERVER_URL = "https://wallet-service-mcp-prod.gateweb3.cc/mcp";

export function getServerUrl(): string {
  return process.env["MCP_URL"] ?? DEFAULT_SERVER_URL;
}

const DEFAULT_CONFIG: McpClientConfig = {
  get serverUrl() {
    return getServerUrl();
  },
};

// ─── 单例 ───────────────────────────────────────────────

let instance: GateMcpClient | null = null;

/**
 * 获取 MCP Client 单例，首次调用时自动连接
 */
export async function getMcpClient(
  config?: Partial<McpClientConfig>,
): Promise<GateMcpClient> {
  if (instance?.isConnected()) {
    return instance;
  }
  instance = new GateMcpClient(config);
  await instance.connect();
  return instance;
}

/**
 * 获取已存在的 MCP Client（不自动连接）
 */
export function getMcpClientSync(): GateMcpClient | null {
  return instance?.isConnected() ? instance : null;
}

// ─── Client 类 ──────────────────────────────────────────

export class GateMcpClient {
  private client: Client | null = null;
  private config: McpClientConfig;
  private mcpToken: string | null = null;

  constructor(config?: Partial<McpClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async connect(): Promise<void> {
    const url = new URL(this.config.serverUrl);
    const apiKey = this.config.apiKey ?? "mcp_ak_demo";

    const requestInit: RequestInit | undefined = apiKey
      ? { headers: { "x-api-key": apiKey } }
      : undefined;

    const transport = new StreamableHTTPClientTransport(
      url,
      requestInit ? { requestInit } : undefined,
    );

    this.client = new Client({
      name: "gate-wallet-cli",
      version: "1.0.0",
    });

    await this.client.connect(transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ─── Token 管理（托管钱包认证后设置）────────────────────

  setMcpToken(token: string): void {
    this.mcpToken = token;
  }

  getMcpToken(): string | null {
    return this.mcpToken;
  }

  clearMcpToken(): void {
    this.mcpToken = null;
  }

  // ─── 认证 Tools（托管钱包用）──────────────────────────

  async authGateLoginStart() {
    return this.callTool("auth.gate_login_start");
  }

  async authGateLoginPoll(flowId: string) {
    return this.callTool("auth.gate_login_poll", { flow_id: flowId });
  }

  async authGoogleLoginStart() {
    return this.callTool("auth.google_login_start");
  }

  async authGoogleLoginPoll(flowId: string) {
    return this.callTool("auth.google_login_poll", { flow_id: flowId });
  }

  /**
   * 通过 auth code + redirect_uri 直接登录（本地回调模式使用）
   */
  async authLoginWithCode(
    provider: "gate" | "google",
    code: string,
    redirectUrl: string,
  ) {
    const tool =
      provider === "google"
        ? "auth.login_google_wallet"
        : "auth.login_gate_wallet";
    return this.callTool(tool, { code, redirect_url: redirectUrl });
  }

  getServerBaseUrl(): string {
    return this.config.serverUrl.replace(/\/mcp$/, "");
  }

  async authLogout() {
    if (!this.mcpToken) return;
    const result = await this.callTool("auth.logout", {
      mcp_token: this.mcpToken,
    });
    this.mcpToken = null;
    return result;
  }

  // ─── 通用 Tool 调用 ──────────────────────────────────

  async listTools() {
    this.ensureConnected();
    return this.client!.listTools();
  }

  /**
   * 调用 MCP Tool，已登录时自动注入 mcp_token
   */
  async callTool(name: string, args: Record<string, unknown> = {}) {
    this.ensureConnected();
    const finalArgs =
      this.mcpToken && !args["mcp_token"]
        ? { ...args, mcp_token: this.mcpToken }
        : args;
    return this.client!.callTool({ name, arguments: finalArgs });
  }

  // ─── 链上查询（两种钱包模式共用）──────────────────────

  async chainConfig(chain: string) {
    return this.callTool("chain.config", { chain });
  }

  async txGas(chain: string) {
    return this.callTool("tx.gas", { chain });
  }

  async txSendRaw(chain: string, rawTx: string) {
    return this.callTool("tx.send_raw_transaction", {
      chain,
      raw_transaction: rawTx,
    });
  }

  async txTransferPreview(params: Record<string, unknown>) {
    return this.callTool("tx.transfer_preview", params);
  }

  async txQuote(params: Record<string, unknown>) {
    return this.callTool("tx.quote", params);
  }

  async txSwap(params: Record<string, unknown>) {
    return this.callTool("tx.swap", params);
  }

  async txHistory(params: Record<string, unknown>) {
    return this.callTool("tx.history_list", params);
  }

  async txDetail(params: Record<string, unknown>) {
    return this.callTool("tx.detail", params);
  }

  // ─── 托管钱包操作（需 mcp_token）─────────────────────

  async walletGetAddresses() {
    return this.callTool("wallet.get_addresses");
  }

  async walletGetTokenList(chain?: string) {
    return this.callTool("wallet.get_token_list", chain ? { chain } : {});
  }

  async walletGetTotalAsset() {
    return this.callTool("wallet.get_total_asset");
  }

  async walletSignMessage(chain: string, message: string) {
    return this.callTool("wallet.sign_message", { chain, message });
  }

  async walletSignTransaction(chain: string, txData: Record<string, unknown>) {
    return this.callTool("wallet.sign_transaction", { chain, ...txData });
  }

  // ─── 市场数据（公开，无需认证）───────────────────────

  async tokenGetCoinInfo(params: Record<string, unknown>) {
    return this.callTool("token_get_coin_info", params);
  }

  async tokenRanking(params: Record<string, unknown>) {
    return this.callTool("token_ranking", params);
  }

  // ─── 内部方法 ─────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error("MCP client not connected. Call connect() first.");
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  isAuthenticated(): boolean {
    return this.mcpToken !== null;
  }
}
