import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { IntegrationsController } from "./integrations.controller.js";

@Module({
  imports: [BullModule.registerQueue({ name: "queue.analytics.rollup" })],
  controllers: [IntegrationsController]
})
export class IntegrationsModule {}
