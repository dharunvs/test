import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { PivotController } from "./pivot.controller.js";

@Module({
  imports: [RealtimeModule, BullModule.registerQueue({ name: "queue.analytics.rollup" })],
  controllers: [PivotController]
})
export class PivotModule {}
