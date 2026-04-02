/**
 * 推断当前生效的 MCP_URL 来自哪里（需在 index 加载 .env 之前注册 shell 快照）
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_MCP_SERVER_URL, getServerUrl } from "./mcp-client.js";

/** cli 包根（与 index 中 PKG_ROOT 一致），用于推断「相对安装位置」的 .env */
function getCliPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

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

/** 自 cwd 向上找：离当前目录最近、且 .env 里声明了 MCP_URL 的文件（与加载时「内层覆盖外层」一致） */
function nearestEnvFileDeclaringMcpUrl(): string | null {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 32; i++) {
    const p = join(dir, ".env");
    if (envFileDeclaresKey(p, "MCP_URL")) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
 * 推断 MCP_URL 来源（与 index 一致：用户 fill → 包相对上一级 .env → cwd 向上各级 .env）
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

  const userEnv = join(homedir(), ".gate-wallet", ".env");
  const fromWalk = nearestEnvFileDeclaringMcpUrl();
  if (fromWalk) {
    const rel =
      fromWalk === join(process.cwd(), ".env")
        ? "（当前目录）"
        : "（自当前工作目录向上找到）";
    return {
      url,
      source: "project-.env",
      detail: `${fromWalk}${rel}`,
    };
  }
  if (envFileDeclaresKey(userEnv, "MCP_URL")) {
    return {
      url,
      source: "user-.env",
      detail: `${userEnv}`,
    };
  }

  const pkgSiblingEnv = join(getCliPackageRoot(), "..", ".env");
  if (envFileDeclaresKey(pkgSiblingEnv, "MCP_URL")) {
    return {
      url,
      source: "package-.env",
      detail: `${pkgSiblingEnv}（相对全局/本地安装的 CLI 包目录的上一级，可能与当前项目无关）`,
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
