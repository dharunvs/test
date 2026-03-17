import { describe, expect, it } from "vitest";

import { buildAuditHash } from "../src/common/audit.js";

describe("buildAuditHash", () => {
  it("hashes payload canonically independent of key order", () => {
    const occurredAt = new Date("2026-03-09T00:00:00.000Z");

    const left = buildAuditHash({
      previousHash: "root",
      orgId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      eventType: "task.started",
      entityType: "task",
      entityId: "44444444-4444-4444-4444-444444444444",
      payload: {
        b: 2,
        a: 1,
        nested: {
          z: true,
          y: false
        }
      },
      occurredAt
    });

    const right = buildAuditHash({
      previousHash: "root",
      orgId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      eventType: "task.started",
      entityType: "task",
      entityId: "44444444-4444-4444-4444-444444444444",
      payload: {
        nested: {
          y: false,
          z: true
        },
        a: 1,
        b: 2
      },
      occurredAt
    });

    expect(left).toBe(right);
  });

  it("changes hash when previous hash changes", () => {
    const occurredAt = new Date("2026-03-09T00:00:00.000Z");

    const rootHash = buildAuditHash({
      previousHash: "root",
      orgId: "11111111-1111-1111-1111-111111111111",
      eventType: "test.event",
      payload: { ok: true },
      occurredAt
    });

    const chainedHash = buildAuditHash({
      previousHash: "previous-hash",
      orgId: "11111111-1111-1111-1111-111111111111",
      eventType: "test.event",
      payload: { ok: true },
      occurredAt
    });

    expect(rootHash).not.toBe(chainedHash);
  });
});
