/**
 * GV (Gate Verify) Client
 * 交易签名前的安全校验：checkin → 获取 checkin_token → 传给 MCP 签名工具
 *
 * 插件端 API 路由前缀：
 *   test: https://test-api.web3gate.io/api/plug/v1/web3-gv-api
 *   pre:  https://pre-api.web3gate.io/api/plug/v1/web3-gv-api
 *   prod: https://api.web3gate.io/api/plug/v1/web3-gv-api
 */

import { createHash } from "node:crypto";

// ─── URL 映射 ──────────────────────────────────────────────

const GV_URL_TEST = "https://test-api.web3gate.io/api/plug/v1/web3-gv-api";
const GV_URL_PRE = "https://pre-api.web3gate.io/api/plug/v1/web3-gv-api";
const GV_URL_PROD = "https://api.web3gate.io/api/plug/v1/web3-gv-api";

/**
 * 根据 MCP_URL 推断对应的 GV API base URL
 */
export function getGvBaseUrl(mcpUrl: string): string {
  if (mcpUrl.includes("-pre.") || mcpUrl.includes("pre-")) {
    return GV_URL_PRE;
  }
  if (
    mcpUrl.includes("-test.") ||
    mcpUrl.includes("test-") ||
    mcpUrl.includes("localhost")
  ) {
    return GV_URL_TEST;
  }
  return GV_URL_PROD;
}

// ─── 类型定义 ──────────────────────────────────────────────

export interface GvCheckinParams {
  wallet_address: string;
  /** 前端组装交易时传 message（string）；后端组装时传 intent（object，二选一） */
  message?: string;
  intent?: Record<string, unknown>;
  /** 交易类型，可选 */
  type?: string;
  /** 实际业务接口路径，如 /wallet/transfer */
  module: string;
  /**
   * checkin 来源：0=web 1=app 2=plugin 3=aiAgent 4=business
   * aiAgent/business 用于 MCP 相关业务
   */
  source?: number;
}

export interface GvCheckinResult {
  checkin_token: string;
  need_otp: boolean;
}

/**
 * dex_tx_swap_checkin_preview 实际返回的字段结构
 */
export interface SwapCheckinPreviewFields {
  /** 本阶段使用的 mcp_token */
  mcp_token?: string;
  /** 链名，如 arb / eth */
  chain?: string;
  chain_category?: string;
  /** 钱包地址，对应 GV checkin 的 wallet_address */
  user_wallet?: string;
  /** GV checkin API 路径，通常为 /api/v1/tx/checkin */
  checkin_path?: string;
  /** 待签名的消息体（TxBundle JSON 字符串），对应 GV checkin 的 message */
  checkin_message?: string;
}

// ─── 签名算法 ──────────────────────────────────────────────

interface SignatureParams {
  "api-sign": string;
  "api-timestamp": number;
  "api-code": number;
}

function generateSignature(
  method: string,
  apiPath: string,
  data: object,
): SignatureParams {
  const dataString = JSON.stringify(data);
  const timestamp = Math.floor(Date.now() / 1000);
  // 9 位随机整数
  const code = Math.floor(Math.random() * 1_000_000_000);

  // {METHOD}|{API_PATH}|{JSON_BODY}|{TIMESTAMP}|{CODE}
  const message = [
    method.toUpperCase(),
    apiPath,
    dataString,
    String(timestamp),
    String(code),
  ].join("|");

  const hash = createHash("sha256").update(message).digest("hex");
  // 取最后 16 个字符（8 字节）
  const sign = hash.slice(-16);

  return { "api-sign": sign, "api-timestamp": timestamp, "api-code": code };
}

// ─── GvClient ─────────────────────────────────────────────

export class GvClient {
  private readonly baseUrl: string;
  private readonly mcpToken: string;
  private readonly deviceToken: string;

  constructor(opts: {
    baseUrl: string;
    mcpToken: string;
    deviceToken: string;
  }) {
    this.baseUrl = opts.baseUrl;
    this.mcpToken = opts.mcpToken;
    this.deviceToken = opts.deviceToken;
  }

  private buildHeaders(apiPath: string, body: object): Record<string, string> {
    const sig = generateSignature("POST", apiPath, body);
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      source: "3",
      "x-gtweb3-device-token": this.deviceToken,
      Authorization: `Bearer ${this.mcpToken}`,
      "api-sign": sig["api-sign"],
      "api-timestamp": String(sig["api-timestamp"]),
      "api-code": String(sig["api-code"]),
    };
  }

  /**
   * 交易签名登记 — 获取 checkin_token
   */
  async txCheckin(params: GvCheckinParams): Promise<GvCheckinResult> {
    const apiPath = "/api/v1/tx/checkin";
    const url = `${this.baseUrl}${apiPath}`;

    const res = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(apiPath, params),
      body: JSON.stringify(params),
    });

    const json = (await res.json()) as {
      code: number;
      message?: string;
      data?: GvCheckinResult;
    };

    if (json.code !== 0 || !json.data) {
      throw new Error(
        `GV checkin 失败 (code=${json.code}): ${json.message ?? "unknown error"}`,
      );
    }

    return json.data;
  }

  /**
   * OTP 二次验证（need_otp=true 时调用）
   */
  async verifyOtp(
    checkinToken: string,
    pubKey: string,
    otpCode: string,
  ): Promise<void> {
    const apiPath = "/api/v1/security/verify";
    const url = `${this.baseUrl}${apiPath}`;
    const body = {
      checkin_token: checkinToken,
      pub_key: pubKey,
      otp_code: otpCode,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(apiPath, body),
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as { code: number; message?: string };

    if (json.code !== 0) {
      throw new Error(
        `OTP 验证失败 (code=${json.code}): ${json.message ?? "unknown error"}`,
      );
    }
  }
}
