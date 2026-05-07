import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  GITHUB_OAUTH_RETURN_TO_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  isGithubOAuthConfigured,
  normalizeReturnTo
} from "../../../../../lib/web-auth";

function buildGithubAuthorizeUrl(request: NextRequest, state: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("GitHub OAuth is not configured");
  }

  const redirectUri = new URL("/api/auth/github/callback", request.url).toString();

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user user:email");
  authorizeUrl.searchParams.set("state", state);

  return authorizeUrl.toString();
}

export async function GET(request: NextRequest) {
  if (!isGithubOAuthConfigured()) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("error", "github_oauth_not_configured");
    return NextResponse.redirect(signInUrl);
  }

  const state = randomUUID();
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const response = NextResponse.redirect(buildGithubAuthorizeUrl(request, state));
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60
  });

  response.cookies.set(GITHUB_OAUTH_RETURN_TO_COOKIE, returnTo, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60
  });

  return response;
}
