import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  WEB_AUTH_ACCESS_TOKEN_COOKIE,
  WEB_AUTH_REFRESH_TOKEN_COOKIE,
  WEB_AUTH_USER_EMAIL_COOKIE,
  WEB_AUTH_USER_NAME_COOKIE,
  normalizeReturnTo
} from "../../../../../lib/web-auth";

export async function GET(request: NextRequest) {
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const signInUrl = new URL("/sign-in", request.url);
  if (returnTo !== "/") {
    signInUrl.searchParams.set("returnTo", returnTo);
  }

  const response = NextResponse.redirect(signInUrl);
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

  return response;
}
