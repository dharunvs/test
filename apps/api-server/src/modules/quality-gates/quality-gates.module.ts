import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { QualityGatesController } from "./quality-gates.controller.js";

@Module({
  imports: [
    RealtimeModule,
    BullModule.registerQueue(
      { name: "queue.quality.run" },
      { name: "queue.pr.slice" },
      { name: "queue.analytics.rollup" }
    )
  ],
  controllers: [QualityGatesController]
})
export class QualityGatesModule {}
