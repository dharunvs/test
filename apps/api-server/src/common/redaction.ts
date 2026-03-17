import type { PrismaService } from "./prisma.service.js";

export interface EffectiveRedactionPolicy {
  capturePromptText: boolean;
  captureCodeSnippets: boolean;
  redactionPatterns: string[];
}

const DEFAULT_REDACTION_POLICY: EffectiveRedactionPolicy = {
  capturePromptText: true,
  captureCodeSnippets: true,
  redactionPatterns: []
};

const PROMPT_KEY_MATCH = /(prompt|instruction|system_message|user_message|assistant_message)/i;
const CODE_KEY_MATCH = /(code|diff|patch|snippet|file_content|completion)/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 50);
}

function applyPatternRedaction(value: string, patterns: string[]): { value: string; redacted: boolean } {
  let next = value;
  let redacted = false;

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "gi");
      const replaced = next.replace(regex, "[REDACTED]");
      if (replaced !== next) {
        redacted = true;
        next = replaced;
      }
    } catch {
      // Ignore invalid regex patterns to avoid dropping events.
    }
  }

  return {
    value: next,
    redacted
  };
}

export async function resolveRedactionPolicy(
  prisma: PrismaService,
  orgId: string
): Promise<EffectiveRedactionPolicy> {
  const policy = await prisma.redactionPolicy.findFirst({
    where: {
      orgId,
      status: "active"
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (!policy) {
    return DEFAULT_REDACTION_POLICY;
  }

  return {
    capturePromptText: policy.capturePromptText,
    captureCodeSnippets: policy.captureCodeSnippets,
    redactionPatterns: normalizePatterns(policy.redactionPatterns)
  };
}

export function applyRedactionPolicy(input: {
  payload: Record<string, unknown>;
  policy: EffectiveRedactionPolicy;
}): {
  payload: Record<string, unknown>;
  redactionLevel: "none" | "partial";
} {
  let redactionCount = 0;

  const visit = (value: unknown, path: string[]): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, [...path, String(index)]));
    }

    if (typeof value === "string") {
      const { value: redactedValue, redacted } = applyPatternRedaction(value, input.policy.redactionPatterns);
      if (redacted) {
        redactionCount += 1;
      }
      return redactedValue;
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(record)) {
      const fieldPath = [...path, key];
      const normalizedKey = fieldPath.join(".");

      if (!input.policy.capturePromptText && PROMPT_KEY_MATCH.test(normalizedKey)) {
        redactionCount += 1;
        next[key] = "[REDACTED_PROMPT]";
        continue;
      }

      if (!input.policy.captureCodeSnippets && CODE_KEY_MATCH.test(normalizedKey)) {
        redactionCount += 1;
        next[key] = "[REDACTED_CODE]";
        continue;
      }

      next[key] = visit(nestedValue, fieldPath);
    }

    return next;
  };

  const sanitized = asRecord(visit(input.payload, [])) ?? {};

  return {
    payload: sanitized,
    redactionLevel: redactionCount > 0 ? "partial" : "none"
  };
}
