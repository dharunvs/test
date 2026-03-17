import { afterEach, describe, expect, it } from "vitest";

import { isClerkConfigured } from "./clerk";

const originalPublishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const originalSecret = process.env.CLERK_SECRET_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublishable;
  process.env.CLERK_SECRET_KEY = originalSecret;
});

describe("isClerkConfigured", () => {
  it("returns true only when both publishable and secret keys are set", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test";
    process.env.CLERK_SECRET_KEY = "sk_test";
    expect(isClerkConfigured()).toBe(true);

    process.env.CLERK_SECRET_KEY = "";
    expect(isClerkConfigured()).toBe(false);
  });
});
