import { describe, expect, it } from "vitest";

import { applyRedactionPolicy } from "../src/common/redaction.js";

describe("redaction policy", () => {
  it("redacts prompt/code fields and regex patterns", () => {
    const result = applyRedactionPolicy({
      payload: {
        prompt: "Do not expose password=secret123",
        codeSnippet: "const token = 'abc123';",
        summary: "ticket HB-1"
      },
      policy: {
        capturePromptText: false,
        captureCodeSnippets: false,
        redactionPatterns: ["HB-1", "secret\\d+"]
      }
    });

    expect(result.redactionLevel).toBe("partial");
    expect(result.payload.prompt).toBe("[REDACTED_PROMPT]");
    expect(result.payload.codeSnippet).toBe("[REDACTED_CODE]");
    expect(result.payload.summary).toBe("ticket [REDACTED]");
  });
});
