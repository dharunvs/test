import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { IntentController } from "./intent.controller.js";

@Module({
  imports: [BullModule.registerQueue({ name: "queue.intent.normalize" }, { name: "queue.analytics.rollup" })],
  controllers: [IntentController]
})
export class IntentModule {}
