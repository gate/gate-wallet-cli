/**
 * OAuth - CLI 本地回调模式
 * 1. 启动本地 HTTP Server
 * 2. 打开浏览器跳转授权页
 * 3. 用户授权后回调到 localhost
 * 4. 本地 Server 接收 code，换取 token
 * 5. 浏览器显示"授权成功，可以关闭"
 */

import { createServer, type Server } from "node:http";
import open from "open";

// ─── 公共类型 ─────────────────────────────────────────────

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
  userId: string;
  walletAddress?: string | undefined;
}

interface TokenExchangeResponse {
  access_token?: string;
  mcp_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string;
  wallet_address?: string;
  error?: string;
}

// ─── HTML 模板 ──────────────────────────────────────────

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Success</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .check { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #1a1a1a; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h2>Authorization Successful</h2>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Error</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #e53e3e; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h2>Authorization Failed</h2>
    <p>${msg}</p>
  </div>
</body>
</html>`;

// ─── 跨平台打开浏览器 ──────────────────────────────────

export async function openBrowser(url: string): Promise<boolean> {
  try {
    await open(url);
    return true;
  } catch {
    printManualUrl(url);
    return false;
  }
}

function printManualUrl(url: string): void {
  const termLink = `\x1b]8;;${url}\x1b\\Click here to open\x1b]8;;\x1b\\`;
  console.log();
  console.log(`\x1b[33m⚠  Could not open browser automatically.\x1b[0m`);
  console.log(`\x1b[1m   ${termLink}\x1b[0m  or copy the URL below:`);
  console.log();
  console.log(`   \x1b[36m${url}\x1b[0m`);
  console.log();
}

// ─── 基类：本地回调 OAuth ──────────────────────────────

interface BaseOAuthConfig {
  mcpServerUrl: string;
  callbackPort: number;
}

abstract class BaseLocalOAuth<C extends BaseOAuthConfig> {
  protected config: C;
  private token: OAuthToken | null = null;
  private server: Server | null = null;

  constructor(config: C) {
    this.config = config;
  }

  /** 构建授权 URL（子类实现） */
  protected abstract buildAuthUrl(redirectUri: string): string;
  /** 用 code 换取 token（子类实现） */
  protected abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken>;

  async login(): Promise<OAuthToken> {
    const { code, redirectUri } = await this.waitForCallback();
    const token = await this.exchangeCode(code, redirectUri);
    this.token = token;
    return token;
  }

  private waitForCallback(): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let callbackPort = 0;

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");

        if (error) {
          const msg = errorDesc ?? error;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML(msg));
          this.closeServer();
          reject(new Error(`OAuth error: ${msg}`));
          return;
        }

        if (!code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ERROR_HTML("No authorization code received"));
          this.closeServer();
          reject(new Error("No authorization code received"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);

        const redirectUri = `http://localhost:${callbackPort}/callback`;
        this.closeServer();
        resolve({ code, redirectUri });
      });

      this.server = server;

      const onSigint = () => {
        this.closeServer();
        reject(new Error("Login cancelled by user"));
      };
      process.once("SIGINT", onSigint);

      server.listen(this.config.callbackPort, "127.0.0.1", () => {
        callbackPort = (server.address() as { port: number }).port;
        const redirectUri = `http://localhost:${callbackPort}/callback`;
        const authUrl = this.buildAuthUrl(redirectUri);
        openBrowser(authUrl).catch(() => {});
      });

      server.on("error", (err) => {
        process.removeListener("SIGINT", onSigint);
        reject(new Error(`Failed to start local server: ${err.message}`));
      });

      const timeout = setTimeout(
        () => {
          process.removeListener("SIGINT", onSigint);
          this.closeServer();
          reject(new Error("OAuth login timed out (5 minutes)"));
        },
        5 * 60 * 1000,
      );
      timeout.unref();
    });
  }

  protected parseTokenResponse(data: TokenExchangeResponse): OAuthToken {
    if (data.error) {
      throw new Error(data.error);
    }
    const accessToken = data.access_token ?? data.mcp_token;
    if (!accessToken) {
      throw new Error("No access_token in response");
    }
    return {
      accessToken,
      tokenType: data.token_type ?? "Bearer",
      expiresIn: data.expires_in ?? 2592000,
      expiresAt: Date.now() + (data.expires_in ?? 2592000) * 1000,
      userId: data.user_id ?? "",
      walletAddress: data.wallet_address,
    };
  }

  private closeServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  getToken(): OAuthToken | null {
    if (this.token && Date.now() >= this.token.expiresAt) {
      this.token = null;
    }
    return this.token;
  }

  setToken(token: OAuthToken): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
    this.closeServer();
  }

  getBaseUrl(): string {
    return this.config.mcpServerUrl;
  }
}

// ─── Gate OAuth ──────────────────────────────────────────

export interface GateOAuthConfig extends BaseOAuthConfig {
  gateAuthEndpoint: string;
  clientId: string;
  scope: string;
}

const GATE_DEFAULT_CONFIG: GateOAuthConfig = {
  mcpServerUrl: "https://wallet-service-mcp-test.gateweb3.cc",
  gateAuthEndpoint: "https://www.gate.com/oauth/authorize",
  clientId: "JWjvVeiJaePiTvQZ",
  scope: "fomox_login_info",
  callbackPort: 0,
};

export class GateOAuth extends BaseLocalOAuth<GateOAuthConfig> {
  constructor(config?: Partial<GateOAuthConfig>) {
    super({ ...GATE_DEFAULT_CONFIG, ...config });
  }

  protected buildAuthUrl(redirectUri: string): string {
    const url = new URL(this.config.gateAuthEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scope);
    return url.toString();
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken> {
    const res = await fetch(
      `${this.config.mcpServerUrl}/oauth/gate/device/callback?code=${encodeURIComponent(code)}&redirect_url=${encodeURIComponent(redirectUri)}`,
    );

    if (!res.ok) {
      const altRes = await fetch(
        `${this.config.mcpServerUrl}/account/user/gate_oauth?code=${encodeURIComponent(code)}`,
      );
      if (!altRes.ok) {
        throw new Error(
          `Token exchange failed: ${res.status} ${res.statusText}`,
        );
      }
      return this.parseTokenResponse(
        (await altRes.json()) as TokenExchangeResponse,
      );
    }

    return this.parseTokenResponse((await res.json()) as TokenExchangeResponse);
  }
}

// ─── Google OAuth ────────────────────────────────────────

export interface GoogleOAuthConfig extends BaseOAuthConfig {
  googleAuthEndpoint: string;
  clientId: string;
  scope: string;
}

const GOOGLE_DEFAULT_CONFIG: GoogleOAuthConfig = {
  mcpServerUrl: "https://wallet-service-mcp-test.gateweb3.cc",
  googleAuthEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  clientId:
    "940295588443-q9j9ub6k6i1cbvfv3jtscjkh389k2r8l.apps.googleusercontent.com",
  scope: "openid email profile",
  callbackPort: 9876,
};

export class GoogleOAuth extends BaseLocalOAuth<GoogleOAuthConfig> {
  constructor(config?: Partial<GoogleOAuthConfig>) {
    super({ ...GOOGLE_DEFAULT_CONFIG, ...config });
  }

  protected buildAuthUrl(redirectUri: string): string {
    if (!this.config.clientId) {
      throw new Error(
        "Google OAuth client_id is not configured. Fetch it from MCP Server first.",
      );
    }
    const url = new URL(this.config.googleAuthEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scope);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthToken> {
    const res = await fetch(
      `${this.config.mcpServerUrl}/oauth/google/device/callback?code=${encodeURIComponent(code)}&redirect_url=${encodeURIComponent(redirectUri)}`,
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token exchange failed: ${res.status} ${text}`);
    }

    return this.parseTokenResponse((await res.json()) as TokenExchangeResponse);
  }
}
