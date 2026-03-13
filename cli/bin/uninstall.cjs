#!/usr/bin/env node

/**
 * preuninstall hook — 卸载时清理用户目录下的配置文件
 *   ~/.gate-wallet/       (auth.json, openapi.json)
 *   ~/.gate-dex-openapi/  (config.json)
 */

const { rmSync, existsSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");

const dirs = [
  join(homedir(), ".gate-wallet"),
  join(homedir(), ".gate-dex-openapi"),
];

for (const dir of dirs) {
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
      console.log("[gate-wallet] removed " + dir);
    } catch (e) {
      console.warn("[gate-wallet] failed to remove " + dir);
    }
  }
}
