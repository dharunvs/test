import { describe, expect, it } from "vitest";
import { queueTopics, socketEventNames } from "@branchline/shared-events";

import { RealtimeGateway } from "../src/modules/realtime/realtime.gateway.js";
import { PromptLibraryController } from "../src/modules/prompt-library/prompt-library.controller.js";

describe("contract locks", () => {
  it("keeps websocket event contract locked", () => {
    expect(socketEventNames).toEqual([
      "activity.user_state_changed",
      "activity.file_focus_changed",
      "conflict.detected",
      "branch.status_changed",
      "quality_gate.completed",
      "handoff.created",
      "pivot.mode_enabled"
    ]);
  });

  it("keeps queue topic contract locked", () => {
    expect(queueTopics).toEqual([
      "queue.intent.normalize",
      "queue.conflict.score",
      "queue.guardrail.evaluate",
      "queue.quality.run",
      "queue.pr.slice",
      "queue.handoff.generate",
      "queue.notifications.dispatch",
      "queue.analytics.rollup"
    ]);
  });

  it("exposes task-room realtime join/leave handlers", () => {
    expect(typeof RealtimeGateway.prototype.handleJoinTask).toBe("function");
    expect(typeof RealtimeGateway.prototype.handleLeaveTask).toBe("function");
    expect(typeof RealtimeGateway.prototype.emitToTask).toBe("function");
  });

  it("exposes prompt lifecycle endpoints for versioning and analytics", () => {
    expect(typeof PromptLibraryController.prototype.createVersion).toBe("function");
    expect(typeof PromptLibraryController.prototype.trackUsage).toBe("function");
    expect(typeof PromptLibraryController.prototype.usageAnalytics).toBe("function");
  });
});
