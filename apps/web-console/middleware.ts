import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isClerkConfigured } from "./lib/clerk";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const clerkConfigured = isClerkConfigured();
const allowUnauthenticatedFallback = process.env.NODE_ENV !== "production";

const middleware = clerkConfigured
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : (request: NextRequest) => {
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
