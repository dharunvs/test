import { isClerkConfigured } from "./clerk";

export const WEB_AUTH_ACCESS_TOKEN_COOKIE = "branchline.web.access_token";
export const WEB_AUTH_REFRESH_TOKEN_COOKIE = "branchline.web.refresh_token";
export const WEB_AUTH_USER_EMAIL_COOKIE = "branchline.web.user_email";
export const WEB_AUTH_USER_NAME_COOKIE = "branchline.web.user_name";
export const GITHUB_OAUTH_STATE_COOKIE = "branchline.web.github_oauth_state";
export const GITHUB_OAUTH_RETURN_TO_COOKIE = "branchline.web.github_oauth_return_to";

export type WebAuthMode = "clerk" | "github" | "none";

export const missingWebAuthConfigMessage =
  "Web auth is not configured. Set Clerk keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY) or GitHub OAuth keys (GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET).";

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isGithubOAuthConfigured() {
  return hasValue(process.env.GITHUB_CLIENT_ID) && hasValue(process.env.GITHUB_CLIENT_SECRET);
}

export function resolveWebAuthMode(): WebAuthMode {
  if (isClerkConfigured()) {
    return "clerk";
  }

  if (isGithubOAuthConfigured()) {
    return "github";
  }

  return "none";
}

export function resolveApiBaseUrl() {
  return process.env.BRANCHLINE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
}

export function normalizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) {
    return "/";
  }

  if (value.startsWith("//")) {
    return "/";
  }

  return value;
}
