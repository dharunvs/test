import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

import { ObservabilityController } from "./observability.controller.js";

@Module({
  imports: [
    BullModule.registerQueue(
      { name: "queue.intent.normalize" },
      { name: "queue.conflict.score" },
      { name: "queue.guardrail.evaluate" },
      { name: "queue.quality.run" },
      { name: "queue.pr.slice" },
      { name: "queue.handoff.generate" },
      { name: "queue.notifications.dispatch" },
      { name: "queue.analytics.rollup" },
      { name: "queue.dead_letter" }
    )
  ],
  controllers: [ObservabilityController]
})
export class ObservabilityModule {}
