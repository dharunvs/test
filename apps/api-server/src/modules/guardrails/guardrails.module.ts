import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { GuardrailsController } from "./guardrails.controller.js";

@Module({
  imports: [BullModule.registerQueue({ name: "queue.guardrail.evaluate" })],
  controllers: [GuardrailsController]
})
export class GuardrailsModule {}
