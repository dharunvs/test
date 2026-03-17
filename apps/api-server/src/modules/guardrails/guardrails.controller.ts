import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { evaluateGuardrails } from "@branchline/policy-engine";
import type { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { toJson } from "../../common/json.js";
import { PrismaService } from "../../common/prisma.service.js";
import { reliableQueueOptions } from "../../common/queue-options.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";

const guardrailEvalSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  stage: z.enum(["pre_apply", "pre_pr", "promote"]).default("pre_pr"),
  changedPaths: z.array(z.string()),
  bannedPathPrefixes: z.array(z.string()).optional(),
  requiredPathPrefix: z.string().optional()
});

const listPolicySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().default("default"),
  includeRules: z.coerce.boolean().default(false)
});

const ruleSchema = z.object({
  ruleKey: z.string().min(2),
  ruleType: z.string().min(2),
  severity: z.enum(["warn", "fail"]).default("warn"),
  expression: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true)
});

const createPolicySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().default("default"),
  config: z.record(z.unknown()).default({}),
  rules: z.array(ruleSchema).default([]),
  activate: z.boolean().default(true)
});

const activatePolicySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().default("default"),
  version: z.number().int().positive()
});

const ingestPolicyFileSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().default("default"),
  content: z.string().min(1),
  activate: z.boolean().default(true)
});

interface EffectiveGuardrailInput {
  bannedPathPrefixes?: string[];
  requiredPathPrefix?: string;
  maxChangedFiles?: number;
  forbiddenPathPatterns?: string[];
  companionPathRequirements?: Array<{
    ruleKey?: string;
    severity?: "warn" | "fail";
    whenPathPrefix: string;
    requireAnyPathPrefixes: string[];
  }>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toRuleCreateInput(
  policySetId: string,
  rules: Array<z.infer<typeof ruleSchema>>
): Prisma.GuardrailRuleCreateManyInput[] {
  return rules.map((rule) => ({
    policySetId,
    ruleKey: rule.ruleKey,
    ruleType: rule.ruleType,
    severity: rule.severity,
    expression: toJson(rule.expression),
    enabled: rule.enabled
  }));
}

function deriveRulesFromPolicyFile(content: string): {
  config: Record<string, unknown>;
  rules: Array<z.infer<typeof ruleSchema>>;
} {
  const parsed = parseYaml(content);
  const root = asRecord(parsed);

  if (!root) {
    throw new Error("Policy file must be a YAML object");
  }

  const config = asRecord(root.config) ?? {};
  const parsedRules = (Array.isArray(root.rules) ? root.rules : [])
    .map((rule) => ruleSchema.parse(rule))
    .map((rule) => ({
      ...rule,
      ruleKey: rule.ruleKey.trim()
    }));

  if (parsedRules.length > 0) {
    return {
      config,
      rules: parsedRules
    };
  }

  const synthesizedRules: Array<z.infer<typeof ruleSchema>> = [];

  if (Array.isArray(root.bannedPathPrefixes)) {
    const prefixes = root.bannedPathPrefixes
      .filter((prefix): prefix is string => typeof prefix === "string")
      .map((prefix) => prefix.trim())
      .filter(Boolean);

    if (prefixes.length > 0) {
      synthesizedRules.push({
        ruleKey: "legacy-banned-path-prefixes",
        ruleType: "path_prefix_block",
        severity: "fail",
        expression: { prefixes },
        enabled: true
      });
    }
  }

  const requiredPathPrefix = readString(root.requiredPathPrefix);
  if (requiredPathPrefix) {
    synthesizedRules.push({
      ruleKey: "legacy-required-path-prefix",
      ruleType: "path_prefix_require",
      severity: "warn",
      expression: { prefix: requiredPathPrefix },
      enabled: true
    });
  }

  const maxChangedFiles = readNumber(root.maxChangedFiles);
  if (typeof maxChangedFiles === "number" && maxChangedFiles > 0) {
    synthesizedRules.push({
      ruleKey: "legacy-max-changed-files",
      ruleType: "max_changed_files",
      severity: "fail",
      expression: { max: maxChangedFiles },
      enabled: true
    });
  }

  if (Array.isArray(root.forbiddenPathPatterns)) {
    const patterns = root.forbiddenPathPatterns
      .filter((pattern): pattern is string => typeof pattern === "string")
      .map((pattern) => pattern.trim())
      .filter(Boolean);

    if (patterns.length > 0) {
      synthesizedRules.push({
        ruleKey: "legacy-forbidden-path-patterns",
        ruleType: "forbidden_path_pattern",
        severity: "fail",
        expression: { patterns },
        enabled: true
      });
    }
  }

  if (Array.isArray(root.companionPathRequirements)) {
    for (const requirement of root.companionPathRequirements) {
      const parsedRequirement = asRecord(requirement);
      const whenPathPrefix = readString(parsedRequirement?.whenPathPrefix);
      const requireAnyPathPrefixes = Array.isArray(parsedRequirement?.requireAnyPathPrefixes)
        ? parsedRequirement.requireAnyPathPrefixes
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];

      if (!whenPathPrefix || requireAnyPathPrefixes.length === 0) {
        continue;
      }

      const severity = readString(parsedRequirement?.severity);
      synthesizedRules.push({
        ruleKey:
          readString(parsedRequirement?.ruleKey) ??
          `legacy-companion-path-requirement-${synthesizedRules.length + 1}`,
        ruleType: "companion_path_requirement",
        severity: severity === "warn" ? "warn" : "fail",
        expression: {
          whenPathPrefix,
          requireAnyPathPrefixes
        },
        enabled: true
      });
    }
  }

  return {
    config,
    rules: synthesizedRules
  };
}

function resolveGuardrailInput(
  input: z.infer<typeof guardrailEvalSchema>,
  rules: Array<{
    enabled: boolean;
    severity?: string;
    ruleType: string;
    expression: Prisma.JsonValue;
  }>
): EffectiveGuardrailInput {
  const bannedPathPrefixes = new Set(input.bannedPathPrefixes ?? []);
  let requiredPathPrefix = input.requiredPathPrefix;
  let maxChangedFiles: number | undefined;
  const forbiddenPathPatterns = new Set<string>();
  const companionPathRequirements: EffectiveGuardrailInput["companionPathRequirements"] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const expression = asRecord(rule.expression);
    if (!expression) {
      continue;
    }

    if (rule.ruleType === "path_prefix_block") {
      const directPrefix = readString(expression.prefix);
      if (directPrefix) {
        bannedPathPrefixes.add(directPrefix);
      }

      const prefixes = Array.isArray(expression.prefixes)
        ? expression.prefixes.filter((value): value is string => typeof value === "string")
        : [];
      for (const prefix of prefixes) {
        const normalized = prefix.trim();
        if (normalized.length > 0) {
          bannedPathPrefixes.add(normalized);
        }
      }
    }

    if (!requiredPathPrefix && rule.ruleType === "path_prefix_require") {
      requiredPathPrefix = readString(expression.prefix);
    }

    if (rule.ruleType === "max_changed_files") {
      const max = readNumber(expression.max);
      if (typeof max === "number" && max > 0) {
        maxChangedFiles = typeof maxChangedFiles === "number" ? Math.min(maxChangedFiles, max) : max;
      }
    }

    if (rule.ruleType === "forbidden_path_pattern") {
      const directPattern = readString(expression.pattern);
      if (directPattern) {
        forbiddenPathPatterns.add(directPattern);
      }

      const patterns = Array.isArray(expression.patterns)
        ? expression.patterns.filter((value): value is string => typeof value === "string")
        : [];
      for (const pattern of patterns) {
        const normalized = pattern.trim();
        if (normalized.length > 0) {
          forbiddenPathPatterns.add(normalized);
        }
      }
    }

    if (rule.ruleType === "companion_path_requirement") {
      const whenPathPrefix = readString(expression.whenPathPrefix);
      const requireAnyPathPrefixes = Array.isArray(expression.requireAnyPathPrefixes)
        ? expression.requireAnyPathPrefixes
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      if (!whenPathPrefix || requireAnyPathPrefixes.length === 0) {
        continue;
      }

      const severity = readString(expression.severity) ?? rule.severity;
      companionPathRequirements.push({
        ruleKey: readString(expression.ruleKey),
        severity: severity === "warn" ? "warn" : "fail",
        whenPathPrefix,
        requireAnyPathPrefixes
      });
    }
  }

  return {
    bannedPathPrefixes: bannedPathPrefixes.size > 0 ? [...bannedPathPrefixes] : undefined,
    requiredPathPrefix,
    maxChangedFiles,
    forbiddenPathPatterns: forbiddenPathPatterns.size > 0 ? [...forbiddenPathPatterns] : undefined,
    companionPathRequirements
  };
}

@Controller("guardrails")
export class GuardrailsController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("queue.guardrail.evaluate") private readonly guardrailQueue: Queue
  ) {}

  @Roles("owner", "admin", "member", "viewer")
  @Get("policies")
  async listPolicies(@Query() query: Record<string, unknown>) {
    const input = listPolicySchema.parse(query);

    if (input.includeRules) {
      return this.prisma.policySet.findMany({
        where: {
          projectId: input.projectId,
          name: input.name
        },
        include: {
          rules: {
            orderBy: {
              createdAt: "asc"
            }
          }
        },
        orderBy: {
          version: "desc"
        }
      });
    }

    return this.prisma.policySet.findMany({
      where: {
        projectId: input.projectId,
        name: input.name
      },
      orderBy: {
        version: "desc"
      }
    });
  }

  @Roles("owner", "admin")
  @Post("policies")
  async createPolicy(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = createPolicySchema.parse(body);
    const created = await this.createPolicyVersion({
      orgId: input.orgId,
      projectId: input.projectId,
      name: input.name,
      config: input.config,
      rules: input.rules,
      activate: input.activate,
      actorUserId: user.userId
    });

    return created;
  }

  @Roles("owner", "admin")
  @Post("policies/activate")
  async activatePolicy(@Body() body: unknown) {
    const input = activatePolicySchema.parse(body);

    const policySet = await this.prisma.policySet.findFirst({
      where: {
        projectId: input.projectId,
        name: input.name,
        version: input.version
      }
    });

    if (!policySet) {
      throw new NotFoundException("Policy version not found");
    }

    await this.prisma.$transaction([
      this.prisma.policySet.updateMany({
        where: {
          projectId: input.projectId,
          name: input.name
        },
        data: {
          status: "inactive"
        }
      }),
      this.prisma.policySet.update({
        where: {
          id: policySet.id
        },
        data: {
          status: "active"
        }
      })
    ]);

    return {
      id: policySet.id,
      projectId: policySet.projectId,
      name: policySet.name,
      version: policySet.version,
      status: "active"
    };
  }

  @Roles("owner", "admin")
  @Post("policies/ingest-file")
  async ingestPolicyFile(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = ingestPolicyFileSchema.parse(body);
    const extracted = deriveRulesFromPolicyFile(input.content);

    const created = await this.createPolicyVersion({
      orgId: input.orgId,
      projectId: input.projectId,
      name: input.name,
      config: extracted.config,
      rules: extracted.rules,
      activate: input.activate,
      actorUserId: user.userId
    });

    return {
      ...created,
      source: ".branchline/policy.yaml"
    };
  }

  @Roles("owner", "admin", "member")
  @Post("evaluate")
  async evaluate(@Body() body: unknown, @CurrentUser() user: AuthContext) {
    const input = guardrailEvalSchema.parse(body);

    const task = await this.prisma.task.findUnique({
      where: {
        id: input.taskId
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const activePolicy =
      (await this.prisma.policySet.findFirst({
        where: {
          projectId: input.projectId,
          name: "default",
          status: "active"
        },
        orderBy: {
          version: "desc"
        },
        include: {
          rules: true
        }
      })) ??
      (await this.prisma.policySet.findFirst({
        where: {
          projectId: input.projectId,
          name: "default"
        },
        orderBy: {
          version: "desc"
        },
        include: {
          rules: true
        }
      }));

    if (!activePolicy) {
      throw new NotFoundException("No policy set found for project");
    }

    const resolvedInput = resolveGuardrailInput(input, activePolicy.rules);
    const violations = evaluateGuardrails({
      changedPaths: input.changedPaths,
      bannedPathPrefixes: resolvedInput.bannedPathPrefixes,
      requiredPathPrefix: resolvedInput.requiredPathPrefix,
      maxChangedFiles: resolvedInput.maxChangedFiles,
      forbiddenPathPatterns: resolvedInput.forbiddenPathPatterns,
      companionPathRequirements: resolvedInput.companionPathRequirements
    });
    const reasonCodes = Array.from(new Set(violations.map((violation) => violation.ruleKey)));
    const status = violations.some((violation) => violation.severity === "fail")
      ? "fail"
      : violations.length > 0
        ? "warn"
        : "pass";
    const blocking = status === "fail";

    const evaluation = await this.prisma.guardrailEvaluation.create({
      data: {
        orgId: task.orgId,
        projectId: input.projectId,
        taskId: input.taskId,
        branchId: input.branchId,
        policySetId: activePolicy.id,
        status,
        violations: toJson({
          stage: input.stage,
          blocking,
          reasonCodes,
          violations
        }),
        evaluatedAt: new Date()
      }
    });

    await this.guardrailQueue.add("evaluate", {
      evaluationId: evaluation.id,
      taskId: input.taskId,
      projectId: input.projectId,
      orgId: task.orgId,
      stage: input.stage,
      blocking
    }, reliableQueueOptions);

    return {
      status: evaluation.status,
      stage: input.stage,
      blocking,
      reasonCodes,
      violations,
      evaluationId: evaluation.id,
      policySetId: activePolicy.id,
      policyVersion: activePolicy.version,
      evaluatedBy: user.userId
    };
  }

  private async createPolicyVersion(input: {
    orgId: string;
    projectId: string;
    name: string;
    config: Record<string, unknown>;
    rules: Array<z.infer<typeof ruleSchema>>;
    activate: boolean;
    actorUserId: string;
  }) {
    const project = await this.prisma.project.findUnique({
      where: {
        id: input.projectId
      },
      select: {
        orgId: true
      }
    });

    if (!project || project.orgId !== input.orgId) {
      throw new BadRequestException("projectId must belong to orgId");
    }

    const latest = await this.prisma.policySet.findFirst({
      where: {
        projectId: input.projectId,
        name: input.name
      },
      orderBy: {
        version: "desc"
      }
    });

    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.activate) {
        await tx.policySet.updateMany({
          where: {
            projectId: input.projectId,
            name: input.name
          },
          data: {
            status: "inactive"
          }
        });
      }

      const policySet = await tx.policySet.create({
        data: {
          orgId: input.orgId,
          projectId: input.projectId,
          name: input.name,
          version: nextVersion,
          status: input.activate ? "active" : "draft",
          config: toJson(input.config),
          createdBy: input.actorUserId
        }
      });

      if (input.rules.length > 0) {
        await tx.guardrailRule.createMany({
          data: toRuleCreateInput(policySet.id, input.rules)
        });
      }

      return tx.policySet.findUnique({
        where: {
          id: policySet.id
        },
        include: {
          rules: {
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      });
    });

    if (!created) {
      throw new BadRequestException("Failed to create policy set");
    }

    return created;
  }
}
