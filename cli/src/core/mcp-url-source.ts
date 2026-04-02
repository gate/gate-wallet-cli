/**
 * 推断当前生效的 MCP_URL 来自哪里（需在 index 加载 .env 之前注册 shell 快照）
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_MCP_SERVER_URL, getServerUrl } from "./mcp-client.js";

let shellEnvKeys: Set<string> | null = null;

/** 在读取任何 .env 之前调用一次（见 cli/src/cli/index.ts） */
export function registerShellEnvSnapshot(keys: Set<string>): void {
  shellEnvKeys = keys;
}

function envFileDeclaresKey(filePath: string, key: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const text = readFileSync(filePath, "utf-8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      if (t.slice(0, eq).trim() === key) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/** 与 index.ts 中 PKG_ROOT 一致：cli 包根目录 */
function getCliPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function getRepoRootEnvPath(): string {
  return join(getCliPackageRoot(), "..", ".env");
}

export interface McpUrlProvenance {
  /** 当前实际使用的 MCP 地址 */
  url: string;
  /** 简短来源标签 */
  source: string;
  /** 人类可读说明 */
  detail: string;
}

/**
 * 推断 MCP_URL 来源（依赖与 index.ts 相同的加载顺序：用户 fill → 仓库 override → cwd override）
 */
export function getMcpUrlProvenance(): McpUrlProvenance {
  const url = getServerUrl();
  const snap = shellEnvKeys;

  if (snap?.has("MCP_URL")) {
    return {
      url,
      source: "shell",
      detail: "启动前已在进程环境中（终端 export、IDE 运行配置、CI 等），.env 不会覆盖",
    };
  }

  const cwdEnv = join(process.cwd(), ".env");
  const repoEnv = getRepoRootEnvPath();
  const userEnv = join(homedir(), ".gate-wallet", ".env");

  if (envFileDeclaresKey(cwdEnv, "MCP_URL")) {
    return {
      url,
      source: "cwd-.env",
      detail: `${cwdEnv}（当前工作目录，最后加载）`,
    };
  }
  if (envFileDeclaresKey(repoEnv, "MCP_URL")) {
    return {
      url,
      source: "repo-.env",
      detail: `${repoEnv}（仓库根目录）`,
    };
  }
  if (envFileDeclaresKey(userEnv, "MCP_URL")) {
    return {
      url,
      source: "user-.env",
      detail: `${userEnv}`,
    };
  }

  if (url === DEFAULT_MCP_SERVER_URL) {
    return {
      url,
      source: "default",
      detail: "未在任何 .env 或 shell 中设置 MCP_URL，使用内置默认（生产）",
    };
  }

  return {
    url,
    source: "unknown",
    detail: "未在已知 .env 中找到 MCP_URL，但当前值与默认不同（可能被其它方式注入）",
  };
}
