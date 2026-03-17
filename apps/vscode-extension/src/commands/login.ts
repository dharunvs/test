import * as vscode from "vscode";

import { ApiClient } from "../services/api-client.js";

const ACCESS_TOKEN_KEY = "branchline.authToken";
const REFRESH_TOKEN_KEY = "branchline.refreshToken";
const ACCESS_TOKEN_EXPIRES_AT_KEY = "branchline.authTokenExpiresAt";
const API_BASE_URL = process.env.BRANCHLINE_API_BASE_URL ?? "http://localhost:4000/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function storeTokenBundle(
  context: vscode.ExtensionContext,
  bundle: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }
) {
  await context.secrets.store(ACCESS_TOKEN_KEY, bundle.accessToken);
  await context.secrets.store(REFRESH_TOKEN_KEY, bundle.refreshToken);
  await context.globalState.update(ACCESS_TOKEN_EXPIRES_AT_KEY, Date.now() + bundle.expiresIn * 1000);
}

export async function clearStoredAuth(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(ACCESS_TOKEN_KEY);
  await context.secrets.delete(REFRESH_TOKEN_KEY);
  await context.globalState.update(ACCESS_TOKEN_EXPIRES_AT_KEY, undefined);
}

export async function runLogin(context: vscode.ExtensionContext): Promise<void> {
  const e2eEmail = process.env.BRANCHLINE_E2E_EMAIL?.trim();
  const email =
    e2eEmail && e2eEmail.length > 0
      ? e2eEmail
      : await vscode.window.showInputBox({
          title: "Branchline account email",
          placeHolder: "you@company.com (optional in dev)",
          ignoreFocusOut: true
        });

  const api = new ApiClient(API_BASE_URL);
  const start = await api.startDeviceAuth({
    email: email || undefined,
    role: "member"
  });

  if (process.env.BRANCHLINE_E2E_SKIP_BROWSER !== "1") {
    await vscode.env.openExternal(vscode.Uri.parse(start.verificationUriComplete));
  }
  vscode.window.showInformationMessage(
    `Branchline login code: ${start.userCode}. Complete verification in browser.`
  );

  const maxAttempts = Math.ceil(start.expiresIn / Math.max(start.interval, 1));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await api.exchangeDeviceCode(start.deviceCode);
    if (result.status === "approved") {
      await storeTokenBundle(context, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn
      });
      vscode.window.showInformationMessage("Branchline login complete.");
      return;
    }

    await sleep(start.interval * 1000);
  }

  vscode.window.showErrorMessage("Branchline login timed out. Try again.");
}

export async function getStoredRefreshToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(REFRESH_TOKEN_KEY);
}

export async function getValidAccessToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const accessToken = await context.secrets.get(ACCESS_TOKEN_KEY);
  const expiresAt = context.globalState.get<number>(ACCESS_TOKEN_EXPIRES_AT_KEY);

  if (accessToken && expiresAt && expiresAt > Date.now() + 30_000) {
    return accessToken;
  }

  const refreshToken = await context.secrets.get(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    return undefined;
  }

  try {
    const api = new ApiClient(API_BASE_URL);
    const refreshed = await api.refreshAuth({
      refreshToken
    });

    await storeTokenBundle(context, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresIn: refreshed.expiresIn
    });

    return refreshed.accessToken;
  } catch {
    await clearStoredAuth(context);
    return undefined;
  }
}
