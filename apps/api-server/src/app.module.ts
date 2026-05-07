import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { APP_GUARD } from "@nestjs/core";

import { readEnv } from "./common/env.js";
import { PrismaModule } from "./common/prisma.module.js";
import { AuthGuard } from "./modules/auth/auth.guard.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { RolesGuard } from "./modules/auth/roles.guard.js";
import { BranchesModule } from "./modules/branches/branches.module.js";
import { IntentModule } from "./modules/intent/intent.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { RepositoriesModule } from "./modules/repositories/repositories.module.js";
import { TasksModule } from "./modules/tasks/tasks.module.js";
import { WorkspaceBindingsModule } from "./modules/workspace-bindings/workspace-bindings.module.js";

const env = readEnv();

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({
      connection: {
        url: env.redisUrl
      }
    }),
    BullModule.registerQueue({ name: "queue.intent.normalize" }),
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    RepositoriesModule,
    TasksModule,
    BranchesModule,
    IntentModule,
    WorkspaceBindingsModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    }
  ]
})
export class AppModule {}
