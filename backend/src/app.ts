import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ApiError } from "./errors.js";
import type { AppContext } from "./context.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerBindRoutes } from "./routes/bind.js";
import { registerRewardRoutes } from "./routes/rewards.js";
import { registerMatchRoutes } from "./routes/matches.js";
import { registerEntitlementRoutes } from "./routes/entitlement.js";
import { registerTournamentRoutes } from "./routes/tournaments.js";

/**
 * Framework choice: Fastify over Express — first-class async handlers with
 * one central error hook (every failure funnels into the {code,message}
 * envelope) and structured logging built in, at no extra dependency cost.
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: ctx.config.logLevel },
  });

  // The web bind page (and tournament action pages) call this API from the
  // browser at WEB_ORIGIN; game/Unity traffic is server-to-server or
  // non-browser and needs no CORS.
  await app.register(cors, {
    origin: [ctx.config.webOrigin],
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
  });

  // Unity's HttpApiClient POSTs claim/bind/intents with NO body and no
  // content-type; some tools send `content-type: application/json` with an
  // empty body. Treat empty JSON bodies as "no body" instead of erroring.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string", bodyLimit: 1024 * 1024 },
    (_request, payload, done) => {
      if (payload === "" || payload == null) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(payload as string));
      } catch {
        done(new ApiError(400, "invalid_json", "Request body is not valid JSON."), undefined);
      }
    },
  );

  // Every error resolves to the openapi Error envelope { code, message }.
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      void reply.code(error.status).send({ code: error.code, message: error.message });
      return;
    }
    const fastifyError = error as { statusCode?: number; message?: string };
    const status =
      typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400
        ? fastifyError.statusCode
        : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
    }
    void reply.code(status).send({
      code: status >= 500 ? "internal_error" : "bad_request",
      message: status >= 500 ? "Internal error." : (fastifyError.message ?? "Bad request."),
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ code: "not_found", message: "Route not found." });
  });

  registerConfigRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerAssetRoutes(app, ctx);
  registerBindRoutes(app, ctx);
  registerRewardRoutes(app, ctx);
  registerMatchRoutes(app, ctx);
  registerEntitlementRoutes(app, ctx);
  registerTournamentRoutes(app, ctx);

  return app;
}
