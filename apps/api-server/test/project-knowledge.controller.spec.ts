import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../src/common/prisma.service.js";
import type { AuthContext } from "../src/modules/auth/auth.types.js";
import { ProjectKnowledgeController } from "../src/modules/project-knowledge/project-knowledge.controller.js";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const DOC_ID = "33333333-3333-3333-3333-333333333333";
const PHASE_ID = "44444444-4444-4444-4444-444444444444";

const USER: AuthContext = {
  userId: "55555555-5555-5555-5555-555555555555",
  clerkUserId: "clerk_user_1",
  email: "member@branchline.dev",
  role: "member"
};

function projectRecord() {
  const now = new Date("2026-03-15T00:00:00.000Z");
  return {
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: "Console MVP",
    key: "MVP",
    description: "Legacy description",
    defaultBaseBranch: "main",
    createdAt: now,
    updatedAt: now
  };
}

function auditLogMock() {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: "audit-1"
    })
  };
}

describe("ProjectKnowledgeController", () => {
  it("returns version_conflict when baseVersion is stale", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      projectKnowledgeDoc: {
        findFirst: vi.fn().mockResolvedValue({
          id: DOC_ID,
          projectId: PROJECT_ID,
          type: "brief",
          activeVersion: 2
        })
      },
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);
    const result = await controller.createDocVersion(
      PROJECT_ID,
      DOC_ID,
      {
        contentMarkdown: "Updated brief",
        baseVersion: 1
      },
      USER
    );

    expect(result).toEqual({
      created: false,
      reason: "version_conflict",
      docId: DOC_ID,
      latestApprovedVersion: 2
    });
  });

  it("rejects invalid mermaidSource for diagram docs", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);

    await expect(
      controller.createDoc(
        PROJECT_ID,
        {
          type: "flow_diagram",
          title: "Invalid flow",
          mermaidSource: "not-a-mermaid-header"
        },
        USER
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("approves a pending doc version and updates activeVersion", async () => {
    const tx = {
      projectKnowledgeVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      projectKnowledgeDoc: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      projectKnowledgeDoc: {
        findFirst: vi.fn().mockResolvedValue({
          id: DOC_ID,
          projectId: PROJECT_ID,
          orgId: ORG_ID,
          activeVersion: 1
        })
      },
      projectKnowledgeVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-ver-2",
          docId: DOC_ID,
          version: 2,
          approvalStatus: "draft",
          baseVersion: 1
        })
      },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<void>) => callback(tx)),
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);
    const result = await controller.approveDocVersion(PROJECT_ID, DOC_ID, "2", {}, {
      ...USER,
      role: "admin"
    });

    expect(result).toEqual(
      expect.objectContaining({
        approved: true,
        docId: DOC_ID,
        version: 2,
        activeVersion: 2
      })
    );
    expect(tx.projectKnowledgeVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.projectKnowledgeDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeVersion: 2
        })
      })
    );
  });

  it("returns revision_conflict when baseRevision is stale", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      projectPhase: {
        findFirst: vi.fn().mockResolvedValue({
          id: PHASE_ID,
          projectId: PROJECT_ID,
          name: "Phase A",
          objective: null,
          status: "planned",
          ownerUserId: null,
          orderIndex: 0,
          plannedStartAt: null,
          plannedEndAt: null,
          completedAt: null
        })
      },
      projectPhaseRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ revision: 3 })
      },
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);
    const result = await controller.createPhaseRevision(
      PROJECT_ID,
      PHASE_ID,
      {
        name: "Phase B",
        baseRevision: 2
      },
      USER
    );

    expect(result).toEqual({
      created: false,
      reason: "revision_conflict",
      phaseId: PHASE_ID,
      latestApprovedRevision: 3
    });
  });

  it("approves a pending phase revision and applies payload", async () => {
    const tx = {
      projectPhaseRevision: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      projectPhase: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    const revisionPayload = {
      name: "Phase B",
      objective: "Finalize review gates",
      status: "in_progress",
      ownerUserId: USER.userId,
      orderIndex: 1,
      plannedStartAt: "2026-03-16T00:00:00.000Z",
      plannedEndAt: "2026-03-20T00:00:00.000Z",
      completedAt: null
    };

    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      projectPhase: {
        findFirst: vi.fn().mockResolvedValue({
          id: PHASE_ID,
          projectId: PROJECT_ID,
          orgId: ORG_ID
        })
      },
      projectPhaseRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "phase-rev-2",
            phaseId: PHASE_ID,
            revision: 2,
            approvalStatus: "draft",
            payload: revisionPayload,
            baseRevision: 1
          })
          .mockResolvedValueOnce({
            revision: 1
          })
      },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<void>) => callback(tx)),
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);
    const result = await controller.approvePhaseRevision(
      PROJECT_ID,
      PHASE_ID,
      "2",
      {},
      {
        ...USER,
        role: "admin"
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        approved: true,
        phaseId: PHASE_ID,
        revision: 2
      })
    );
    expect(tx.projectPhase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Phase B",
          status: "in_progress",
          orderIndex: 1
        })
      })
    );
  });

  it("throws when reorder request includes phases outside project", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(projectRecord())
      },
      projectPhase: {
        findMany: vi.fn().mockResolvedValue([{ id: PHASE_ID }])
      },
      auditLog: auditLogMock()
    } as unknown as PrismaService;

    const controller = new ProjectKnowledgeController(prisma);

    await expect(
      controller.reorderPhases(
        PROJECT_ID,
        {
          phaseIds: [
            PHASE_ID,
            "66666666-6666-6666-6666-666666666666"
          ]
        },
        {
          ...USER,
          role: "admin"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
