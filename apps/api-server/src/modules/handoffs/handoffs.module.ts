import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { HandoffsController } from "./handoffs.controller.js";

@Module({
  imports: [RealtimeModule, BullModule.registerQueue({ name: "queue.handoff.generate" })],
  controllers: [HandoffsController]
})
export class HandoffsModule {}
