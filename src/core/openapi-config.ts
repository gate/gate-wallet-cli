/**
 * OpenAPI 配置管理 - 保存/读取 AK/SK 到 ~/.gate-wallet/openapi.json
 * 与 auth.json 同目录，独立文件
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface OpenApiCredential {
  api_key: string;
  secret_key: string;
  endpoint?: string;
}

export interface OpenApiConfig {
  trade: OpenApiCredential;
  query: OpenApiCredential;
  default_slippage?: number;
  default_slippage_type?: number;
}

const CONFIG_DIR = join(homedir(), ".gate-wallet");
const CONFIG_FILE = join(CONFIG_DIR, "openapi.json");

/**
 * 加载 OpenAPI 配置。若文件不存在或无效则返回 null。
 */
export function loadOpenApiConfig(): OpenApiConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    if (!raw?.trade?.api_key || !raw?.query?.api_key) return null;
    return raw as OpenApiConfig;
  } catch {
    return null;
  }
}

/**
 * 保存 OpenAPI 配置到磁盘
 */
export function saveOpenApiConfig(config: OpenApiConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // ignore
  }
}

/**
 * 判断 OpenAPI 配置文件是否存在且有效
 */
export function hasOpenApiConfig(): boolean {
  return loadOpenApiConfig() !== null;
}

/**
 * 获取配置文件路径
 */
export function getOpenApiConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * 脱敏展示 Secret Key（仅显示末 4 位）
 */
export function maskSecretKey(sk: string): string {
  if (sk.length <= 4) return "sk_****";
  return `sk_****${sk.slice(-4)}`;
}
