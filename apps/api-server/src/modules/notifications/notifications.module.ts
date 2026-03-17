import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller.js";

@Module({
  imports: [BullModule.registerQueue({ name: "queue.notifications.dispatch" }, { name: "queue.analytics.rollup" })],
  controllers: [NotificationsController]
})
export class NotificationsModule {}
