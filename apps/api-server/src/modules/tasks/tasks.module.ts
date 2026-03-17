import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "queue.handoff.generate" }, { name: "queue.analytics.rollup" })],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService]
})
export class TasksModule {}
