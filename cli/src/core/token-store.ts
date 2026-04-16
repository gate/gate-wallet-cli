/**
 * Token 持久化 - 保存/读取 mcp_token 到 ~/.gate-wallet/auth.json
 * 避免每次 CLI 启动都需要重新登录
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir, type, release, arch } from "node:os";
import { randomBytes } from "node:crypto";


/**
 * 构建 CLI 设备 User-Agent
 * 格式：gate-wallet-cli/{version} (macOS {version}; {arch})
 * 示例：gate-wallet-cli/1.0.6 (macOS 26.2; arm64)
 */
export function buildUserAgent(): string {
  const cpuArch = arch();

  if (type() === "Darwin") {
    try {
      const macVer = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf-8" }).trim();
      return `macOS ${macVer}; ${cpuArch}`;
    } catch {
      // 兜底用 Darwin 内核版本
    }
  }

  return `${type()} ${release()}; ${cpuArch}`;
}

export interface StoredAuth {
  mcp_token: string;
  provider: "gate" | "google";
  user_id?: string | undefined;
  expires_at?: number | undefined;
  env: string;
  server_url: string;
}

const AUTH_DIR = join(homedir(), ".gate-wallet");
const AUTH_FILE = join(AUTH_DIR, "auth.json");
const DEVICE_FILE = join(AUTH_DIR, "device.json");

export function saveAuth(auth: StoredAuth): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function loadAuth(env?: string): StoredAuth | null {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as StoredAuth;

    if (data.expires_at && Date.now() >= data.expires_at) {
      clearAuth();
      return null;
    }

    if (env && data.env !== env) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  try {
    unlinkSync(AUTH_FILE);
  } catch {
    // ignore
  }
}

export function getAuthFilePath(): string {
  return AUTH_FILE;
}

/**
 * 获取或生成稳定的设备指纹 token（首次生成后持久化到 ~/.gate-wallet/device.json）
 * 用于 GV API 的 x-gtweb3-device-token 请求头
 */
export function getOrCreateDeviceToken(): string {
  try {
    if (existsSync(DEVICE_FILE)) {
      const data = JSON.parse(readFileSync(DEVICE_FILE, "utf-8")) as {
        device_token?: string;
      };
      if (data.device_token) return data.device_token;
    }
  } catch {
    // 读取失败则重新生成
  }
  mkdirSync(AUTH_DIR, { recursive: true });
  const token = randomBytes(20).toString("hex"); // 40 位 hex 字符串
  writeFileSync(
    DEVICE_FILE,
    JSON.stringify({ device_token: token }, null, 2),
    { mode: 0o600 },
  );
  return token;
}
