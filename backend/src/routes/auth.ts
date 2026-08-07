import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { AppContext } from "../context.js";

const loginSchema = z.object({
  playerId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.\-]+$/, "playerId may contain letters, digits, _ . -"),
});

/**
 * POST /v1/auth/login — DEMO-ONLY EXTENSION, not part of api/openapi.yaml.
 *
 * The real product authenticates against the game studio's account system
 * (docs/roadmap.md: 玩家账号体系 is owned by the game side); this endpoint
 * exists so the Web3 stack is demonstrable standalone. It mints a gameSession
 * JWT for any playerId, no password. PRODUCTION MUST REPLACE THIS.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/v1/auth/login", async (request) => {
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw errors.badRequest("invalid_player_id", parsed.error.issues[0]?.message ?? "invalid playerId");
    }
    const accessToken = await ctx.auth.issuePlayerToken(parsed.data.playerId);
    return { accessToken };
  });
}
