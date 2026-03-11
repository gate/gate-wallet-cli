/**
 * Token 持久化 - 保存/读取 mcp_token 到 ~/.gate-wallet/auth.json
 * 避免每次 CLI 启动都需要重新登录
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
