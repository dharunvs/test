import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { ConflictsController } from "./conflicts.controller.js";

@Module({
  imports: [RealtimeModule, BullModule.registerQueue({ name: "queue.conflict.score" })],
  controllers: [ConflictsController]
})
export class ConflictsModule {}
