import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { readEnv } from "./common/env.js";
import { observeHttpRequest } from "./common/metrics.js";

type HookRequest = {
  raw?: object;
  method?: string;
  url?: string;
  routeOptions?: {
    url?: string;
  };
};

type HookReply = {
  statusCode?: number;
};

type HookHandler = (request: HookRequest, reply: HookReply, done: () => void) => void;

async function bootstrap() {
  const env = readEnv();
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      bodyLimit: 10485760
    }),
    {
      rawBody: true
    }
  );

  app.setGlobalPrefix("v1");

  const fastify = app.getHttpAdapter().getInstance() as {
    addHook: (name: "onRequest" | "onResponse", handler: HookHandler) => void;
  };
  const requestStartTimes = new WeakMap<object, bigint>();

  fastify.addHook("onRequest", (request, _reply, done) => {
    if (request.raw) {
      requestStartTimes.set(request.raw, process.hrtime.bigint());
    }
    done();
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    const startedAt = request.raw ? requestStartTimes.get(request.raw) : undefined;
    if (startedAt) {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      observeHttpRequest({
        method: request.method || "unknown",
        route: request.routeOptions?.url || request.url?.split("?")[0] || "unknown",
        statusCode: Number(reply.statusCode ?? 0),
        durationSeconds
      });
    }
    done();
  });

  const swaggerEnabled =
    process.env.ENABLE_SWAGGER_UI === "true" ||
    process.env.ENABLE_SWAGGER_JSON === "true";

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle("Branchline API")
      .setDescription("Branchline control-plane and execution-plane APIs")
      .setVersion("0.2.0")
      .build();

    const document = SwaggerModule.createDocument(app, config);
    if (process.env.ENABLE_SWAGGER_UI === "true") {
      try {
        SwaggerModule.setup("docs", app, document);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        logger.warn(`Swagger UI setup skipped: ${message}`);
      }
    }
  }

  await app.listen({ host: "0.0.0.0", port: env.port });
}

bootstrap().catch((error) => {
  console.error("Failed to start Branchline API", error);
  process.exit(1);
});
