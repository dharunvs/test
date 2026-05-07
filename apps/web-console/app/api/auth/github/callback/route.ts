import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  GITHUB_OAUTH_RETURN_TO_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  WEB_AUTH_ACCESS_TOKEN_COOKIE,
  WEB_AUTH_REFRESH_TOKEN_COOKIE,
  WEB_AUTH_USER_EMAIL_COOKIE,
  WEB_AUTH_USER_NAME_COOKIE,
  isGithubOAuthConfigured,
  normalizeReturnTo,
  resolveApiBaseUrl
} from "../../../../../lib/web-auth";

interface GithubExchangeResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: string;
  user?: {
    email?: string;
    displayName?: string;
  };
}

function clearOauthCookies(response: NextResponse) {
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
  response.cookies.set(GITHUB_OAUTH_RETURN_TO_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.set(WEB_AUTH_ACCESS_TOKEN_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
  response.cookies.set(WEB_AUTH_REFRESH_TOKEN_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
  response.cookies.set(WEB_AUTH_USER_EMAIL_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
  response.cookies.set(WEB_AUTH_USER_NAME_COOKIE, "", {
    path: "/",
    maxAge: 0
  });
}

function buildSignInUrl(request: NextRequest, returnTo: string, error: string): URL {
  const url = new URL("/sign-in", request.url);
  if (returnTo !== "/") {
    url.searchParams.set("returnTo", returnTo);
  }
  url.searchParams.set("error", error);
  return url;
}

function isGithubExchangeResponse(value: unknown): value is GithubExchangeResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresIn === "number" &&
    typeof candidate.refreshExpiresAt === "string"
  );
}

export async function GET(request: NextRequest) {
  const returnToCookie = normalizeReturnTo(request.cookies.get(GITHUB_OAUTH_RETURN_TO_COOKIE)?.value);

  if (!isGithubOAuthConfigured()) {
    const response = NextResponse.redirect(buildSignInUrl(request, returnToCookie, "github_oauth_not_configured"));
    clearOauthCookies(response);
    clearSessionCookies(response);
    return response;
  }

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    const response = NextResponse.redirect(buildSignInUrl(request, returnToCookie, "oauth_cancelled"));
    clearOauthCookies(response);
    clearSessionCookies(response);
    return response;
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(buildSignInUrl(request, returnToCookie, "oauth_state_mismatch"));
    clearOauthCookies(response);
    clearSessionCookies(response);
    return response;
  }

  const redirectUri = new URL("/api/auth/github/callback", request.url).toString();

  try {
    const exchangeResponse = await fetch(`${resolveApiBaseUrl()}/auth/github/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        code,
        redirectUri
      })
    });

    if (!exchangeResponse.ok) {
      throw new Error(`GitHub exchange failed (${exchangeResponse.status})`);
    }

    const payload: unknown = await exchangeResponse.json();
    if (!isGithubExchangeResponse(payload)) {
      throw new Error("Unexpected GitHub exchange payload");
    }

    const destination = new URL(returnToCookie, request.url);
    const response = NextResponse.redirect(destination);
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set(WEB_AUTH_ACCESS_TOKEN_COOKIE, payload.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(60, Math.floor(payload.expiresIn))
    });

    const refreshExpiresAt = Date.parse(payload.refreshExpiresAt);
    const refreshMaxAgeSeconds = Number.isFinite(refreshExpiresAt)
      ? Math.max(60, Math.floor((refreshExpiresAt - Date.now()) / 1000))
      : 30 * 24 * 60 * 60;

    response.cookies.set(WEB_AUTH_REFRESH_TOKEN_COOKIE, payload.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: refreshMaxAgeSeconds
    });

    if (payload.user?.email) {
      response.cookies.set(WEB_AUTH_USER_EMAIL_COOKIE, payload.user.email, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: refreshMaxAgeSeconds
      });
    }

    if (payload.user?.displayName) {
      response.cookies.set(WEB_AUTH_USER_NAME_COOKIE, payload.user.displayName, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: refreshMaxAgeSeconds
      });
    }

    clearOauthCookies(response);
    return response;
  } catch {
    const response = NextResponse.redirect(buildSignInUrl(request, returnToCookie, "oauth_exchange_failed"));
    clearOauthCookies(response);
    clearSessionCookies(response);
    return response;
  }
}
