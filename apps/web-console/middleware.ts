import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { WEB_AUTH_ACCESS_TOKEN_COOKIE, resolveWebAuthMode } from "./lib/web-auth";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/auth/github(.*)"]);
const authMode = resolveWebAuthMode();
const fallbackBearerTokenConfigured = Boolean(process.env.BRANCHLINE_E2E_BEARER_TOKEN?.trim());
const allowUnauthenticatedFallback =
  process.env.NODE_ENV !== "production" || fallbackBearerTokenConfigured;

const middleware = authMode === "clerk"
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : (request: NextRequest) => {
      if (authMode === "github") {
        if (isPublicRoute(request)) {
          return NextResponse.next();
        }

        const token = request.cookies.get(WEB_AUTH_ACCESS_TOKEN_COOKIE)?.value;
        if (typeof token === "string" && token.trim().length > 0) {
          return NextResponse.next();
        }

        const signInUrl = new URL("/sign-in", request.url);
        const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
        signInUrl.searchParams.set("returnTo", returnTo);
        return NextResponse.redirect(signInUrl);
      }

      if (allowUnauthenticatedFallback) {
        return NextResponse.next();
      }

      if (isPublicRoute(request)) {
        return NextResponse.next();
      }

      return new NextResponse("Web auth is not configured on this deployment.", {
        status: 503
      });
    };

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/(.*)"]
};
