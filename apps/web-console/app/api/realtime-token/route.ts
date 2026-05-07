import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  WEB_AUTH_ACCESS_TOKEN_COOKIE,
  missingWebAuthConfigMessage,
  resolveWebAuthMode
} from "../../../lib/web-auth";

export async function GET() {
  const authMode = resolveWebAuthMode();
  const e2eBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN?.trim();

  if (authMode === "github") {
    const cookieStore = await cookies();
    const token = cookieStore.get(WEB_AUTH_ACCESS_TOKEN_COOKIE)?.value?.trim();
    if (token) {
      return NextResponse.json({ token });
    }

    if (e2eBearerToken) {
      return NextResponse.json({ token: e2eBearerToken });
    }

    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (authMode === "none") {
    if (e2eBearerToken) {
      return NextResponse.json({ token: e2eBearerToken });
    }

    return NextResponse.json({ error: missingWebAuthConfigMessage }, { status: 503 });
  }

  const template = process.env.CLERK_API_TOKEN_TEMPLATE;
  const sessionAuth = await auth();
  const token = await sessionAuth.getToken(template ? { template } : undefined);

  if (!token && e2eBearerToken) {
    return NextResponse.json({ token: e2eBearerToken });
  }

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ token });
}
