import { Module } from "@nestjs/common";

import { ProvenanceController } from "./provenance.controller.js";

@Module({
  controllers: [ProvenanceController]
})
export class ProvenanceModule {}
