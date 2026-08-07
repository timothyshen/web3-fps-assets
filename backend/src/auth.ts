import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { errors } from "./errors.js";
import type { AppConfig } from "./config.js";

/**
 * /v1/* player auth: Bearer JWT whose subject is the playerId
 * (openapi `gameSession` scheme — identity is the game account, never the
 * wallet). Issued by POST /v1/auth/login, a DEMO-ONLY stand-in for the real
 * account system.
 *
 * /internal/v1/*: separate static service token (openapi `serviceToken`),
 * never the player JWT.
 */

const JWT_TTL_SECONDS = 24 * 60 * 60;

export class AuthService {
  private readonly key: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async issuePlayerToken(playerId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(playerId)
      .setIssuedAt()
      .setExpirationTime(`${JWT_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Returns the playerId or throws a 401 ApiError. */
  async requirePlayer(request: FastifyRequest): Promise<string> {
    const token = bearerOf(request);
    if (!token) throw errors.unauthorized();
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("no sub");
      return payload.sub;
    } catch {
      throw errors.unauthorized();
    }
  }

  /** Validates the internal service token or throws 401. */
  requireService(request: FastifyRequest): void {
    const token = bearerOf(request);
    if (!token || !constantTimeEquals(token, this.config.internalServiceToken)) {
      throw errors.unauthorized();
    }
  }
}

function bearerOf(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
