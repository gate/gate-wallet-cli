/**
 * Gate DEX OpenAPI Client
 * 封装 HMAC-SHA256 签名 + 统一端点调用
 * 支持 trade.swap.* / base.token.* / market.* 三类 Action
 */

import { createHmac, randomUUID } from "node:crypto";
import {
  loadOpenApiConfig,
  type OpenApiConfig,
  type OpenApiCredential,
} from "./openapi-config.js";

const DEFAULT_ENDPOINT = "https://openapi.gateweb3.cc/api/v1/dex";
const SIGN_PATH = "/api/v1/dex";

export interface OpenApiResponse<T = unknown> {
  code: number;
  message?: string;
  msg?: string;
  data: T;
}

/**
 * Gate DEX OpenAPI 客户端
 */
export class GateOpenApiClient {
  private config: OpenApiConfig;

  constructor(config: OpenApiConfig) {
    this.config = config;
  }

  private credForAction(action: string): OpenApiCredential {
    if (action.startsWith("trade.swap.")) return this.config.trade;
    return this.config.query;
  }

  /**
   * Generic API call — automatically selects the correct AK/SK based on action prefix.
   * trade.swap.* → trade credentials, base.token.* / market.* → query credentials.
   */
  async call<T = unknown>(
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<OpenApiResponse<T>> {
    const cred = this.credForAction(action);
    const endpoint = cred.endpoint ?? DEFAULT_ENDPOINT;
    const signPath = new URL(endpoint).pathname;
    const compactBody = JSON.stringify({ action, params });

    const ts = String(Date.now());
    const prehash = ts + signPath + compactBody;

    const signature = createHmac("sha256", cred.secret_key)
      .update(prehash)
      .digest("base64");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": cred.api_key,
      "X-Timestamp": ts,
      "X-Signature": signature,
      "X-Request-Id": randomUUID(),
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: compactBody,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAPI HTTP ${res.status}: ${text}`);
    }

    return (await res.json()) as OpenApiResponse<T>;
  }

  // ─── trade.swap.* ─────────────────────────────────────

  /** 查询支持的链列表 */
  async swapChains() {
    return this.call<
      Array<{
        chain_id: string;
        chain: string;
        chain_name: string;
        native_currency: string;
        native_decimals: number;
      }>
    >("trade.swap.chain", {});
  }

  /** 查询 Gas 价格 */
  async swapGasPrice(chainId: number) {
    return this.call("trade.swap.gasprice", { chain_id: chainId });
  }

  /** 获取 Swap 报价 */
  async swapQuote(params: {
    chain_id: number;
    token_in: string;
    token_out: string;
    amount_in: string;
    slippage: number;
    slippage_type: number;
    user_wallet: string;
    fee_recipient?: string;
    fee_rate?: string;
  }) {
    return this.call("trade.swap.quote", params);
  }

  /** 获取 ERC20 approve calldata */
  async swapApproveTransaction(params: {
    user_wallet: string;
    approve_amount: string;
    quote_id: string;
  }) {
    return this.call("trade.swap.approve_transaction", params);
  }

  /** 构建 Swap 未签名交易 */
  async swapBuild(params: {
    chain_id: number;
    amount_in: string;
    token_in: string;
    token_out: string;
    slippage: string;
    slippage_type: string;
    user_wallet: string;
    receiver: string;
    quote_id?: string;
    sol_tip_amount?: string;
    sol_priority_fee?: string;
  }) {
    return this.call("trade.swap.build", params);
  }

  /** 提交已签名交易 */
  async swapSubmit(params: {
    order_id: string;
    signed_tx_string?: string;
    tx_hash?: string;
    signed_approve_tx_string?: string;
  }) {
    return this.call("trade.swap.submit", params);
  }

  /** 查询订单状态 */
  async swapStatus(params: {
    chain_id: number;
    order_id: string;
    tx_hash: string;
  }) {
    return this.call("trade.swap.status", params);
  }

  /** 查询历史订单 */
  async swapHistory(params: {
    user_wallet: string[];
    page_number?: number;
    page_size?: number;
    chain_id?: number;
  }) {
    return this.call("trade.swap.history", params);
  }

  // ─── base.token.* ─────────────────────────────────────

  /** 查询可 Swap 代币列表 */
  async tokenSwapList(params: {
    chain_id?: string;
    tag?: string;
    wallet?: string;
    search?: string;
    search_auth?: string;
    ignore_bridge?: string;
  }) {
    return this.call("base.token.swap_list", params);
  }

  /** 代币排行榜 */
  async tokenRanking(params: {
    chain_id?: { eq?: string; in?: string[] };
    sort: Array<{ field: string; order: string }>;
    limit: number;
    cursor?: string;
  }) {
    return this.call("base.token.ranking", params);
  }

  /** 按创建时间筛选新币 */
  async tokenRangeByCreatedAt(params: {
    start: string;
    end: string;
    chain_id?: string;
    limit?: string;
    cursor?: string;
  }) {
    return this.call("base.token.range_by_created_at", params);
  }

  /** 代币安全审计 */
  async tokenRiskInfos(params: {
    chain_id: string;
    address: string;
    lan?: string;
    ignore?: string;
  }) {
    return this.call("base.token.risk_infos", params);
  }

  /** 跨链桥代币列表 */
  async tokenBridgeList(params: {
    source_chain_id: string;
    source_address: string;
    chain_id: string;
    search?: string;
  }) {
    return this.call("base.token.bridge_list", params);
  }

  // ─── market.* ─────────────────────────────────────────

  /** 交易量统计 */
  async marketVolumeStats(params: {
    chain_id: number;
    token_address: string;
    pair_address?: string;
  }) {
    return this.call("market.volume_stats", params);
  }

  /** 流动性池事件列表 */
  async marketLiquidityList(params: {
    chain_id: number;
    token_address: string;
    pair_address?: string;
    page_index?: number;
    page_size?: number;
  }) {
    return this.call("market.pair.liquidity.list", params);
  }
}

// ─── 单例 ─────────────────────────────────────────────

let instance: GateOpenApiClient | null = null;

export function getOpenApiClient(): GateOpenApiClient | null {
  if (!instance) {
    const config = loadOpenApiConfig();
    if (!config) return null;
    instance = new GateOpenApiClient(config);
  }
  return instance;
}

export function resetOpenApiClient(): void {
  instance = null;
}
