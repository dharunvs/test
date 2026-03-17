import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isClerkConfigured, missingClerkConfigMessage } from "../../../lib/clerk";

export async function GET() {
  const e2eBearerToken = process.env.BRANCHLINE_E2E_BEARER_TOKEN?.trim();
  if (!isClerkConfigured()) {
    if (e2eBearerToken) {
      return NextResponse.json({ token: e2eBearerToken });
    }
    return NextResponse.json({ error: missingClerkConfigMessage }, { status: 503 });
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
