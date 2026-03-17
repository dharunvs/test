import { Module } from "@nestjs/common";

import { GithubAppController } from "./github-app.controller.js";

@Module({
  controllers: [GithubAppController]
})
export class GithubAppModule {}
