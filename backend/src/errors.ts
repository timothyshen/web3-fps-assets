/**
 * All error responses use the openapi Error envelope: { code, message }.
 * Throw ApiError anywhere in a route; the fastify error handler serializes it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, "unauthorized", "Missing or invalid session token."),
  notFound: (code: string, message: string) => new ApiError(404, code, message),
  badRequest: (code: string, message: string) => new ApiError(400, code, message),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  gone: (code: string, message: string) => new ApiError(410, code, message),
  /** Explicit degraded-dependency error (RPC down etc.). Never a crash. */
  degraded: (message: string) => new ApiError(503, "chain_unavailable", message),
} as const;
